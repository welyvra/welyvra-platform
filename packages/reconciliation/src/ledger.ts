import type { CaseKind } from '@welyvra/core';
import type { Sql } from 'postgres';

/** Ledger accounts. Sign convention: on-chain holdings are positive, liabilities to customers negative. */
export const accounts = {
  onchain: (receivingAccountId: string) => `onchain:${receivingAccountId}`,
  customer: (customerId: string) => `customer:${customerId}`,
  unattributed: (receivingAccountId: string) => `unattributed:${receivingAccountId}`,
};

export interface DepositPosting {
  orgId: string;
  depositId: string;
  receivingAccountId: string;
  customerId: string | null;
  tokenContract: string;
  amount: bigint | string;
}

/** Balanced entry for a new deposit. Idempotent per deposit. Must run inside the deposit's transaction. */
export async function postDeposit(tx: Sql, d: DepositPosting): Promise<boolean> {
  const [entry] = await tx<{ id: string }[]>`
    INSERT INTO journal_entries (org_id, kind, source_ref) VALUES (${d.orgId}, 'deposit', ${d.depositId})
    ON CONFLICT (org_id, kind, source_ref) DO NOTHING RETURNING id`;
  if (!entry) return false;
  const credit = d.customerId
    ? accounts.customer(d.customerId)
    : accounts.unattributed(d.receivingAccountId);
  const amount = d.amount.toString();
  await tx`
    INSERT INTO postings (entry_id, org_id, account, asset, amount) VALUES
      (${entry.id}, ${d.orgId}, ${accounts.onchain(d.receivingAccountId)}, ${d.tokenContract}, ${amount}),
      (${entry.id}, ${d.orgId}, ${credit}, ${d.tokenContract}, ${'-' + amount})`;
  return true;
}

/** Opens a case once per (kind, subject). Returns the case id if it was created now. */
export async function openCase(
  tx: Sql,
  c: { orgId: string; kind: CaseKind; subjectRef: string; detail?: string | null; actor: string },
): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO exception_cases (org_id, kind, subject_ref, detail)
    VALUES (${c.orgId}, ${c.kind}::case_kind, ${c.subjectRef}, ${c.detail ?? null})
    ON CONFLICT (org_id, kind, subject_ref) DO NOTHING RETURNING id`;
  if (!row) return null;
  await tx`
    INSERT INTO case_events (case_id, org_id, actor, from_status, to_status, reason)
    VALUES (${row.id}, ${c.orgId}, ${c.actor}, NULL, 'open', 'detected')`;
  return row.id;
}

export async function audit(
  tx: Sql,
  a: {
    orgId: string | null;
    actor: string;
    action: string;
    subject: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx`
    INSERT INTO audit_log (org_id, actor, action, subject, before, after)
    VALUES (${a.orgId}, ${a.actor}, ${a.action}, ${a.subject},
            ${a.before === undefined ? null : JSON.stringify(a.before)}::jsonb,
            ${a.after === undefined ? null : JSON.stringify(a.after)}::jsonb)`;
}

export interface Balance {
  account: string;
  asset: string;
  amount: bigint;
}

export async function balances(sql: Sql, orgId: string): Promise<Balance[]> {
  const rows = await sql<{ account: string; asset: string; amount: string }[]>`
    SELECT account, asset, sum(amount)::text AS amount FROM postings WHERE org_id = ${orgId}
    GROUP BY account, asset HAVING sum(amount) <> 0 ORDER BY account, asset`;
  return rows.map((r) => ({ account: r.account, asset: r.asset, amount: BigInt(r.amount) }));
}
