import type { Sql } from 'postgres';

export const listReconciliationRuns = (sql: Sql, orgId: string, limit: number) =>
  sql`SELECT id, actor, summary, created_at FROM reconciliation_runs WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${limit}`;

/** A run with its results, or undefined when it does not exist in this organization. */
export async function findReconciliationRun(sql: Sql, orgId: string, id: string) {
  const [run] =
    await sql`SELECT id, actor, summary, created_at FROM reconciliation_runs WHERE id = ${id} AND org_id = ${orgId}`;
  if (!run) return undefined;
  const results = await sql`
    SELECT outcome, deposit_id, internal_record_id, detail FROM reconciliation_results
    WHERE run_id = ${id} AND org_id = ${orgId} ORDER BY id`;
  return { ...run, results };
}
