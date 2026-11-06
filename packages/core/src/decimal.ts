// Adapted from Akkuea (MIT, Copyright (c) Acachete Labs), apps/shared/src/utils/bigintMath.ts.
// Changes: strict mode. Excess fractional digits are rejected instead of truncated,
// because silently dropping precision is a financial error.

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parses "12.5" with 7 decimals into 125000000n. Throws on any malformed or over-precise input. */
export function parseDecimal(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal string: "${value}"`);
  const [, sign, integerPart = '0', fractionalPart = ''] = match;
  if (fractionalPart.length > decimals) {
    throw new RangeError(`"${value}" has more than ${decimals} fractional digits`);
  }
  const units = BigInt(integerPart + fractionalPart.padEnd(decimals, '0'));
  return sign ? -units : units;
}

/** Formats 125000000n with 7 decimals as "12.5000000". */
export function formatDecimal(units: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();
  if (decimals === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, padded.length - decimals);
  const fractionalPart = padded.slice(padded.length - decimals);
  return `${negative ? '-' : ''}${integerPart}.${fractionalPart}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new RangeError(`Invalid decimals: ${decimals}`);
  }
}
