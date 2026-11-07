import { parseRoutingId } from '@welyvra/core';

export type RoutingKeyInput = { kind: 'id' | 'text' | 'hash'; value: string };

/**
 * Validates and canonicalizes a routing key before it is stored: `id` must be a u64 (memo ID or
 * M/W muxed ID), `hash` is 64 lowercase hex, `text` fits a Stellar text memo (28 bytes).
 */
export function normalizeRoutingKey(k: RoutingKeyInput): { kind: string; value: string } {
  if (k.kind === 'id') return parseRoutingId(k.value) as { kind: 'id'; value: string };
  if (k.kind === 'hash' && !/^[0-9a-f]{64}$/.test(k.value))
    throw Object.assign(new Error('hash must be 64 lowercase hex'), { statusCode: 400 });
  if (k.kind === 'text' && Buffer.byteLength(k.value) > 28)
    throw Object.assign(new Error('memo text is at most 28 bytes'), { statusCode: 400 });
  return k;
}
