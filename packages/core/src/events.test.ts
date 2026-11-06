import { describe, expect, it } from 'vitest';
import { U64_MAX, compareEventIds, parseRoutingId, routingKeyEquals } from './index.js';

describe('parseRoutingId', () => {
  it('accepts 0 and u64 max', () => {
    expect(parseRoutingId('0')).toEqual({ kind: 'id', value: '0' });
    expect(parseRoutingId(U64_MAX.toString())).toEqual({
      kind: 'id',
      value: '18446744073709551615',
    });
  });
  it('normalizes leading zeros so "007" and "7" are the same key', () => {
    expect(parseRoutingId('007')).toEqual(parseRoutingId('7'));
  });
  it.each(['-1', '1.0', 'abc', '', '18446744073709551616'])('rejects %j', (bad) => {
    expect(() => parseRoutingId(bad)).toThrow(RangeError);
  });
});

describe('routingKeyEquals', () => {
  it('distinguishes kinds with the same value', () => {
    expect(routingKeyEquals({ kind: 'id', value: '42' }, { kind: 'text', value: '42' })).toBe(
      false,
    );
    expect(routingKeyEquals({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(routingKeyEquals({ kind: 'id', value: '1' }, { kind: 'id', value: '1' })).toBe(true);
  });
});

describe('compareEventIds', () => {
  it('orders by ledger/tx/op then event index', () => {
    const ids = [
      '0023976036454645760-0000000000',
      '0023976036454629376-0000000003',
      '0023976036454629376-0000000010',
    ];
    expect([...ids].sort(compareEventIds)).toEqual([
      '0023976036454629376-0000000003',
      '0023976036454629376-0000000010',
      '0023976036454645760-0000000000',
    ]);
  });
});
