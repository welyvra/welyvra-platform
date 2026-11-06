import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface Database {
  sql: Sql;
  db: Db;
  close: () => Promise<void>;
}

/**
 * Runs `fn` in one transaction. postgres.js types `TransactionSql` without a call
 * signature under TS 5.x; at runtime it is a full `Sql`, so we expose it as such.
 */
export function inTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as unknown as Sql)) as Promise<T>;
}

export function connect(
  url: string,
  options: { searchPath?: string; max?: number } = {},
): Database {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
    // NUMERIC stays a string at the driver level; schema.money converts it to bigint.
    ...(options.searchPath ? { connection: { search_path: options.searchPath } } : {}),
  });
  return { sql, db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
}
