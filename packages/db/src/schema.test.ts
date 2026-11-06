import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from './client.js';
import { migrate } from './migrate.js';
import { createTestDatabase } from './testing.js';

let t: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.close();
});

const G = (c: string) => 'G' + c.repeat(55);
const C = (c: string) => 'C' + c.repeat(55);
const EVENT = (n: number) => `${String(n).padStart(19, '0')}-0000000000`;
const HASH = 'a'.repeat(64);

async function org(name = 'Acme') {
  const [r] = await t.sql<
    { id: string }[]
  >`INSERT INTO organizations (name) VALUES (${name}) RETURNING id`;
  return r!.id;
}
async function account(orgId: string, address: string) {
  const [r] = await t.sql<{ id: string }[]>`
    INSERT INTO receiving_accounts (org_id, network, address) VALUES (${orgId}, 'testnet', ${address}) RETURNING id`;
  return r!.id;
}
async function customer(orgId: string, ref: string) {
  const [r] = await t.sql<{ id: string }[]>`
    INSERT INTO customers (org_id, external_ref) VALUES (${orgId}, ${ref}) RETURNING id`;
  return r!.id;
}
function insertEvent(eventId: string, amount: string) {
  return t.sql`
    INSERT INTO chain_events (network, event_id, ledger, ledger_closed_at, tx_hash, tx_index, op_index,
      token_contract, asset, kind, from_address, to_address, amount)
    VALUES ('testnet', ${eventId}, 10, now(), ${HASH}, 0, 0, ${C('A')}, 'native', 'transfer', ${G('B')}, ${G('C')}, ${amount})
    ON CONFLICT (network, event_id) DO NOTHING
    RETURNING id`;
}

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(t.sql)).toEqual([]);
  });
});

describe('chain_events idempotency', () => {
  it('the same (network, event_id) inserted 3 times yields one row', async () => {
    const id = EVENT(1);
    const results = [
      await insertEvent(id, '5'),
      await insertEvent(id, '5'),
      await insertEvent(id, '5'),
    ];
    expect(results.map((r) => r.length)).toEqual([1, 0, 0]);
    const [{ count }] =
      (await t.sql`SELECT count(*)::int AS count FROM chain_events WHERE event_id = ${id}`) as unknown as [
        { count: number },
      ];
    expect(count).toBe(1);
  });

  it('concurrent inserts of the same event create exactly one row', async () => {
    const id = EVENT(2);
    const results = await Promise.all(Array.from({ length: 10 }, () => insertEvent(id, '5')));
    expect(results.filter((r) => r.length === 1)).toHaveLength(1);
  });

  it('stores i128-scale amounts exactly and rejects non-positive and out-of-range amounts', async () => {
    const big = (2n ** 127n - 1n).toString();
    await insertEvent(EVENT(3), big);
    const [row] = await t.sql<
      { amount: string }[]
    >`SELECT amount::text FROM chain_events WHERE event_id = ${EVENT(3)}`;
    expect(row!.amount).toBe(big);
    await expect(insertEvent(EVENT(4), '0')).rejects.toThrow(/check/i);
    await expect(insertEvent(EVENT(5), '-1')).rejects.toThrow(/check/i);
    await expect(insertEvent(EVENT(6), (2n ** 127n).toString())).rejects.toThrow(/check/i);
  });

  it('rejects malformed event ids', async () => {
    await expect(insertEvent('42', '1')).rejects.toThrow(/check/i);
  });
});

