import type { Amount } from './amount.js';

export type Network = 'testnet' | 'mainnet';

export const U64_MAX = 2n ** 64n - 1n;

/**
 * How a deposit identifies its customer. Verified on testnet (issue #3): a memo ID,
 * an M address and a W address all arrive as the same `u64` `to_muxed_id`, so the
 * kind describes the value type, not the address format.
 */
export type RoutingKey =
  | { kind: 'id'; value: string } // u64 as decimal string (memo ID, M or W muxed ID)
  | { kind: 'text'; value: string } // memo text
  | { kind: 'hash'; value: string } // memo hash / return, lowercase hex
  | { kind: 'none' };

export interface NormalizedTransferEvent {
  network: Network;
  /** Stellar RPC event id. Globally unique per network and totally ordered. Idempotency key. */
  eventId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  transactionIndex: number;
  operationIndex: number;
  /** Token contract that emitted the event (the SAC for classic assets). */
  tokenContract: string;
  /** SEP-11 asset string from the event topics, e.g. "native" or "USDC:G...". Null for custom tokens. */
  asset: string | null;
  kind: 'transfer' | 'mint';
  /** Sender; null for mints. */
  from: string | null;
  /** Non-muxed destination (G or C). */
  to: string;
  routingKey: RoutingKey;
  amount: Amount;
}

export type DecodeResult =
  | { status: 'ok'; event: NormalizedTransferEvent }
  | { status: 'ignored'; eventId: string; reason: 'fee' | 'other_event' }
  | { status: 'invalid'; eventId: string; reason: string };

export function routingKeyEquals(a: RoutingKey, b: RoutingKey): boolean {
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind;
  return a.kind === b.kind && a.value === b.value;
}

export function parseRoutingId(value: string): RoutingKey {
  if (!/^\d+$/.test(value)) throw new RangeError(`Routing id must be a u64 decimal: "${value}"`);
  const n = BigInt(value);
  if (n > U64_MAX) throw new RangeError('Routing id exceeds u64');
  return { kind: 'id', value: n.toString() };
}

/** Compare RPC event ids ("<19 digits>-<10 digits>"). Fixed width, so string order equals event order. */
export function compareEventIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
