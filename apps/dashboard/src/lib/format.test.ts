import { describe, expect, it } from 'vitest';
import { CASE_LABELS, displayAmount, humanizeDetail, shortAddress } from './format';

describe('displayAmount', () => {
  it('formats integer minor units with 7 decimals exactly, never through a float', () => {
    expect(displayAmount('10000001')).toBe('1.0000001');
    expect(displayAmount('15000000')).toBe('1.5');
    expect(displayAmount('1')).toBe('0.0000001');
    expect(displayAmount('12345678900000000')).toBe('1,234,567,890');
    // Beyond Number.MAX_SAFE_INTEGER: a float would print 900719925.4740992.
    expect(displayAmount('9007199254740993')).toBe('900,719,925.4740993');
    expect(displayAmount('170141183460469231731687303715884105727')).toBe(
      '17,014,118,346,046,923,173,168,730,371,588.4105727',
    );
  });
  it('rejects non-integer input', () => {
    expect(() => displayAmount('1.5')).toThrow();
    expect(() => displayAmount('abc')).toThrow();
  });
});

describe('shortAddress', () => {
  it('keeps both ends', () => {
    expect(shortAddress('GCS3KV7DCM7TDKR5LFOLXZA74EIOYLPHL5OD34VUK63TTLU2O2BZXL6P')).toBe(
      'GCS3…XL6P',
    );
    expect(shortAddress('short')).toBe('short');
  });
});

describe('case labels', () => {
  it('covers every case kind', () => {
    expect(Object.keys(CASE_LABELS).sort()).toEqual([
      'amount_mismatch',
      'customer_mismatch',
      'missing_internal',
      'missing_onchain',
      'unattributed_deposit',
    ]);
  });
});

describe('humanizeDetail', () => {
  it('formats raw minor units in mismatch details', () => {
    expect(humanizeDetail('on-chain 20000000, internal 19000000')).toBe('on-chain 2, internal 1.9');
    expect(humanizeDetail('no routing key')).toBe('no routing key');
  });
});
