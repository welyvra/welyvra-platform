import { createTestDatabase } from '@welyvra/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { counts, firstLedger, fixture, fixtureEvents, seedFixtureOrg } from './fixtures.js';
import { type IngestConfig, assertNetworkAllowed, ingestUntilCaughtUp } from './index.js';
import { RecordedEventSource } from './testing.js';

let t: Awaited<ReturnType<typeof createTestDatabase>>;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.close();
});

const config = (source: RecordedEventSource, over: Partial<IngestConfig> = {}): IngestConfig => ({
  sql: t.sql,
  source,
  network: 'testnet',
  sourceName: 'test',
  tokenContracts: [fixture.accounts.nativeSac],
  startLedger: firstLedger,
  pageLimit: 4,
  ...over,
});

describe('ingestion from recorded testnet events', () => {
  it('creates one deposit per payment and attributes memo, M and W payments', async () => {
    const seed = await seedFixtureOrg(t.sql);
    const results = await ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents)));
    expect(results.every((r) => r.status === 'ok')).toBe(true);

    expect(await counts(t.sql)).toEqual({ events: 6, deposits: 6, attributed: 5, rejections: 0 });
    const rows = await t.sql<
      { ref: string | null; status: string; amount: string; account: string }[]
    >`
      SELECT c.external_ref AS ref, d.status, d.amount::text, d.receiving_account_id AS account
      FROM deposits d LEFT JOIN customers c ON c.id = d.customer_id ORDER BY d.amount`;
    expect(rows).toEqual([
      { ref: 'alice', status: 'attributed', amount: '10000001', account: seed.accountG }, // memo id 1001
      { ref: 'bob', status: 'attributed', amount: '15000000', account: seed.accountG }, // memo text INV-42
      { ref: 'carol', status: 'attributed', amount: '20000000', account: seed.accountG }, // M address
      { ref: null, status: 'unattributed', amount: '30000000', account: seed.accountC }, // plain C, no id
      { ref: 'dave', status: 'attributed', amount: '40000000', account: seed.accountC }, // W address
      { ref: 'carol', status: 'attributed', amount: '50000000', account: seed.accountG }, // SAC to M
    ]);
  });

  it('ignores fee events and payments to accounts nobody registered', async () => {
    const results = await ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents)));
    expect(await counts(t.sql)).toEqual({ events: 0, deposits: 0, attributed: 0, rejections: 0 });
    expect(results.reduce((s, r) => s + r.ignored, 0)).toBe(fixtureEvents.length);
  });

  it('records malformed events as rejections instead of dropping them', async () => {
    await seedFixtureOrg(t.sql);
    const bad = { ...fixtureEvents[1]!, id: '9999999999999999999-0000000000', value: 'garbage' };
    await ingestUntilCaughtUp(config(new RecordedEventSource([...fixtureEvents, bad])));
    const rejections = await t.sql<
      { event_id: string; reason: string }[]
    >`SELECT event_id, reason FROM chain_event_rejections`;
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.reason).toMatch(/undecodable/);
  });

  it('persists the cursor and resumes from it on the next run', async () => {
    await seedFixtureOrg(t.sql);
    const source = new RecordedEventSource(fixtureEvents);
    await ingestUntilCaughtUp(config(source));
    const [cursor] = await t.sql<
      { last_cursor: string; last_ledger: number }[]
    >`SELECT last_cursor, last_ledger FROM ingestion_cursors`;
    expect(cursor!.last_ledger).toBe(Math.max(...fixtureEvents.map((e) => e.ledger)));
    const again = await ingestUntilCaughtUp(config(source));
    expect(again[0]!.fetched).toBe(0);
  });
});

describe('network guard', () => {
  it('refuses mainnet unless explicitly allowed', () => {
    expect(() => assertNetworkAllowed('mainnet', undefined)).toThrow(/Refusing to ingest mainnet/);
    expect(() => assertNetworkAllowed('mainnet', false)).toThrow();
    expect(() => assertNetworkAllowed('mainnet', true)).not.toThrow();
    expect(() => assertNetworkAllowed('testnet', undefined)).not.toThrow();
  });
});
