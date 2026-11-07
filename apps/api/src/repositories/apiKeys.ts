import { one } from '@welyvra/db';
import type { Sql } from 'postgres';
import type { Role } from '../middleware/auth.js';

export interface ApiKeyRow {
  id: string;
  org_id: string;
  role: Role;
  secret_hash: string;
}

/** Looks up an active (not revoked) key by its public prefix. */
export async function findActiveApiKey(sql: Sql, prefix: string): Promise<ApiKeyRow | undefined> {
  const [key] = await sql<ApiKeyRow[]>`
    SELECT id, org_id, role, secret_hash FROM api_keys WHERE prefix = ${prefix} AND revoked_at IS NULL`;
  return key;
}

/** Stores only the hash of the secret. The caller returns the full key to the user once. */
export async function insertApiKey(
  sql: Sql,
  orgId: string,
  input: { name: string; role: Role; prefix: string; secretHash: string },
) {
  return one(
    await sql<{ id: string; name: string; role: Role; created_at: Date }[]>`
      INSERT INTO api_keys (org_id, name, prefix, secret_hash, role)
      VALUES (${orgId}, ${input.name}, ${input.prefix}, ${input.secretHash}, ${input.role})
      RETURNING id, name, role, created_at`,
  );
}
