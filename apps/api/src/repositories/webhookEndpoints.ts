import { one } from '@welyvra/db';
import type { Sql } from 'postgres';

export const listWebhookEndpoints = (sql: Sql, orgId: string) =>
  sql`SELECT id, url, active, created_at FROM webhook_endpoints WHERE org_id = ${orgId} ORDER BY created_at`;

/** The signing secret is stored encrypted; the ciphertext is never returned. */
export async function insertWebhookEndpoint(
  sql: Sql,
  orgId: string,
  input: { url: string; secretCiphertext: string },
) {
  return one(
    await sql`
      INSERT INTO webhook_endpoints (org_id, url, secret_ciphertext) VALUES (${orgId}, ${input.url}, ${input.secretCiphertext})
      RETURNING id, url, active, created_at`,
  );
}
