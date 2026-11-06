import type { Network } from '@welyvra/core';
import { inTransaction } from '@welyvra/db';
import { openCase, postDeposit } from '@welyvra/reconciliation';
import {
  type EventQuery,
  type EventSource,
  type RawRpcEvent,
  RetentionGapError,
  decodeEvent,
} from '@welyvra/stellar';
import type { Sql } from 'postgres';

export interface IngestConfig {
  sql: Sql;
  source: EventSource;
  network: Network;
  /** Name of this ingestion stream (one cursor per network + source). */
  sourceName: string;
  /** Token contracts to watch, e.g. the native XLM SAC. */
  tokenContracts: string[];
  /** Ledger to start from when no cursor exists yet. */
  startLedger: number;
  pageLimit?: number;
  /** Test hook: called at each step boundary inside the batch transaction. Throw to simulate a crash. */
  faultInjector?: (step: BatchStep) => void;
}

export type BatchStep =
  'after_lock' | 'after_events' | 'after_deposits' | 'before_cursor' | 'after_cursor';

export interface BatchResult {
  status: 'ok' | 'stale' | 'gap_detected';
  fetched: number;
  chainEvents: number;
  deposits: number;
  rejected: number;
  ignored: number;
  cursor: string | null;
  latestLedger: number | null;
}

interface CursorRow {
  last_ledger: number;
  last_cursor: string | null;
  status: 'ok' | 'gap_detected';
}

const empty = (status: BatchResult['status'], cursor: string | null): BatchResult => ({
  status,
  fetched: 0,
  chainEvents: 0,
  deposits: 0,
  rejected: 0,
  ignored: 0,
  cursor,
  latestLedger: null,
});

async function readCursor(
  sql: Sql,
  network: Network,
  source: string,
): Promise<CursorRow | undefined> {
  const [row] = await sql<CursorRow[]>`
    SELECT last_ledger, last_cursor, status FROM ingestion_cursors WHERE network = ${network} AND source = ${source}`;
  return row;
}

async function markGap(
  sql: Sql,
  network: Network,
  source: string,
  lastLedger: number,
  detail: string,
) {
  await sql`
    INSERT INTO ingestion_cursors (network, source, last_ledger, status, status_detail)
    VALUES (${network}, ${source}, ${lastLedger}, 'gap_detected', ${detail})
    ON CONFLICT (network, source) DO UPDATE SET status = 'gap_detected', status_detail = ${detail}, updated_at = now()`;
}

/**
 * Fetches one page of events and commits it atomically: chain events, rejections,
 * deposits and the cursor advance happen in one transaction or not at all.
 * Replays are no-ops thanks to unique constraints, so crashes and duplicate
 * deliveries never create duplicate deposits.
 */
