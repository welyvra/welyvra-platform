import { formatAmount, parseUnits } from '@welyvra/core';

/** Stellar classic assets and their SACs use 7 decimals. */
export const SAC_DECIMALS = 7;

/** Formats an API amount (string of integer minor units) without ever going through a float. */
export function displayAmount(units: string, decimals = SAC_DECIMALS): string {
  const formatted = formatAmount(parseUnits(units), decimals);
  const [int, frac = ''] = formatted.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** GABC…WXYZ: keeps both ends so addresses stay recognizable. */
export function shortAddress(value: string, keep = 4): string {
  return value.length <= keep * 2 + 1 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function assetLabel(tokenContract: string, nativeSac?: string): string {
  return nativeSac && tokenContract === nativeSac ? 'XLM' : shortAddress(tokenContract);
}

export function formatDate(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export const CASE_LABELS: Record<string, string> = {
  unattributed_deposit: 'Unattributed deposit',
  missing_internal: 'Missing in internal records',
  missing_onchain: 'Missing on-chain',
  amount_mismatch: 'Amount mismatch',
  customer_mismatch: 'Customer mismatch',
};

/** Case details from the API carry raw minor units ("on-chain 20000000, internal 19000000"); show them as amounts. */
export function humanizeDetail(detail: string): string {
  return detail.replace(
    /\b(on-chain|internal) (\d+)\b/g,
    (_m, side: string, units: string) => `${side} ${displayAmount(units)}`,
  );
}
