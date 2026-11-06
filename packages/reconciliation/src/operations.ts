import { type CaseStatus, assertTransition, reconcile, summarize } from '@welyvra/core';
import { inTransaction } from '@welyvra/db';
import type { Sql } from 'postgres';
import { accounts, audit, openCase } from './ledger.js';

/** First row of a statement that must return exactly one row (e.g. INSERT ... RETURNING). */
function one<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('invariant: statement returned no row');
  return row;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/** Resolves an unattributed deposit to a customer: new balanced entry, deposit updated, case resolved, audited. */
export async function attributeDeposit(
  sql: Sql,
  p: { orgId: string; depositId: string; customerId: string; actor: string; reason: string },
): Promise<void> {
  if (!p.reason.trim()) throw new ConflictError('a reason is required');
  await inTransaction(sql, async (tx) => {
    const [d] = await tx<
      { status: string; receiving_account_id: string; token_contract: string; amount: string }[]
    >`
      SELECT status, receiving_account_id, token_contract, amount::text FROM deposits
      WHERE id = ${p.depositId} AND org_id = ${p.orgId} FOR UPDATE`;
    if (!d) throw new NotFoundError('deposit not found');
    if (d.status !== 'unattributed') throw new ConflictError('deposit is already attributed');
    const [c] =
      await tx`SELECT 1 FROM customers WHERE id = ${p.customerId} AND org_id = ${p.orgId}`;
    if (!c) throw new NotFoundError('customer not found');

    await tx`UPDATE deposits SET status = 'attributed', customer_id = ${p.customerId} WHERE id = ${p.depositId} AND org_id = ${p.orgId}`;
    const entry = one(
      await tx<{ id: string }[]>`
      INSERT INTO journal_entries (org_id, kind, source_ref, memo)
      VALUES (${p.orgId}, 'reattribution', ${p.depositId}, ${p.reason}) RETURNING id`,
    );
    await tx`
      INSERT INTO postings (entry_id, org_id, account, asset, amount) VALUES
        (${entry.id}, ${p.orgId}, ${accounts.unattributed(d.receiving_account_id)}, ${d.token_contract}, ${d.amount}),
        (${entry.id}, ${p.orgId}, ${accounts.customer(p.customerId)}, ${d.token_contract}, ${'-' + d.amount})`;

    const cases = await tx<{ id: string; status: CaseStatus }[]>`
      SELECT id, status FROM exception_cases
      WHERE org_id = ${p.orgId} AND kind = 'unattributed_deposit' AND subject_ref = ${'deposit:' + p.depositId}
        AND status IN ('open', 'investigating') FOR UPDATE`;
    for (const cs of cases) {
      await tx`UPDATE exception_cases SET status = 'resolved' WHERE id = ${cs.id}`;
      await tx`INSERT INTO case_events (case_id, org_id, actor, from_status, to_status, reason)
               VALUES (${cs.id}, ${p.orgId}, ${p.actor}, ${cs.status}, 'resolved', ${p.reason})`;
    }
    await audit(tx, {
      orgId: p.orgId,
      actor: p.actor,
      action: 'deposit.attribute',
      subject: `deposit:${p.depositId}`,
      before: { status: 'unattributed', customerId: null },
      after: { status: 'attributed', customerId: p.customerId, reason: p.reason },
    });
  });
}

export async function transitionCase(
  sql: Sql,
  p: { orgId: string; caseId: string; to: CaseStatus; actor: string; reason: string },
): Promise<void> {
  if (!p.reason.trim()) throw new ConflictError('a reason is required');
  await inTransaction(sql, async (tx) => {
    const [c] = await tx<{ status: CaseStatus }[]>`
      SELECT status FROM exception_cases WHERE id = ${p.caseId} AND org_id = ${p.orgId} FOR UPDATE`;
    if (!c) throw new NotFoundError('case not found');
    assertTransition(c.status, p.to);
    await tx`UPDATE exception_cases SET status = ${p.to}::case_status WHERE id = ${p.caseId}`;
    await tx`INSERT INTO case_events (case_id, org_id, actor, from_status, to_status, reason)
             VALUES (${p.caseId}, ${p.orgId}, ${p.actor}, ${c.status}, ${p.to}::case_status, ${p.reason})`;
    await audit(tx, {
      orgId: p.orgId,
      actor: p.actor,
      action: 'case.transition',
      subject: `case:${p.caseId}`,
      before: { status: c.status },
      after: { status: p.to, reason: p.reason },
    });
  });
}

export interface InternalRecordInput {
  externalId: string;
  customerId?: string | null;
  tokenContract: string;
  amount: bigint;
  txHash?: string | null;
}

export interface InternalRecordsResult {
  created: number;
  duplicates: number;
  /** Same external id resubmitted with different content: rejected, never overwritten. */
  conflicts: string[];
}