export async function ingestBatch(cfg: IngestConfig): Promise<BatchResult> {
  const { sql, network, sourceName } = cfg;
  const before = await readCursor(sql, network, sourceName);
  if (before?.status === 'gap_detected') return empty('gap_detected', before.last_cursor);

  const query: EventQuery = before?.last_cursor
    ? { cursor: before.last_cursor, contractIds: cfg.tokenContracts, limit: cfg.pageLimit ?? 200 }
    : {
        startLedger: before ? before.last_ledger + 1 : cfg.startLedger,
        contractIds: cfg.tokenContracts,
        limit: cfg.pageLimit ?? 200,
      };

  let page;
  try {
    page = await cfg.source.getEvents(query);
  } catch (e) {
    if (e instanceof RetentionGapError) {
      await markGap(
        sql,
        network,
        sourceName,
        before?.last_ledger ?? cfg.startLedger - 1,
        e.message,
      );
      return empty('gap_detected', before?.last_cursor ?? null);
    }
    throw e;
  }

  // The position we asked for fell out of the retention window: events may be missing.
  const requestedLedger = before ? before.last_ledger + 1 : cfg.startLedger;
  if (page.oldestLedger > requestedLedger) {
    const detail = `requested ledger ${requestedLedger} is older than RPC oldest ledger ${page.oldestLedger}`;
    await markGap(sql, network, sourceName, before?.last_ledger ?? cfg.startLedger - 1, detail);
    return empty('gap_detected', before?.last_cursor ?? null);
  }

  return inTransaction(sql, async (tx) => {
    // Serialize workers of the same stream, then make sure nobody advanced the cursor meanwhile.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${network + ':' + sourceName}))`;
    cfg.faultInjector?.('after_lock');
    const current = await readCursor(tx, network, sourceName);
    if (
      (current?.last_cursor ?? null) !== (before?.last_cursor ?? null) ||
      current?.last_ledger !== before?.last_ledger
    ) {
      return empty('stale', current?.last_cursor ?? null);
    }

    const accounts = new Map(
      (
        await tx<{ id: string; org_id: string; address: string }[]>`
          SELECT id, org_id, address FROM receiving_accounts WHERE network = ${network}`
      ).map((a) => [a.address, a]),
    );

    const result: BatchResult = {
      ...empty('ok', page.cursor),
      fetched: page.events.length,
      latestLedger: page.latestLedger,
    };
    let maxLedger = before?.last_ledger ?? cfg.startLedger - 1;
    const inserted: {
      chainEventId: string;
      to: string;
      routingKind: string | null;
      routingValue: string | null;
      token: string;
      amount: string;
    }[] = [];

    for (const raw of page.events) {
      if (typeof raw.ledger === 'number' && raw.ledger > maxLedger) maxLedger = raw.ledger;
      const decoded = decodeEvent(raw, network);
      if (decoded.status === 'ignored') {
        result.ignored++;
        continue;
      }
      if (decoded.status === 'invalid') {
        // Only keep rejections that could concern us; a malformed event is recorded, never dropped silently.
        const rows = await tx`
          INSERT INTO chain_event_rejections (network, event_id, reason, raw)
          VALUES (${network}, ${decoded.eventId}, ${decoded.reason}, ${JSON.stringify(raw)}::jsonb)
          ON CONFLICT (network, event_id) DO NOTHING RETURNING id`;
        result.rejected += rows.length;
        continue;
      }
      const e = decoded.event;
      if (!accounts.has(e.to)) {
        result.ignored++;
        continue;
      }
      const rk = e.routingKey.kind === 'none' ? null : e.routingKey;
      const rows = await tx<{ id: string }[]>`
        INSERT INTO chain_events (network, event_id, ledger, ledger_closed_at, tx_hash, tx_index, op_index,
          token_contract, asset, kind, from_address, to_address, routing_kind, routing_value, amount)
        VALUES (${network}, ${e.eventId}, ${e.ledger}, ${e.ledgerClosedAt}, ${e.txHash}, ${e.transactionIndex},
          ${e.operationIndex}, ${e.tokenContract}, ${e.asset}, ${e.kind}, ${e.from}, ${e.to},
          ${rk?.kind ?? null}, ${rk?.value ?? null}, ${e.amount.toString()})
        ON CONFLICT (network, event_id) DO NOTHING RETURNING id`;
      const row = rows[0];
      if (!row) continue; // already ingested: replay is a no-op
      result.chainEvents++;
      inserted.push({
        chainEventId: row.id,
        to: e.to,
        routingKind: rk?.kind ?? null,
        routingValue: rk?.value ?? null,
        token: e.tokenContract,
        amount: e.amount.toString(),
      });
    }
    cfg.faultInjector?.('after_events');

    for (const ev of inserted) {
      const account = accounts.get(ev.to);
      if (!account) throw new Error(`invariant: account for ${ev.to} disappeared mid-batch`);
      const [key] =
        ev.routingKind === null
          ? []
          : await tx<{ customer_id: string }[]>`
              SELECT customer_id FROM routing_keys
              WHERE receiving_account_id = ${account.id} AND kind = ${ev.routingKind}::routing_kind AND value = ${ev.routingValue}`;
      const customerId = key?.customer_id ?? null;
      const [deposit] = await tx<{ id: string }[]>`
        INSERT INTO deposits (org_id, chain_event_id, receiving_account_id, customer_id, status, token_contract, amount)
        VALUES (${account.org_id}, ${ev.chainEventId}, ${account.id}, ${customerId},
          ${customerId ? 'attributed' : 'unattributed'}::deposit_status, ${ev.token}, ${ev.amount})
        ON CONFLICT (chain_event_id, receiving_account_id) DO NOTHING RETURNING id`;
      if (!deposit) continue;
      result.deposits++;
      await postDeposit(tx, {
        orgId: account.org_id,
        depositId: deposit.id,
        receivingAccountId: account.id,
        customerId,
        tokenContract: ev.token,
        amount: ev.amount,
      });
      if (!customerId) {
        await openCase(tx, {
          orgId: account.org_id,
          kind: 'unattributed_deposit',
          subjectRef: `deposit:${deposit.id}`,
          detail: ev.routingKind
            ? `unknown routing key ${ev.routingKind}:${ev.routingValue}`
            : 'no routing key',
          actor: 'ingestion',
        });
      }
    }
    cfg.faultInjector?.('after_deposits');

    cfg.faultInjector?.('before_cursor');
    await tx`
      INSERT INTO ingestion_cursors (network, source, last_ledger, last_cursor, status)
      VALUES (${network}, ${sourceName}, ${maxLedger}, ${page.cursor}, 'ok')
      ON CONFLICT (network, source) DO UPDATE
        SET last_ledger = EXCLUDED.last_ledger, last_cursor = EXCLUDED.last_cursor, updated_at = now()`;
    cfg.faultInjector?.('after_cursor');
    return result;
  });
}

/** Runs batches until the source has no more events (a short page). */
export async function ingestUntilCaughtUp(
  cfg: IngestConfig,
  maxBatches = 1000,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  for (let i = 0; i < maxBatches; i++) {
    const r = await ingestBatch(cfg);
    results.push(r);
    if (r.status !== 'ok' || r.fetched < (cfg.pageLimit ?? 200)) break;
  }
  return results;
}

export type { RawRpcEvent };
