import { readFileSync } from 'node:fs';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

// Asserts that the captured testnet data has the shape documented in
// docs/architecture/stellar-integration.md. If Stellar changes the event
// format, recapture with scripts/research/p30-events.ts and this test tells us what moved.

interface RawEvent {
  type: string;
  ledger: number;
  id: string;
  txHash: string;
  contractId: string;
  operationIndex: number;
  transactionIndex: number;
  topic: string[];
  value: string;
}
const fixture = JSON.parse(
  readFileSync(new URL('./p30-testnet-events.json', import.meta.url), 'utf8'),
) as {
  protocolVersion: number;
  accounts: Record<string, string>;
  transactions: Record<string, { hash: string }>;
  getEventsResult: { events: RawEvent[]; oldestLedger: number; latestLedger: number };
};

const decode = (b64: string): unknown => scValToNative(xdr.ScVal.fromXDR(b64, 'base64'));
const transferOf = (tx: string) => {
  const hash = fixture.transactions[tx]?.hash;
  const events = fixture.getEventsResult.events.filter(
    (e) => e.txHash === hash && decode(e.topic[0]!) === 'transfer',
  );
  expect(events).toHaveLength(1);
  const e = events[0]!;
  return { e, topics: e.topic.map(decode), data: decode(e.value) };
};

describe('Protocol 30 testnet fixture', () => {
  it('was captured on protocol 30', () => {
    expect(fixture.protocolVersion).toBe(30);
  });

  it('every event has the fields the ingestion relies on', () => {
    for (const e of fixture.getEventsResult.events) {
      expect(e.type).toBe('contract');
      expect(e.id).toMatch(/^\d{19}-\d{10}$/);
      expect(e.contractId).toBe(fixture.accounts.nativeSac);
      expect(typeof e.ledger).toBe('number');
      expect(e.txHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('event ids are unique', () => {
    const ids = fixture.getEventsResult.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classic payment with memo id: to_muxed_id is the memo id (u64)', () => {
    const { topics, data } = transferOf('memo');
    expect(topics).toEqual([
      'transfer',
      fixture.accounts.sender,
      fixture.accounts.receiver,
      'native',
    ]);
    expect(data).toEqual({ amount: 10000001n, to_muxed_id: 1001n });
  });

  it('classic payment with memo text: to_muxed_id is the memo text (string)', () => {
    expect(transferOf('memoText').data).toEqual({ amount: 15000000n, to_muxed_id: 'INV-42' });
  });

  it('M address: topic carries the base G account, data carries the muxed id', () => {
    const { topics, data } = transferOf('muxedAccount');
    expect(topics[2]).toBe(fixture.accounts.receiver);
    expect(data).toEqual({ amount: 20000000n, to_muxed_id: 2002n });
  });

  it('plain C address: data is a bare i128, not a map', () => {
    const { topics, data } = transferOf('contract');
    expect(topics[2]).toBe(fixture.accounts.receivingContract);
    expect(data).toBe(30000000n);
  });

  it('W address (CAP-84): topic carries the base C contract, data carries the muxed id', () => {
    const { topics, data } = transferOf('muxedContract');
    expect(fixture.accounts.muxedContract).toMatch(/^W/);
    expect(topics[2]).toBe(fixture.accounts.receivingContract);
    expect(data).toEqual({ amount: 40000000n, to_muxed_id: 3003n });
  });

  it('SAC transfer to an M address behaves like the classic M payment', () => {
    expect(transferOf('sacToMuxedAccount').data).toEqual({ amount: 50000000n, to_muxed_id: 2002n });
  });

  it('fee events are present and must be ignored by ingestion', () => {
    const fees = fixture.getEventsResult.events.filter((e) => decode(e.topic[0]!) === 'fee');
    expect(fees.length).toBeGreaterThan(0);
    expect(fees.some((e) => (decode(e.value) as bigint) < 0n)).toBe(true); // refunds are negative
  });
});
