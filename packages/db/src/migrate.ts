import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import { inTransaction } from './client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Applies pending SQL migrations in file-name order, each in its own transaction. Idempotent. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  // Serialize concurrent migrators.
  return inTransaction(sql, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('welyvra_migrations'))`;
    const applied = new Set(
      (await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const done: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      await tx.unsafe(readFileSync(MIGRATIONS_DIR + file, 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      done.push(file);
    }
    return done;
  });
}
