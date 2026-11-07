import { one } from '@welyvra/db';
import type { Sql } from 'postgres';

export const listReceivingAccounts = (sql: Sql, orgId: string) =>
  sql`SELECT id, network, address, label, created_at FROM receiving_accounts WHERE org_id = ${orgId} ORDER BY created_at`;

export async function insertReceivingAccount(
  sql: Sql,
  orgId: string,
  input: { network: 'testnet' | 'mainnet'; address: string; label?: string },
) {
  return one(
    await sql`
      INSERT INTO receiving_accounts (org_id, network, address, label)
      VALUES (${orgId}, ${input.network}, ${input.address}, ${input.label ?? null})
      RETURNING id, network, address, label, created_at`,
  );
}