/** Idempotent by (org, external id). Records are immutable once accepted. */
export async function recordInternalRecords(
  sql: Sql,
  orgId: string,
  actor: string,
  records: InternalRecordInput[],
): Promise<InternalRecordsResult> {
  return inTransaction(sql, async (tx) => {
    const out: InternalRecordsResult = { created: 0, duplicates: 0, conflicts: [] };
    for (const r of records) {
      const customerId = r.customerId ?? null;
      const txHash = r.txHash ?? null;
      const inserted = await tx`
        INSERT INTO internal_records (org_id, external_id, customer_id, token_contract, amount, tx_hash)
        VALUES (${orgId}, ${r.externalId}, ${customerId}, ${r.tokenContract}, ${r.amount.toString()}, ${txHash})
        ON CONFLICT (org_id, external_id) DO NOTHING RETURNING id`;
      if (inserted.length) {
        out.created++;
        continue;
      }
      const [existing] = await tx<
        {
          customer_id: string | null;
          token_contract: string;
          amount: string;
          tx_hash: string | null;
        }[]
      >`
        SELECT customer_id, token_contract, amount::text, tx_hash FROM internal_records WHERE org_id = ${orgId} AND external_id = ${r.externalId}`;
      const same =
        existing &&
        existing.customer_id === customerId &&
        existing.token_contract === r.tokenContract &&
        existing.amount === r.amount.toString() &&
        existing.tx_hash === txHash;
      if (same) out.duplicates++;
      else out.conflicts.push(r.externalId);
    }
    if (out.created)
      await audit(tx, {
        orgId,
        actor,
        action: 'internal_records.create',
        subject: `org:${orgId}`,
        after: { created: out.created },
      });
    return out;
  });
}

export interface ReconciliationRun {
  runId: string;
  summary: ReturnType<typeof summarize>;
  casesOpened: number;
}

/** Runs a full reconciliation for one organization. Deterministic and safe to repeat. */
export async function runReconciliation(
  sql: Sql,
  p: { orgId: string; actor: string },
): Promise<ReconciliationRun> {
  return inTransaction(sql, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'reconcile:' + p.orgId}))`;
    const deposits = await tx<
      {
        id: string;
        event_id: string;
        tx_hash: string;
        token_contract: string;
        amount: string;
        customer_id: string | null;
      }[]
    >`
      SELECT d.id, ce.event_id, ce.tx_hash, d.token_contract, d.amount::text, d.customer_id
      FROM deposits d JOIN chain_events ce ON ce.id = d.chain_event_id WHERE d.org_id = ${p.orgId}`;
    const records = await tx<
      {
        id: string;
        external_id: string;
        tx_hash: string | null;
        token_contract: string;
        amount: string;
        customer_id: string | null;
      }[]
    >`
      SELECT id, external_id, tx_hash, token_contract, amount::text, customer_id FROM internal_records WHERE org_id = ${p.orgId}`;

    const results = reconcile(
      deposits.map((d) => ({
        id: d.id,
        eventId: d.event_id,
        txHash: d.tx_hash,
        tokenContract: d.token_contract,
        amount: BigInt(d.amount),
        customerId: d.customer_id,
      })),
      records.map((r) => ({
        id: r.id,
        externalId: r.external_id,
        txHash: r.tx_hash,
        tokenContract: r.token_contract,
        amount: BigInt(r.amount),
        customerId: r.customer_id,
      })),
    );
    const summary = summarize(results);
    const run = one(
      await tx<{ id: string }[]>`
      INSERT INTO reconciliation_runs (org_id, actor, summary) VALUES (${p.orgId}, ${p.actor}, ${JSON.stringify(summary)}::jsonb) RETURNING id`,
    );
    let casesOpened = 0;
    for (const r of results) {
      await tx`
        INSERT INTO reconciliation_results (run_id, org_id, outcome, deposit_id, internal_record_id, detail)
        VALUES (${run.id}, ${p.orgId}, ${r.outcome}::reconciliation_outcome, ${r.depositId}, ${r.recordId}, ${r.detail ?? null})`;
      if (r.outcome === 'matched') continue;
      const subjectRef = [
        r.depositId && `deposit:${r.depositId}`,
        r.recordId && `record:${r.recordId}`,
      ]
        .filter(Boolean)
        .join('|');
      if (
        await openCase(tx, {
          orgId: p.orgId,
          kind: r.outcome,
          subjectRef,
          detail: r.detail ?? null,
          actor: p.actor,
        })
      )
        casesOpened++;
    }
    await audit(tx, {
      orgId: p.orgId,
      actor: p.actor,
      action: 'reconciliation.run',
      subject: `run:${run.id}`,
      after: summary,
    });
    return { runId: run.id, summary, casesOpened };
  });
}