describe('append-only tables', () => {
  it('rejects UPDATE and DELETE on chain_events', async () => {
    await insertEvent(EVENT(7), '1');
    await expect(
      t.sql`UPDATE chain_events SET amount = 2 WHERE event_id = ${EVENT(7)}`,
    ).rejects.toThrow(/append-only/);
    await expect(t.sql`DELETE FROM chain_events WHERE event_id = ${EVENT(7)}`).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects UPDATE, DELETE and TRUNCATE on postings and audit_log', async () => {
    const o = await org();
    const a = await account(o, G('D'));
    await inTransaction(t.sql, async (tx) => {
      const [e] = await tx<{ id: string }[]>`
        INSERT INTO journal_entries (org_id, kind, source_ref) VALUES (${o}, 'adjustment', 'x1') RETURNING id`;
      await tx`INSERT INTO postings (entry_id, org_id, account, asset, amount) VALUES
        (${e!.id}, ${o}, ${'onchain:' + a}, 'native', 10), (${e!.id}, ${o}, ${'unattributed:' + a}, 'native', -10)`;
    });
    await t.sql`INSERT INTO audit_log (org_id, actor, action, subject) VALUES (${o}, 'test', 'create', 'x')`;
    await expect(t.sql`UPDATE postings SET amount = 1`).rejects.toThrow(/append-only/);
    await expect(t.sql`DELETE FROM postings`).rejects.toThrow(/append-only/);
    await expect(t.sql`TRUNCATE postings CASCADE`).rejects.toThrow(/append-only/);
    await expect(t.sql`UPDATE audit_log SET actor = 'x'`).rejects.toThrow(/append-only/);
    await expect(t.sql`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
    await expect(t.sql`UPDATE journal_entries SET memo = 'x'`).rejects.toThrow(/append-only/);
  });
});

describe('double-entry balance', () => {
  async function entry(postings: [string, string, string][], ref: string) {
    const o = await org();
    const a = await account(o, 'G' + randomBase32());
    return inTransaction(t.sql, async (tx) => {
      const [e] = await tx<{ id: string }[]>`
        INSERT INTO journal_entries (org_id, kind, source_ref) VALUES (${o}, 'adjustment', ${ref}) RETURNING id`;
      for (const [kind, asset, amount] of postings) {
        await tx`INSERT INTO postings (entry_id, org_id, account, asset, amount)
                 VALUES (${e!.id}, ${o}, ${kind + ':' + a}, ${asset}, ${amount})`;
      }
    });
  }

  it('commits a balanced entry', async () => {
    await expect(
      entry(
        [
          ['onchain', 'native', '100'],
          ['customer', 'native', '-100'],
        ],
        'b1',
      ),
    ).resolves.not.toThrow();
  });
  it('rejects an unbalanced entry at commit', async () => {
    await expect(
      entry(
        [
          ['onchain', 'native', '100'],
          ['customer', 'native', '-99'],
        ],
        'b2',
      ),
    ).rejects.toThrow(/not balanced/);
  });
  it('rejects an entry balanced in total but not per asset', async () => {
    await expect(
      entry(
        [
          ['onchain', 'native', '100'],
          ['customer', 'USDC', '-100'],
        ],
        'b3',
      ),
    ).rejects.toThrow(/not balanced/);
  });
  it('rejects entries with fewer than two postings', async () => {
    await expect(entry([], 'b4')).rejects.toThrow(/min 2/);
    await expect(entry([['onchain', 'native', '5']], 'b5')).rejects.toThrow(/min 2|not balanced/);
  });
  it('rejects adding a posting to an already committed entry', async () => {
    await entry(
      [
        ['onchain', 'native', '7'],
        ['customer', 'native', '-7'],
      ],
      'b7',
    );
    const [e] = await t.sql<
      { id: string; org_id: string }[]
    >`SELECT id, org_id FROM journal_entries WHERE source_ref = 'b7'`;
    await expect(
      t.sql`INSERT INTO postings (entry_id, org_id, account, asset, amount)
            VALUES (${e!.id}, ${e!.org_id}, ${'adjustment:' + e!.id}, 'native', 1)`,
    ).rejects.toThrow(/not balanced/);
  });

  it('leaves nothing behind when an entry is rejected', async () => {
    await entry(
      [
        ['onchain', 'native', '1'],
        ['customer', 'native', '-2'],
      ],
      'b6',
    ).catch(() => undefined);
    const rows = await t.sql`SELECT 1 FROM journal_entries WHERE source_ref = 'b6'`;
    expect(rows).toHaveLength(0);
  });
});

describe('tenant isolation', () => {
  it('a routing key cannot point to another organization customer', async () => {
    const a = await org('A');
    const b = await org('B');
    const accA = await account(a, G('F'));
    const custB = await customer(b, 'c-1');
    await expect(
      t.sql`INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
            VALUES (${a}, ${accA}, 'id', '1', ${custB})`,
    ).rejects.toThrow(/foreign key/);
  });

  it('a receiving address belongs to exactly one organization per network', async () => {
    const a = await org('A2');
    const b = await org('B2');
    await account(a, G('H'));
    await expect(account(b, G('H'))).rejects.toThrow(/unique/);
  });
});

describe('routing keys', () => {
  it('validates value per kind and is unique per receiving account', async () => {
    const o = await org();
    const acc = await account(o, G('J'));
    const cust = await customer(o, 'r-1');
    const ins = (kind: string, value: string) =>
      t.sql`INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
            VALUES (${o}, ${acc}, ${kind}::routing_kind, ${value}, ${cust})`;
    await ins('id', '18446744073709551615');
    await expect(ins('id', '18446744073709551615')).rejects.toThrow(/unique/);
    await expect(ins('id', '18446744073709551616')).rejects.toThrow(/check/i);
    await expect(ins('id', '007')).rejects.toThrow(/check/i);
    await expect(ins('hash', 'XYZ')).rejects.toThrow(/check/i);
    await expect(ins('text', 'x'.repeat(29))).rejects.toThrow(/check/i);
  });
});

describe('deposits', () => {
  it('attributed deposits require a customer and unattributed ones forbid it', async () => {
    const o = await org();
    const acc = await account(o, G('K'));
    const [ev] = await insertEvent(EVENT(9), '10');
    const ins = (status: string, customerId: string | null) =>
      t.sql`INSERT INTO deposits (org_id, chain_event_id, receiving_account_id, customer_id, status, token_contract, amount)
            VALUES (${o}, ${ev!.id}, ${acc}, ${customerId}, ${status}::deposit_status, ${C('A')}, 10)`;
    await expect(ins('attributed', null)).rejects.toThrow(/check/i);
    await ins('unattributed', null);
    await expect(ins('unattributed', null)).rejects.toThrow(/unique/);
  });
});

function randomBase32(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let s = '';
  for (let i = 0; i < 55; i++) s += chars[Math.floor(Math.random() * 32)];
  return s.slice(0, 55);
}
