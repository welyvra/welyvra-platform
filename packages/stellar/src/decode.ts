import { Address, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { amount, type DecodeResult, type Network, type RoutingKey, U64_MAX } from '@welyvra/core';

/** Event as returned by Stellar RPC `getEvents` (xdrFormat=base64). */
export interface RawRpcEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  operationIndex: number;
  transactionIndex: number;
  txHash: string;
  topic: string[];
  value: string;
}

const invalid = (eventId: string, reason: string): DecodeResult => ({
  status: 'invalid',
  eventId,
  reason,
});

function parseScVal(b64: string): xdr.ScVal {
  return xdr.ScVal.fromXDR(b64, 'base64');
}

function symbolOf(v: xdr.ScVal | undefined): string | null {
  return v?.type === 'scvSymbol' ? v.value : null;
}

/** Returns a non-muxed G/C address, or an error string. */
function plainAddress(v: xdr.ScVal | undefined): string | { error: string } {
  if (v?.type !== 'scvAddress') return { error: 'topic is not an address' };
  let str: string;
  try {
    str = Address.fromScVal(v).toString();
  } catch {
    return { error: 'unknown address variant' };
  }
  if (StrKey.isValidEd25519PublicKey(str) || StrKey.isValidContract(str)) return str;
  return { error: `unexpected address type in topic: ${str.slice(0, 1)}` };
}

function routingKeyOf(v: xdr.ScVal): RoutingKey | { error: string } {
  switch (v.type) {
    case 'scvU64': {
      if (v.u64 < 0n || v.u64 > U64_MAX) return { error: 'to_muxed_id out of u64 range' };
      return { kind: 'id', value: v.u64.toString() };
    }
    case 'scvString':
      return { kind: 'text', value: v.value };
    case 'scvBytes':
      return { kind: 'hash', value: Buffer.from(scValToNative(v) as Uint8Array).toString('hex') };
    default:
      return { error: `unsupported to_muxed_id type: ${v.type}` };
  }
}

function i128Of(v: xdr.ScVal): bigint | null {
  if (v.type !== 'scvI128') return null;
  const n: unknown = scValToNative(v);
  return typeof n === 'bigint' ? n : null;
}

/** Data is either a bare i128 or a map { amount: i128, to_muxed_id: u64|string|bytes } (verified on testnet). */
function parseData(v: xdr.ScVal): { units: bigint; routingKey: RoutingKey } | { error: string } {
  const bare = i128Of(v);
  if (bare !== null) return { units: bare, routingKey: { kind: 'none' } };
  if (v.type !== 'scvMap') return { error: `unexpected data type: ${v.type}` };
  let units: bigint | null = null;
  let routingKey: RoutingKey = { kind: 'none' };
  for (const entry of v.map ?? []) {
    const key = symbolOf(entry.key);
    if (key === 'amount') units = i128Of(entry.val);
    else if (key === 'to_muxed_id') {
      const rk = routingKeyOf(entry.val);
      if ('error' in rk) return rk;
      routingKey = rk;
    } else return { error: `unexpected data key: ${String(key)}` };
  }
  if (units === null) return { error: 'data map has no i128 amount' };
  return { units, routingKey };
}

/**
 * Decodes one RPC event into a normalized transfer/mint. Never throws: malformed
 * input becomes `invalid` so the caller can record it as an exception instead of
 * dropping it.
 */
export function decodeEvent(raw: RawRpcEvent, network: Network): DecodeResult {
  const eventId = typeof raw?.id === 'string' ? raw.id : '<missing id>';
  try {
    if (!/^\d{19}-\d{10}$/.test(eventId)) return invalid(eventId, 'malformed event id');
    if (raw.type !== 'contract') return { status: 'ignored', eventId, reason: 'other_event' };
    if (!Array.isArray(raw.topic) || raw.topic.length === 0)
      return invalid(eventId, 'missing topics');

    const topics = raw.topic.map(parseScVal);
    const name = symbolOf(topics[0]);
    if (name === 'fee') return { status: 'ignored', eventId, reason: 'fee' };
    if (name !== 'transfer' && name !== 'mint')
      return { status: 'ignored', eventId, reason: 'other_event' };

    let from: string | null = null;
    let toVal: xdr.ScVal | undefined;
    let assetVal: xdr.ScVal | undefined;
    if (name === 'transfer') {
      if (topics.length !== 3 && topics.length !== 4)
        return invalid(eventId, 'transfer: wrong topic count');
      const f = plainAddress(topics[1]);
      if (typeof f !== 'string') return invalid(eventId, `from: ${f.error}`);
      from = f;
      toVal = topics[2];
      assetVal = topics[3];
    } else {
      if (topics.length !== 2 && topics.length !== 3)
        return invalid(eventId, 'mint: wrong topic count');
      toVal = topics[1];
      assetVal = topics[2];
    }
    const to = plainAddress(toVal);
    if (typeof to !== 'string') return invalid(eventId, `to: ${to.error}`);

    let asset: string | null = null;
    if (assetVal) {
      if (assetVal.type !== 'scvString') return invalid(eventId, 'asset topic is not a string');
      asset = assetVal.value;
    }

    const data = parseData(parseScVal(raw.value));
    if ('error' in data) return invalid(eventId, data.error);
    if (data.units <= 0n) return invalid(eventId, 'non-positive amount');

    return {
      status: 'ok',
      event: {
        network,
        eventId,
        ledger: raw.ledger,
        ledgerClosedAt: raw.ledgerClosedAt,
        txHash: raw.txHash,
        transactionIndex: raw.transactionIndex,
        operationIndex: raw.operationIndex,
        tokenContract: raw.contractId,
        asset,
        kind: name,
        from,
        to,
        routingKey: data.routingKey,
        amount: amount(data.units),
      },
    };
  } catch (e) {
    return invalid(eventId, `undecodable XDR: ${(e as Error).message}`);
  }
}
