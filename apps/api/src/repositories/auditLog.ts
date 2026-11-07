import type { Sql } from 'postgres';

export const listAuditLog = (sql: Sql, orgId: string, limit: number) =>
  sql`SELECT id::text, actor, action, subject, before, after, at FROM audit_log WHERE org_id = ${orgId} ORDER BY id DESC LIMIT ${limit}`;

/** Ingestion cursors are shared infrastructure (per network and source), not tenant data. */
export const listSyncStatus = (sql: Sql) =>
  sql`SELECT network, source, last_ledger, status, status_detail, updated_at FROM ingestion_cursors ORDER BY network, source`;
