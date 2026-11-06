/**
 * Demo seeding shared by `pnpm demo` and the Playwright end-to-end tests.
 * Testnet and fictional data only.
 */
import { readFileSync } from 'node:fs';
import { generateApiKey } from '@welyvra/api/security';
import { connect, migrate } from '@welyvra/db';
import { ingestUntilCaughtUp } from '@welyvra/ingestion';
import { RecordedEventSource } from '@welyvra/ingestion/testing';
import { balances, recordInternalRecords, runReconciliation } from '@welyvra/reconciliation';
import { type EventSource, RpcEventSource } from '@welyvra/stellar';
import postgres from 'postgres';

export interface Capture {
  accounts: Record<
    'sender' | 'receiver' | 'muxedAccount' | 'receivingContract' | 'muxedContract' | 'nativeSac',
    string
  >;
  transactions: Record<string, { hash: string; ledger: number }>;
  getEventsResult: { events: { ledger: number }[] };
}

export const FIXTURE = new URL(
  '../../tests/fixtures/stellar/p30-testnet-events.json',
  import.meta.url,
);

/** Drops and recreates a database next to the one in `adminUrl`. */
export async function freshDatabase(adminUrl: string, name: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid database name');
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export interface DemoResult {
  orgId: string;
  apiKey: string;
  customers: Record<string, string>;
  capture: Capture;
}

export async function seedDemo(
  databaseUrl: string,
  capture: Capture,
  source: EventSource,
): Promise<DemoResult> {
  const { sql, close } = connect(databaseUrl);
  try {
    await migrate(sql);
    const [org] = await sql<
      { id: string }[]
    >`INSERT INTO organizations (name) VALUES ('Demo Payments') RETURNING id`;
    const orgId = org!.id;
    const key = generateApiKey();
    await sql`INSERT INTO api_keys (org_id, name, prefix, secret_hash, role) VALUES (${orgId}, 'demo admin', ${key.prefix}, ${key.secretHash}, 'admin')`;
    const [g] = await sql<{ id: string }[]>`
      INSERT INTO receiving_accounts (org_id, network, address, label) VALUES (${orgId}, 'testnet', ${capture.accounts.receiver}, 'Main deposit account') RETURNING id`;
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO receiving_accounts (org_id, network, address, label) VALUES (${orgId}, 'testnet', ${capture.accounts.receivingContract}, 'Smart account') RETURNING id`;
    const customers: Record<string, string> = {};
    for (const [ref, name] of [
      ['alice', 'Alice Mora'],
      ['bob', 'Bob Rojas'],
      ['carol', 'Carol Vega'],
      ['dave', 'Dave Solís'],
    ] as const) {
      const [row] = await sql<
        { id: string }[]
      >`INSERT INTO customers (org_id, external_ref, name) VALUES (${orgId}, ${ref}, ${name}) RETURNING id`;
      customers[ref] = row!.id;
    }
    // memo id 1001, memo text INV-42, M address id 2002, W address id 3003. The plain C transfer has no key.
    for (const [acc, kind, value, ref] of [
      [g!.id, 'id', '1001', 'alice'],
      [g!.id, 'text', 'INV-42', 'bob'],
      [g!.id, 'id', '2002', 'carol'],
      [c!.id, 'id', '3003', 'dave'],
    ] as const) {
      await sql`INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
                VALUES (${orgId}, ${acc}, ${kind}::routing_kind, ${value}, ${customers[ref]!})`;
    }

    const startLedger = Math.min(...Object.values(capture.transactions).map((t) => t.ledger));
    const endLedger = Math.max(...Object.values(capture.transactions).map((t) => t.ledger));
    const cfg = {
      sql,
      source,
      network: 'testnet' as const,
      sourceName: 'demo',
      tokenContracts: [capture.accounts.nativeSac],
      startLedger,
      pageLimit: 200,
    };
    // Ingest twice on purpose: the second pass replays nothing new and must not change anything.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 200; i++) {
        const batches = await ingestUntilCaughtUp(cfg, 20);
        const [cur] = await sql<
          { last_ledger: number }[]
        >`SELECT last_ledger FROM ingestion_cursors WHERE source = 'demo'`;
        if (!cur || cur.last_ledger >= endLedger || batches.at(-1)!.fetched < 200) break;
      }
      if (pass === 0)
        await sql`UPDATE ingestion_cursors SET last_cursor = NULL, last_ledger = ${startLedger - 1} WHERE source = 'demo'`;
    }

    const native = capture.accounts.nativeSac;
    await recordInternalRecords(sql, orgId, 'demo', [
      {
        externalId: 'INV-1001',
        customerId: customers.alice!,
        tokenContract: native,
        amount: 10000001n,
        txHash: capture.transactions.memo!.hash,
      },
      {
        externalId: 'INV-1002',
        customerId: customers.bob!,
        tokenContract: native,
        amount: 15000000n,
      },
      {
        externalId: 'INV-1003',
        customerId: customers.carol!,
        tokenContract: native,
        amount: 19000000n,
        txHash: capture.transactions.muxedAccount!.hash,
      },
      {
        externalId: 'INV-1004',
        customerId: customers.dave!,
        tokenContract: native,
        amount: 99000000n,
      },
    ]);
    await runReconciliation(sql, { orgId, actor: 'demo' });
    return { orgId, apiKey: key.key, customers, capture };
  } finally {
    await close();
  }
}

export interface InvariantReport {
  deposits: number;
  attributed: number;
  openCases: Record<string, number>;
  onchainTotal: bigint;
  violations: string[];
}

/** Checks the money invariants of the demo. Any violation makes `pnpm demo` exit non-zero. */
export async function verifyInvariants(
  databaseUrl: string,
  orgId: string,
  expectedDeposits: number,
): Promise<InvariantReport> {
  const { sql, close } = connect(databaseUrl);
  try {
    const violations: string[] = [];
    const [{ deposits, attributed, dupes }] = (await sql`
      SELECT (SELECT count(*)::int FROM deposits WHERE org_id = ${orgId}) AS deposits,
             (SELECT count(*)::int FROM deposits WHERE org_id = ${orgId} AND status = 'attributed') AS attributed,
             (SELECT count(*)::int FROM (SELECT event_id FROM chain_events GROUP BY network, event_id HAVING count(*) > 1) d) AS dupes`) as unknown as [
      { deposits: number; attributed: number; dupes: number },
    ];
    if (deposits !== expectedDeposits)
      violations.push(`expected ${expectedDeposits} deposits, found ${deposits}`);
    if (dupes) violations.push(`${dupes} duplicated chain events`);
    const b = await balances(sql, orgId);
    const total = b.reduce((s, r) => s + r.amount, 0n);
    if (total !== 0n) violations.push(`ledger does not balance: ${total}`);
    const onchainTotal = b
      .filter((r) => r.account.startsWith('onchain:'))
      .reduce((s, r) => s + r.amount, 0n);
    const [{ sum }] =
      (await sql`SELECT COALESCE(sum(amount), 0)::text AS sum FROM deposits WHERE org_id = ${orgId}`) as unknown as [
        { sum: string },
      ];
    if (onchainTotal !== BigInt(sum))
      violations.push(`on-chain postings ${onchainTotal} != deposits ${sum}`);
    const unbalanced =
      await sql`SELECT entry_id FROM postings GROUP BY entry_id, asset HAVING sum(amount) <> 0`;
    if (unbalanced.length) violations.push(`${unbalanced.length} unbalanced entries`);
    const cases = await sql<{ kind: string; n: number }[]>`
      SELECT kind::text, count(*)::int AS n FROM exception_cases WHERE org_id = ${orgId} AND status = 'open' GROUP BY kind ORDER BY kind`;
    return {
      deposits,
      attributed,
      openCases: Object.fromEntries(cases.map((c) => [c.kind, c.n])),
      onchainTotal,
      violations,
    };
  } finally {
    await close();
  }
}

export function loadCapture(path: URL | string = FIXTURE): Capture {
  return JSON.parse(readFileSync(path, 'utf8')) as Capture;
}

export function recordedSource(capture: Capture): EventSource {
  return new RecordedEventSource(capture.getEventsResult.events as never);
}

export function liveSource(): EventSource {
  return new RpcEventSource({
    url: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  });
}
