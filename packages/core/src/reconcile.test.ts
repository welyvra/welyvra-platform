import { describe, expect, it } from 'vitest';
import {
  type DepositForMatch,
  type RecordForMatch,
  assertTransition,
  canTransition,
  reconcile,
  summarize,
} from './index.js';

const T = 'CTOKEN';
const h = (n: number) => n.toString(16).padStart(64, '0');
const dep = (id: string, over: Partial<DepositForMatch> = {}): DepositForMatch => ({
  id,
  eventId: `${id.padStart(19, '0')}-0000000000`,
  txHash: h(Number.parseInt(id, 10)),
  tokenContract: T,
  amount: 100n,
  customerId: 'alice',
  ...over,
});
const rec = (id: string, over: Partial<RecordForMatch> = {}): RecordForMatch => ({
  id: `r${id}`,
  externalId: `ext-${id}`,
  txHash: null,
  tokenContract: T,
  amount: 100n,
  customerId: 'alice',
  ...over,
});

describe('reconcile outcomes', () => {
  it('matches by tx hash, and by (customer, token, amount) when no hash is given', () => {
    const results = reconcile(
      [dep('1'), dep('2', { customerId: 'bob' })],
      [rec('a', { txHash: h(1) }), rec('b', { customerId: 'bob' })],
    );
    expect(results).toEqual([
      { outcome: 'matched', depositId: '1', recordId: 'ra' },
      { outcome: 'matched', depositId: '2', recordId: 'rb' },
    ]);
  });

  it('reports amount and customer mismatches when the tx hash matches', () => {
    const results = reconcile(
      [dep('1'), dep('2')],
      [rec('a', { txHash: h(1), amount: 90n }), rec('b', { txHash: h(2), customerId: 'mallory' })],
    );
    expect(results.map((r) => r.outcome)).toEqual(['amount_mismatch', 'customer_mismatch']);
    expect(results[0]!.detail).toBe('on-chain 100, internal 90');
  });

  it('an unattributed deposit referenced by tx hash with a customer is a customer mismatch', () => {
    expect(
      reconcile([dep('1', { customerId: null })], [rec('a', { txHash: h(1) })])[0]!.outcome,
    ).toBe('customer_mismatch');
  });

  it('reports missing on each side', () => {
    const results = reconcile([dep('1')], [rec('a', { amount: 5n })]);
    expect(summarize(results)).toMatchObject({
      missing_internal: 1,
      missing_onchain: 1,
      matched: 0,
    });
  });

  it('never matches across tokens', () => {
    expect(
      summarize(reconcile([dep('1')], [rec('a', { txHash: h(1), tokenContract: 'COTHER' })])),
    ).toMatchObject({
      missing_internal: 1,
      missing_onchain: 1,
    });
  });

  it('uses each deposit and record at most once', () => {
    const results = reconcile([dep('1')], [rec('a'), rec('b')]);
    expect(summarize(results)).toMatchObject({ matched: 1, missing_onchain: 1 });
  });

  it('is deterministic regardless of input order (200 random shuffles)', () => {
    const deposits = Array.from({ length: 12 }, (_, i) =>
      dep(String(i + 1), {
        amount: BigInt(100 + (i % 3)),
        customerId: i % 4 === 0 ? null : `c${i % 3}`,
      }),
    );
    const records = Array.from({ length: 10 }, (_, i) =>
      rec(String(i), {
        amount: BigInt(100 + (i % 3)),
        customerId: `c${i % 3}`,
        txHash: i % 2 ? h(i + 1) : null,
      }),
    );
    const canonical = JSON.stringify(reconcile(deposits, records), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const shuffle = <T>(a: T[]) =>
      a
        .map((v) => [rand(), v] as const)
        .sort((x, y) => x[0] - y[0])
        .map(([, v]) => v);
    for (let i = 0; i < 200; i++) {
      const r = JSON.stringify(reconcile(shuffle(deposits), shuffle(records)), (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(r).toBe(canonical);
    }
  });

  it('every input appears in exactly one result', () => {
    const deposits = Array.from({ length: 8 }, (_, i) =>
      dep(String(i + 1), { amount: BigInt(i) + 1n }),
    );
    const records = Array.from({ length: 8 }, (_, i) =>
      rec(String(i), { amount: BigInt(i) + 1n, txHash: i % 3 ? h(i + 1) : null }),
    );
    const results = reconcile(deposits, records);
    expect(
      results
        .filter((r) => r.depositId)
        .map((r) => r.depositId)
        .sort(),
    ).toEqual(deposits.map((d) => d.id).sort());
    expect(
      results
        .filter((r) => r.recordId)
        .map((r) => r.recordId)
        .sort(),
    ).toEqual(records.map((r) => r.id).sort());
  });
});

describe('case state machine', () => {
  it('allows only forward transitions', () => {
    expect(canTransition('open', 'investigating')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('investigating', 'dismissed')).toBe(true);
    for (const [from, to] of [
      ['resolved', 'open'],
      ['dismissed', 'open'],
      ['resolved', 'investigating'],
      ['investigating', 'open'],
      ['open', 'open'],
    ] as const) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(/invalid case transition/);
    }
  });
});
