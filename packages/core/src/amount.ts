import { formatDecimal, parseDecimal } from './decimal.js';

/** Soroban token amounts are i128. */
export const I128_MIN = -(2n ** 127n);
export const I128_MAX = 2n ** 127n - 1n;

declare const amountBrand: unique symbol;
/** Integer amount in an asset's smallest unit (e.g. stroops). Never a float. */
export type Amount = bigint & { readonly [amountBrand]: true };

export function amount(units: bigint): Amount {
  if (typeof units !== 'bigint') throw new TypeError('Amount must be a bigint');
  if (units < I128_MIN || units > I128_MAX) throw new RangeError('Amount outside i128 range');
  return units as Amount;
}

/** Parses an integer string in minor units, as returned by Stellar RPC for i128 values. */
export function parseUnits(value: string): Amount {
  if (!/^-?\d+$/.test(value)) throw new RangeError(`Invalid integer amount: "${value}"`);
  return amount(BigInt(value));
}

/** Parses a human decimal (e.g. "10.5" XLM) into minor units for an asset with `decimals`. */
export function parseAmount(value: string, decimals: number): Amount {
  return amount(parseDecimal(value, decimals));
}

export function formatAmount(value: Amount, decimals: number): string {
  return formatDecimal(value, decimals);
}

export function addAmounts(...values: Amount[]): Amount {
  return amount(values.reduce<bigint>((sum, v) => sum + v, 0n));
}
