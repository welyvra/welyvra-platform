import { describe, expect, it } from 'vitest';
import {
  I128_MAX,
  I128_MIN,
  addAmounts,
  amount,
  formatAmount,
  parseAmount,
  parseUnits,
} from './index.js';

describe('parseUnits', () => {
  it('parses integers beyond Number.MAX_SAFE_INTEGER exactly', () => {
    expect(parseUnits('9007199254740993')).toBe(9007199254740993n);
  });
  it('accepts zero, negatives and the i128 bounds', () => {
    expect(parseUnits('0')).toBe(0n);
    expect(parseUnits('-1')).toBe(-1n);
    expect(parseUnits(I128_MAX.toString())).toBe(I128_MAX);
    expect(parseUnits(I128_MIN.toString())).toBe(I128_MIN);
  });
  it.each(['', '1.5', '1e3', ' 1', '0x10', 'abc', '--1', '+1'])('rejects %j', (bad) => {
    expect(() => parseUnits(bad)).toThrow(RangeError);
  });
  it('rejects values outside i128', () => {
    expect(() => parseUnits((I128_MAX + 1n).toString())).toThrow(RangeError);
    expect(() => parseUnits((I128_MIN - 1n).toString())).toThrow(RangeError);
  });
});

describe('amount', () => {
  it('rejects JavaScript numbers', () => {
    expect(() => amount(1 as unknown as bigint)).toThrow(TypeError);
  });
});

describe('parseAmount / formatAmount', () => {
  it('round-trips a 7-decimal asset', () => {
    const a = parseAmount('10.5', 7);
    expect(a).toBe(105000000n);
    expect(formatAmount(a, 7)).toBe('10.5000000');
  });
  it('formats sub-unit and negative values', () => {
    expect(formatAmount(amount(1n), 7)).toBe('0.0000001');
    expect(formatAmount(amount(-25n), 2)).toBe('-0.25');
    expect(formatAmount(amount(42n), 0)).toBe('42');
  });
  it('rejects precision beyond the asset decimals instead of truncating', () => {
    expect(() => parseAmount('1.00000001', 7)).toThrow(RangeError);
  });
  it.each(['', '.', '1.', '.5', '1,5', 'NaN', '1.2.3'])('rejects %j', (bad) => {
    expect(() => parseAmount(bad, 7)).toThrow(RangeError);
  });
  it('rejects invalid decimals', () => {
    expect(() => parseAmount('1', -1)).toThrow(RangeError);
    expect(() => parseAmount('1', 1.5)).toThrow(RangeError);
  });
});

describe('addAmounts', () => {
  it('sums exactly and enforces the i128 range', () => {
    expect(addAmounts(amount(1n), amount(2n), amount(-3n))).toBe(0n);
    expect(() => addAmounts(amount(I128_MAX), amount(1n))).toThrow(RangeError);
  });
});
