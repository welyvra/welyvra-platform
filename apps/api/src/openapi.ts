import type { Sql } from 'postgres';
import { buildApp } from './app.js';

/** Generates the OpenAPI document from the route schemas (no database needed). */
export async function buildOpenApi(): Promise<string> {
  const app = await buildApp({ sql: {} as Sql, webhookEncryptionKey: '0'.repeat(64) });
  await app.ready();
  const doc = JSON.stringify(app.swagger(), null, 2);
  await app.close();
  return doc;
}
