import type { Sql } from 'postgres';

const COLUMNS = (sql: Sql) => sql`
  d.id, d.status, d.customer_id, d.receiving_account_id, d.token_contract, d.amount::text AS amount,
  ce.event_id, ce.tx_hash, ce.ledger, ce.ledger_closed_at, ce.from_address, ce.routing_kind, ce.routing_value, d.created_at`;

export const listDeposits = (
  sql: Sql,
  orgId: string,
  filter: { status?: string | undefined; customerId?: string | undefined; limit: number },
) => sql`
  SELECT ${COLUMNS(sql)}
  FROM deposits d JOIN chain_events ce ON ce.id = d.chain_event_id
  WHERE d.org_id = ${orgId}
    ${filter.status ? sql`AND d.status = ${filter.status}::deposit_status` : sql``}
    ${filter.customerId ? sql`AND d.customer_id = ${filter.customerId}` : sql``}
  ORDER BY ce.event_id DESC LIMIT ${filter.limit}`;

export async function findDeposit(sql: Sql, orgId: string, id: string) {
  const [row] = await sql`
    SELECT ${COLUMNS(sql)}
    FROM deposits d JOIN chain_events ce ON ce.id = d.chain_event_id WHERE d.id = ${id} AND d.org_id = ${orgId}`;
  return row;
}
