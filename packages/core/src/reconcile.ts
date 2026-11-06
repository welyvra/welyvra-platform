/**
 * Deterministic matching of on-chain deposits against the business's internal records.
 * Pure: same input, same output, regardless of input order.
 *
 * Matching order:
 *  1. Records that name a transaction hash match a deposit from that transaction
 *     (same token). Amount or customer differences are reported as mismatches.
 *  2. Remaining records match remaining attributed deposits on (customer, token, amount),
 *     oldest first (deposits by event id, records by external id).
 *  3. Leftovers are missing on one side.
 */
export interface DepositForMatch {
  id: string;
  eventId: string;
  txHash: string;
  tokenContract: string;
  amount: bigint;
  customerId: string | null;
}

export interface RecordForMatch {
  id: string;
  externalId: string;
  txHash: string | null;
  tokenContract: string;
  amount: bigint;
  customerId: string | null;
}

export type MatchOutcome =
  'matched' | 'missing_internal' | 'missing_onchain' | 'amount_mismatch' | 'customer_mismatch';

export interface MatchResult {
  outcome: MatchOutcome;
  depositId: string | null;
  recordId: string | null;
  detail?: string;
}

const byEventId = (a: DepositForMatch, b: DepositForMatch) =>
  a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
const byExternalId = (a: RecordForMatch, b: RecordForMatch) =>
  a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0;

export function reconcile(
  deposits: readonly DepositForMatch[],
  records: readonly RecordForMatch[],
): MatchResult[] {
  const remainingDeposits = [...deposits].sort(byEventId);
  const remainingRecords = [...records].sort(byExternalId);
  const results: MatchResult[] = [];
  const take = <T>(list: T[], i: number): T => list.splice(i, 1)[0] as T;

  // 1. By transaction hash.
  for (let r = 0; r < remainingRecords.length;) {
    const rec = remainingRecords[r] as RecordForMatch;
    if (!rec.txHash) {
      r++;
      continue;
    }
    const candidates = remainingDeposits
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.txHash === rec.txHash && d.tokenContract === rec.tokenContract);
    const exact = candidates.find(({ d }) => d.amount === rec.amount) ?? candidates[0];
    if (!exact) {
      r++;
      continue;
    }
    const dep = take(remainingDeposits, exact.i);
    take(remainingRecords, r);
    if (dep.amount !== rec.amount) {
      results.push({
        outcome: 'amount_mismatch',
        depositId: dep.id,
        recordId: rec.id,
        detail: `on-chain ${dep.amount}, internal ${rec.amount}`,
      });
    } else if (rec.customerId !== null && dep.customerId !== rec.customerId) {
      results.push({ outcome: 'customer_mismatch', depositId: dep.id, recordId: rec.id });
    } else {
      results.push({ outcome: 'matched', depositId: dep.id, recordId: rec.id });
    }
  }

  // 2. By (customer, token, amount).
  for (let r = 0; r < remainingRecords.length;) {
    const rec = remainingRecords[r] as RecordForMatch;
    const i = rec.customerId
      ? remainingDeposits.findIndex(
          (d) =>
            d.customerId === rec.customerId &&
            d.tokenContract === rec.tokenContract &&
            d.amount === rec.amount,
        )
      : -1;
    if (i < 0) {
      r++;
      continue;
    }
    const dep = take(remainingDeposits, i);
    take(remainingRecords, r);
    results.push({ outcome: 'matched', depositId: dep.id, recordId: rec.id });
  }

  // 3. Leftovers.
  for (const d of remainingDeposits)
    results.push({ outcome: 'missing_internal', depositId: d.id, recordId: null });
  for (const r of remainingRecords)
    results.push({ outcome: 'missing_onchain', depositId: null, recordId: r.id });
  return results;
}

export function summarize(results: readonly MatchResult[]): Record<MatchOutcome, number> {
  const s: Record<MatchOutcome, number> = {
    matched: 0,
    missing_internal: 0,
    missing_onchain: 0,
    amount_mismatch: 0,
    customer_mismatch: 0,
  };
  for (const r of results) s[r.outcome]++;
  return s;
}
