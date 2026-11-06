import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { type Database, connect } from './client.js';
import { migrate } from './migrate.js';

/**
 * Creates an isolated, migrated schema for one test file. Requires DATABASE_URL
 * (see infra/docker/compose.yml). Fails loudly instead of skipping, so CI can never
 * report green without running database tests.
 */
export async function createTestDatabase(): Promise<Database & { schema: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for database tests. Run: docker compose -f infra/docker/compose.yml up -d',
    );
  }
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const database = connect(url, { searchPath: schema, max: 10 });
  await migrate(database.sql);
  return {
    ...database,
    schema,
    close: async () => {
      await database.close();
      const cleanup = postgres(url, { max: 1, onnotice: () => undefined });
      await cleanup.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}
