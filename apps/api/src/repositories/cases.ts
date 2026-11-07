import type { Sql } from 'postgres';

export const listCases = (
  sql: Sql,
  orgId: string,
  filter: { status?: string | undefined; limit: number },
) => sql`
  SELECT id, kind, status, subject_ref, detail, created_at, updated_at FROM exception_cases
  WHERE org_id = ${orgId} ${filter.status ? sql`AND status = ${filter.status}::case_status` : sql``}
  ORDER BY created_at DESC LIMIT ${filter.limit}`;

/** A case with its history, or undefined when it does not exist in this organization. */
export async function findCase(sql: Sql, orgId: string, id: string) {
  const [c] =
    await sql`SELECT id, kind, status, subject_ref, detail, created_at, updated_at FROM exception_cases WHERE id = ${id} AND org_id = ${orgId}`;
  if (!c) return undefined;
  const events =
    await sql`SELECT actor, from_status, to_status, reason, at FROM case_events WHERE case_id = ${id} AND org_id = ${orgId} ORDER BY id`;
  return { ...c, events };
}
