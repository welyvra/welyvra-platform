import { one } from '@welyvra/db';
import type { Sql } from 'postgres';

export const listCustomers = (sql: Sql, orgId: string, limit: number) => sql`
  SELECT c.id, c.external_ref, c.name, c.created_at,
    COALESCE(json_agg(json_build_object('receiving_account_id', k.receiving_account_id, 'kind', k.kind, 'value', k.value))
      FILTER (WHERE k.id IS NOT NULL), '[]') AS routing_keys
  FROM customers c LEFT JOIN routing_keys k ON k.customer_id = c.id AND k.org_id = c.org_id
  WHERE c.org_id = ${orgId} GROUP BY c.id ORDER BY c.created_at LIMIT ${limit}`;

export async function insertCustomer(
  sql: Sql,
  orgId: string,
  input: { external_ref: string; name?: string },
) {
  return one(
    await sql`
      INSERT INTO customers (org_id, external_ref, name) VALUES (${orgId}, ${input.external_ref}, ${input.name ?? null})
      RETURNING id, external_ref, name, created_at`,
  );
}

/** Composite foreign keys reject another tenant's account or customer (mapped to 404). */
export async function insertRoutingKey(
  sql: Sql,
  orgId: string,
  input: { customerId: string; receivingAccountId: string; kind: string; value: string },
) {
  return one(
    await sql`
      INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
      VALUES (${orgId}, ${input.receivingAccountId}, ${input.kind}::routing_kind, ${input.value}, ${input.customerId})
      RETURNING id, receiving_account_id, kind, value, customer_id`,
  );
}
