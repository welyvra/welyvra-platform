// Test-only helpers shared by the ingestion test files.
import { readFileSync } from 'node:fs';
import type { RawRpcEvent } from '@welyvra/stellar';
import type { Sql } from 'postgres';

export const fixture = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/stellar/p30-testnet-events.json', import.meta.url),
    'utf8',
  ),
) as {
  accounts: Record<
    'sender' | 'receiver' | 'muxedAccount' | 'receivingContract' | 'muxedContract' | 'nativeSac',
    string
  >;
  transactions: Record<string, { hash: string; ledger: number }>;
  getEventsResult: { events: RawRpcEvent[] };
};

export const fixtureEvents = fixture.getEventsResult.events;
export const firstLedger = Math.min(...fixtureEvents.map((e) => e.ledger));

/** One org with the fixture's receiver (G) and receiving contract (C), and routing keys for 4 of the 6 payments. */
export async function seedFixtureOrg(sql: Sql) {
  const [org] = await sql<
    { id: string }[]
  >`INSERT INTO organizations (name) VALUES ('Fixture Org') RETURNING id`;
  const orgId = org!.id;
  const [g] = await sql<{ id: string }[]>`
    INSERT INTO receiving_accounts (org_id, network, address) VALUES (${orgId}, 'testnet', ${fixture.accounts.receiver}) RETURNING id`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO receiving_accounts (org_id, network, address) VALUES (${orgId}, 'testnet', ${fixture.accounts.receivingContract}) RETURNING id`;
  const customers: Record<string, string> = {};
  for (const ref of ['alice', 'bob', 'carol', 'dave']) {
    const [row] = await sql<
      { id: string }[]
    >`INSERT INTO customers (org_id, external_ref) VALUES (${orgId}, ${ref}) RETURNING id`;
    customers[ref] = row!.id;
  }
  const keys: [string, 'id' | 'text', string, string][] = [
    [g!.id, 'id', '1001', 'alice'], // memo id
    [g!.id, 'text', 'INV-42', 'bob'], // memo text
    [g!.id, 'id', '2002', 'carol'], // M address (classic and SAC payments)
    [c!.id, 'id', '3003', 'dave'], // W address
  ];
  for (const [acc, kind, value, ref] of keys) {
    await sql`INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
              VALUES (${orgId}, ${acc}, ${kind}::routing_kind, ${value}, ${customers[ref]!})`;
  }
  return { orgId, accountG: g!.id, accountC: c!.id, customers };
}

export async function counts(sql: Sql) {
  const [r] = await sql<
    { events: number; deposits: number; attributed: number; rejections: number }[]
  >`
    SELECT (SELECT count(*)::int FROM chain_events) AS events,
           (SELECT count(*)::int FROM deposits) AS deposits,
           (SELECT count(*)::int FROM deposits WHERE status = 'attributed') AS attributed,
           (SELECT count(*)::int FROM chain_event_rejections) AS rejections`;
  return r!;
}
