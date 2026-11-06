import { readFileSync } from 'node:fs';
import { Address, Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { type RawRpcEvent, decodeEvent } from './index.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/stellar/p30-testnet-events.json', import.meta.url),
    'utf8',
  ),
) as {
  accounts: Record<string, string>;
  transactions: Record<string, { hash: string }>;
  getEventsResult: { events: RawRpcEvent[] };
};
const events = fixture.getEventsResult.events;
const okFor = (tx: string) => {
  const hash = fixture.transactions[tx]!.hash;
  const results = events.filter((e) => e.txHash === hash).map((e) => decodeEvent(e, 'testnet'));
  const ok = results.filter((r) => r.status === 'ok');
  expect(ok).toHaveLength(1);
  return ok[0]!.status === 'ok' ? ok[0]!.event : (null as never);
};

describe('decodeEvent on real testnet data', () => {
  it('ignores every fee event and decodes every transfer', () => {
    const results = events.map((e) => decodeEvent(e, 'testnet'));
    expect(results.filter((r) => r.status === 'invalid')).toEqual([]);
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(
      Object.keys(fixture.transactions).length,
    );
    expect(
      results
        .filter((r) => r.status === 'ignored')
        .every((r) => r.status === 'ignored' && r.reason === 'fee'),
    ).toBe(true);
  });

  it('memo id -> id routing key', () => {
    const e = okFor('memo');
    expect(e).toMatchObject({
      kind: 'transfer',
      from: fixture.accounts.sender,
      to: fixture.accounts.receiver,
      asset: 'native',
      routingKey: { kind: 'id', value: '1001' },
      amount: 10000001n,
      tokenContract: fixture.accounts.nativeSac,
      network: 'testnet',
    });
  });

  it('memo text -> text routing key', () => {
    expect(okFor('memoText').routingKey).toEqual({ kind: 'text', value: 'INV-42' });
  });

  it('M address and W address -> id routing key on the base address', () => {
    expect(okFor('muxedAccount')).toMatchObject({
      to: fixture.accounts.receiver,
      routingKey: { kind: 'id', value: '2002' },
    });
    expect(okFor('muxedContract')).toMatchObject({
      to: fixture.accounts.receivingContract,
      routingKey: { kind: 'id', value: '3003' },
    });
  });

  it('plain C address -> no routing key', () => {
    expect(okFor('contract')).toMatchObject({ routingKey: { kind: 'none' }, amount: 30000000n });
  });
});

// Synthetic adversarial events.
const G1 = Keypair.random().publicKey();
const G2 = Keypair.random().publicKey();
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const sym = (s: string) => b64(xdr.ScVal.scvSymbol(s));
const addr = (a: string) => b64(Address.fromString(a).toScVal());
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const map = (entries: [string, xdr.ScVal][]) =>
  xdr.ScVal.scvMap(
    entries.map(([k, v]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v })),
  );
const base = (over: Partial<RawRpcEvent>): RawRpcEvent => ({
  type: 'contract',
  ledger: 10,
  ledgerClosedAt: '2026-11-05T00:00:00Z',
  contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  id: '0000000042949672960-0000000000',
  operationIndex: 0,
  transactionIndex: 0,
  txHash: 'a'.repeat(64),
  topic: [sym('transfer'), addr(G1), addr(G2), b64(xdr.ScVal.scvString('native'))],
  value: b64(i128(5n)),
  ...over,
});

describe('decodeEvent adversarial input', () => {
  it('decodes i128 amounts above 2^53 exactly', () => {
    const r = decodeEvent(base({ value: b64(i128(2n ** 100n)) }), 'testnet');
    expect(r.status === 'ok' && r.event.amount).toBe(2n ** 100n);
  });

  it('accepts u64 max as muxed id', () => {
    const v = map([
      ['amount', i128(1n)],
      ['to_muxed_id', nativeToScVal(2n ** 64n - 1n, { type: 'u64' })],
    ]);
    const r = decodeEvent(base({ value: b64(v) }), 'testnet');
    expect(r.status === 'ok' && r.event.routingKey).toEqual({
      kind: 'id',
      value: '18446744073709551615',
    });
  });

  it('memo hash -> hash routing key in hex', () => {
    const v = map([
      ['amount', i128(1n)],
      ['to_muxed_id', xdr.ScVal.scvBytes(Buffer.alloc(32, 0xab))],
    ]);
    const r = decodeEvent(base({ value: b64(v) }), 'testnet');
    expect(r.status === 'ok' && r.event.routingKey).toEqual({
      kind: 'hash',
      value: 'ab'.repeat(32),
    });
  });

  it('decodes mint with null sender', () => {
    const r = decodeEvent(
      base({ topic: [sym('mint'), addr(G2), b64(xdr.ScVal.scvString('native'))] }),
      'testnet',
    );
    expect(r.status === 'ok' && r.event).toMatchObject({ kind: 'mint', from: null, to: G2 });
  });

  it.each<[string, Partial<RawRpcEvent>]>([
    ['malformed event id', { id: '42' }],
    ['missing topics', { topic: [] }],
    ['wrong topic count', { topic: [sym('transfer'), addr(G1)] }],
    [
      'to is not an address',
      { topic: [sym('transfer'), addr(G1), sym('x'), b64(xdr.ScVal.scvString('native'))] },
    ],
    [
      'muxed address in topic',
      {
        topic: [
          sym('transfer'),
          addr(G1),
          b64(Address.fromString(StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 1))).toScVal()),
          b64(xdr.ScVal.scvString('native')),
        ],
      },
    ],
    [
      'data map without amount',
      { value: b64(map([['to_muxed_id', nativeToScVal(1n, { type: 'u64' })]])) },
    ],
    [
      'unexpected data key',
      {
        value: b64(
          map([
            ['amount', i128(1n)],
            ['evil', i128(1n)],
          ]),
        ),
      },
    ],
    [
      'u32 muxed id',
      {
        value: b64(
          map([
            ['amount', i128(1n)],
            ['to_muxed_id', xdr.ScVal.scvU32(1)],
          ]),
        ),
      },
    ],
    ['amount as u64', { value: b64(nativeToScVal(5n, { type: 'u64' })) }],
    ['zero amount', { value: b64(i128(0n)) }],
    ['negative amount', { value: b64(i128(-1n)) }],
    ['garbage XDR', { value: 'not-xdr' }],
  ])('%s -> invalid, never thrown or dropped', (_name, over) => {
    const r = decodeEvent(base(over), 'testnet');
    expect(r.status).toBe('invalid');
  });

  it('ignores non-transfer contract events', () => {
    const r = decodeEvent(base({ topic: [sym('approve'), addr(G1), addr(G2)] }), 'testnet');
    expect(r).toMatchObject({ status: 'ignored', reason: 'other_event' });
  });
});
