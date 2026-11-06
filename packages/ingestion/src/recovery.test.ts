import { createTestDatabase } from '@welyvra/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { counts, firstLedger, fixture, fixtureEvents, seedFixtureOrg } from './fixtures.js';
import {
  type BatchStep,
  type IngestConfig,
  ingestBatch,
  ingestUntilCaughtUp,
  runWorker,
} from './index.js';
import { RecordedEventSource } from './testing.js';

let t: Awaited<ReturnType<typeof createTestDatabase>>;
beforeEach(async () => {
  t = await createTestDatabase();
  await seedFixtureOrg(t.sql);
});
afterEach(async () => {
  await t?.close();
});

const EXPECTED = { events: 6, deposits: 6, attributed: 5, rejections: 0 };
const config = (source: RecordedEventSource, over: Partial<IngestConfig> = {}): IngestConfig => ({
  sql: t.sql,
  source,
  network: 'testnet',
  sourceName: 'test',
  tokenContracts: [fixture.accounts.nativeSac],
  startLedger: firstLedger,
  pageLimit: 3,
  ...over,
});
const cursorRow = async () =>
  (
    await t.sql<{ last_ledger: number; last_cursor: string | null; status: string }[]>`
    SELECT last_ledger, last_cursor, status FROM ingestion_cursors`
  )[0];

describe('replays', () => {
  it('ingesting every event 3 times (duplicates in the same page and across runs) yields identical rows', async () => {
    const tripled = [...fixtureEvents, ...fixtureEvents, ...fixtureEvents];
    await ingestUntilCaughtUp(config(new RecordedEventSource(tripled)));
    expect(await counts(t.sql)).toEqual(EXPECTED);
    // Reset the cursor to force a full re-ingestion of the same data.
    await t.sql`DELETE FROM ingestion_cursors`;
    await ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents)));
    await t.sql`DELETE FROM ingestion_cursors`;
    await ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents), { pageLimit: 1 }));
    expect(await counts(t.sql)).toEqual(EXPECTED);
  });

  it('final state does not depend on page size', async () => {
    const snapshot = async () =>
      t.sql`SELECT ce.event_id, d.status, d.customer_id, d.amount::text FROM deposits d
            JOIN chain_events ce ON ce.id = d.chain_event_id ORDER BY ce.event_id`;
    await ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents), { pageLimit: 1 }));
    const a = await snapshot();
    for (const pageLimit of [2, 5, 200]) {
      const other = await createTestDatabase();
      try {
        await seedFixtureOrg(other.sql);
        await ingestUntilCaughtUp({
          ...config(new RecordedEventSource(fixtureEvents), { pageLimit }),
          sql: other.sql,
        });
        const b = await other.sql`SELECT ce.event_id, d.status, d.amount::text FROM deposits d
                                  JOIN chain_events ce ON ce.id = d.chain_event_id ORDER BY ce.event_id`;
        expect(b).toEqual(a.map(({ event_id, status, amount }) => ({ event_id, status, amount })));
      } finally {
        await other.close();
      }
    }
  });
});

describe('crash in the middle of a batch', () => {
  const steps: BatchStep[] = [
    'after_lock',
    'after_events',
    'after_deposits',
    'before_cursor',
    'after_cursor',
  ];

  it.each(steps)(
    'crash at %s leaves no partial state; restart produces no gaps and no duplicates',
    async (step) => {
      const source = new RecordedEventSource(fixtureEvents);
      let armed = true;
      const faulty = config(source, {
        faultInjector: (s) => {
          if (armed && s === step) {
            armed = false;
            throw new Error(`simulated crash at ${s}`);
          }
        },
      });
      await expect(ingestBatch(faulty)).rejects.toThrow(/simulated crash/);
      // The failed batch rolled back completely.
      expect(await counts(t.sql)).toEqual({ events: 0, deposits: 0, attributed: 0, rejections: 0 });
      expect(await cursorRow()).toBeUndefined();

      await ingestUntilCaughtUp(faulty); // restart (fault no longer armed)
      expect(await counts(t.sql)).toEqual(EXPECTED);
    },
  );

  it('crash on a later batch keeps earlier committed batches and resumes after them', async () => {
    const source = new RecordedEventSource(fixtureEvents);
    let batch = 0;
    const faulty = config(source, {
      pageLimit: 2,
      faultInjector: (s) => {
        if (s === 'before_cursor' && ++batch === 3) throw new Error('simulated crash');
      },
    });
    await expect(ingestUntilCaughtUp(faulty)).rejects.toThrow(/simulated crash/);
    const committed = await counts(t.sql);
    expect(committed.events).toBeLessThan(6);
    await ingestUntilCaughtUp(config(source, { pageLimit: 2 }));
    expect(await counts(t.sql)).toEqual(EXPECTED);
  });
});

describe('concurrency', () => {
  it('5 workers on the same stream never double-insert', async () => {
    const runs = Array.from({ length: 5 }, () =>
      ingestUntilCaughtUp(config(new RecordedEventSource(fixtureEvents))),
    );
    const results = (await Promise.all(runs)).flat();
    expect(await counts(t.sql)).toEqual(EXPECTED);
    expect(results.some((r) => r.status === 'stale')).toBe(true); // losers detected the moved cursor
  });
});

describe('gaps beyond RPC retention', () => {
  it('detects a cursor older than the oldest ledger, marks the stream and never advances', async () => {
    const source = new RecordedEventSource(fixtureEvents);
    await ingestUntilCaughtUp(config(source));
    const before = await cursorRow();

    // Worker was down too long: RPC no longer has the ledgers after our cursor.
    source.oldestLedger = before!.last_ledger + 100;
    const r = await ingestBatch(config(source));
    expect(r.status).toBe('gap_detected');
    const after = await cursorRow();
    expect(after).toMatchObject({
      status: 'gap_detected',
      last_ledger: before!.last_ledger,
      last_cursor: before!.last_cursor,
    });

    // Subsequent runs refuse to continue without fetching (needs operator action / backfill).
    const calls = source.calls;
    expect((await ingestBatch(config(source))).status).toBe('gap_detected');
    expect(source.calls).toBe(calls);
  });

  it('detects a first start older than retention', async () => {
    const source = new RecordedEventSource(fixtureEvents, firstLedger + 1);
    expect((await ingestBatch(config(source))).status).toBe('gap_detected');
    expect((await cursorRow())?.status).toBe('gap_detected');
    expect((await counts(t.sql)).deposits).toBe(0);
  });

  it('the worker stops on a gap instead of reporting in sync', async () => {
    const source = new RecordedEventSource(fixtureEvents, firstLedger + 1);
    const logs: string[] = [];
    await runWorker({ ...config(source), pollIntervalMs: 1, log: (m) => logs.push(m) });
    expect(logs).toContain('ingest.gap_detected');
  });
});

describe('new events after catching up', () => {
  it('picks up events that arrive later without reprocessing old ones', async () => {
    const early = fixtureEvents.filter((e) => e.ledger <= firstLedger + 5);
    const late = fixtureEvents.filter((e) => e.ledger > firstLedger + 5);
    const source = new RecordedEventSource(early);
    await ingestUntilCaughtUp(config(source));
    const mid = await counts(t.sql);
    source.push(...late);
    await ingestUntilCaughtUp(config(source));
    expect(await counts(t.sql)).toEqual(EXPECTED);
    expect(mid.deposits).toBeLessThan(EXPECTED.deposits);
  });
});
