import { InvalidTransitionError } from '@welyvra/core';
import { inTransaction } from '@welyvra/db';
import { createTestDatabase } from '@welyvra/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  accounts,
  attributeDeposit,
  balances,
  openCase,
  postDeposit,
  recordInternalRecords,
  runReconciliation,
  transitionCase,
} from './index.js';

let t: Awaited<ReturnType<typeof createTestDatabase>>;
let orgId: string;
let accountId: string;
let alice: string;
let bob: string;
const TOKEN = 'C' + 'A'.repeat(55);
let seq = 0;
const hash = (n: number) => n.toString(16).padStart(64, '0');

beforeEach(async () => {
  t = await createTestDatabase();
  seq = 0;
  [{ id: orgId }] =
    (await t.sql`INSERT INTO organizations (name) VALUES ('Acme') RETURNING id`) as unknown as [
      { id: string },
    ];
  [{ id: accountId }] = (await t.sql`
    INSERT INTO receiving_accounts (org_id, network, address) VALUES (${orgId}, 'testnet', ${'G' + 'B'.repeat(55)}) RETURNING id`) as unknown as [
    { id: string },
  ];
  [{ id: alice }] =
    (await t.sql`INSERT INTO customers (org_id, external_ref) VALUES (${orgId}, 'alice') RETURNING id`) as unknown as [
      { id: string },
    ];
  [{ id: bob }] =
    (await t.sql`INSERT INTO customers (org_id, external_ref) VALUES (${orgId}, 'bob') RETURNING id`) as unknown as [
      { id: string },
    ];
});
afterEach(async () => {
  await t?.close();
});

/** Simulates what ingestion writes for one deposit (same transaction). */
async function deposit(
  amount: bigint,
  customerId: string | null,
): Promise<{ id: string; txHash: string }> {
  const n = ++seq;
  return inTransaction(t.sql, async (tx) => {
    const [ev] = await tx<{ id: string }[]>`
      INSERT INTO chain_events (network, event_id, ledger, ledger_closed_at, tx_hash, tx_index, op_index, token_contract, kind, to_address, amount)
      VALUES ('testnet', ${`${String(n).padStart(19, '0')}-0000000000`}, ${n}, now(), ${hash(n)}, 0, 0, ${TOKEN}, 'transfer', ${'G' + 'B'.repeat(55)}, ${amount.toString()})
      RETURNING id`;
    const [d] = await tx<{ id: string }[]>`
      INSERT INTO deposits (org_id, chain_event_id, receiving_account_id, customer_id, status, token_contract, amount)
      VALUES (${orgId}, ${ev!.id}, ${accountId}, ${customerId}, ${customerId ? 'attributed' : 'unattributed'}::deposit_status, ${TOKEN}, ${amount.toString()})
      RETURNING id`;
    await postDeposit(tx, {
      orgId,
      depositId: d!.id,
      receivingAccountId: accountId,
      customerId,
      tokenContract: TOKEN,
      amount,
    });
    if (!customerId)
      await openCase(tx, {
        orgId,
        kind: 'unattributed_deposit',
        subjectRef: `deposit:${d!.id}`,
        actor: 'test',
      });
    return { id: d!.id, txHash: hash(n) };
  });
}

const casesBy = async () =>
  t.sql<{ kind: string; status: string; n: number }[]>`
    SELECT kind::text, status::text, count(*)::int AS n FROM exception_cases GROUP BY 1, 2 ORDER BY 1, 2`;

describe('ledger', () => {
  it('on-chain balance equals the sum of deposits; liabilities split between customers and unattributed', async () => {
    await deposit(100n, alice);
    await deposit(250n, bob);
    await deposit(2n ** 80n, null);
    const b = await balances(t.sql, orgId);
    expect(b).toEqual(
      [
        { account: accounts.customer(alice), asset: TOKEN, amount: -100n },
        { account: accounts.customer(bob), asset: TOKEN, amount: -250n },
        { account: accounts.onchain(accountId), asset: TOKEN, amount: 350n + 2n ** 80n },
        { account: accounts.unattributed(accountId), asset: TOKEN, amount: -(2n ** 80n) },
      ].sort((x, y) => (x.account < y.account ? -1 : 1)),
    );
    expect(b.reduce((s, r) => s + r.amount, 0n)).toBe(0n);
  });

  it('posting the same deposit twice is a no-op', async () => {
    const d = await deposit(10n, alice);
    const again = await inTransaction(t.sql, (tx) =>
      postDeposit(tx, {
        orgId,
        depositId: d.id,
        receivingAccountId: accountId,
        customerId: alice,
        tokenContract: TOKEN,
        amount: 10n,
      }),
    );
    expect(again).toBe(false);
    expect(
      (await balances(t.sql, orgId)).find((r) => r.account.startsWith('onchain'))!.amount,
    ).toBe(10n);
  });
});

describe('internal records', () => {
  it('are idempotent by external id and reject conflicting resubmissions', async () => {
    const recs = [{ externalId: 'inv-1', customerId: alice, tokenContract: TOKEN, amount: 100n }];
    expect(await recordInternalRecords(t.sql, orgId, 'api', recs)).toEqual({
      created: 1,
      duplicates: 0,
      conflicts: [],
    });
    expect(await recordInternalRecords(t.sql, orgId, 'api', recs)).toEqual({
      created: 0,
      duplicates: 1,
      conflicts: [],
    });
    expect(
      await recordInternalRecords(t.sql, orgId, 'api', [{ ...recs[0]!, amount: 101n }]),
    ).toEqual({
      created: 0,
      duplicates: 0,
      conflicts: ['inv-1'],
    });
    await expect(t.sql`UPDATE internal_records SET amount = 1`).rejects.toThrow(/append-only/);
  });

  it('cannot reference a customer of another organization', async () => {
    const [{ id: other }] =
      (await t.sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`) as unknown as [
        { id: string },
      ];
    await expect(
      recordInternalRecords(t.sql, other, 'api', [
        { externalId: 'x', customerId: alice, tokenContract: TOKEN, amount: 1n },
      ]),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('reconciliation runs', () => {
  async function scenario() {
    const matchedByHash = await deposit(100n, alice);
    await deposit(200n, bob); // matched by (customer, amount)
    const wrongAmount = await deposit(300n, alice);
    const wrongCustomer = await deposit(400n, alice);
    await deposit(500n, bob); // missing internally
    await recordInternalRecords(t.sql, orgId, 'api', [
      {
        externalId: 'r1',
        customerId: alice,
        tokenContract: TOKEN,
        amount: 100n,
        txHash: matchedByHash.txHash,
      },
      { externalId: 'r2', customerId: bob, tokenContract: TOKEN, amount: 200n },
      {
        externalId: 'r3',
        customerId: alice,
        tokenContract: TOKEN,
        amount: 299n,
        txHash: wrongAmount.txHash,
      },
      {
        externalId: 'r4',
        customerId: bob,
        tokenContract: TOKEN,
        amount: 400n,
        txHash: wrongCustomer.txHash,
      },
      { externalId: 'r5', customerId: alice, tokenContract: TOKEN, amount: 999n }, // missing on-chain
    ]);
  }

  it('classifies every discrepancy and opens one case for each', async () => {
    await scenario();
    const run = await runReconciliation(t.sql, { orgId, actor: 'test' });
    expect(run.summary).toEqual({
      matched: 2,
      amount_mismatch: 1,
      customer_mismatch: 1,
      missing_internal: 1,
      missing_onchain: 1,
    });
    expect(run.casesOpened).toBe(4);
    expect(await casesBy()).toEqual([
      { kind: 'amount_mismatch', status: 'open', n: 1 },
      { kind: 'customer_mismatch', status: 'open', n: 1 },
      { kind: 'missing_internal', status: 'open', n: 1 },
      { kind: 'missing_onchain', status: 'open', n: 1 },
    ]);
  });

  it('running twice gives identical results and opens no duplicate cases', async () => {
    await scenario();
    const a = await runReconciliation(t.sql, { orgId, actor: 'test' });
    const b = await runReconciliation(t.sql, { orgId, actor: 'test' });
    expect(b.summary).toEqual(a.summary);
    expect(b.casesOpened).toBe(0);
    const rows =
      await t.sql`SELECT run_id, outcome::text, deposit_id, internal_record_id FROM reconciliation_results ORDER BY outcome, deposit_id, internal_record_id`;
    const perRun = (id: string) =>
      rows.filter((r) => r.run_id === id).map(({ run_id: _r, ...x }) => x);
    expect(perRun(b.runId)).toEqual(perRun(a.runId));
  });

  it('concurrent runs do not duplicate cases', async () => {
    await scenario();
    await Promise.all(
      Array.from({ length: 4 }, () => runReconciliation(t.sql, { orgId, actor: 'test' })),
    );
    const [{ n }] = (await t.sql`SELECT count(*)::int AS n FROM exception_cases`) as unknown as [
      { n: number },
    ];
    expect(n).toBe(4);
  });

  it('a dismissed case is not reopened by the next run', async () => {
    await scenario();
    await runReconciliation(t.sql, { orgId, actor: 'test' });
    const [c] = await t.sql<
      { id: string }[]
    >`SELECT id FROM exception_cases WHERE kind = 'missing_internal'`;
    await transitionCase(t.sql, {
      orgId,
      caseId: c!.id,
      to: 'dismissed',
      actor: 'ana',
      reason: 'test deposit, ignore',
    });
    expect((await runReconciliation(t.sql, { orgId, actor: 'test' })).casesOpened).toBe(0);
  });
});

describe('resolving unattributed deposits', () => {
  it('moves the liability with a new balanced entry, resolves the case and audits it; nothing is edited', async () => {
    const d = await deposit(70n, null);
    const postingsBefore = await t.sql`SELECT id, account, amount::text FROM postings ORDER BY id`;
    await attributeDeposit(t.sql, {
      orgId,
      depositId: d.id,
      customerId: alice,
      actor: 'ana',
      reason: 'customer sent receipt',
    });

    const postingsAfter = await t.sql`SELECT id, account, amount::text FROM postings ORDER BY id`;
    expect(postingsAfter.slice(0, postingsBefore.length)).toEqual(postingsBefore); // old rows untouched
    expect(postingsAfter).toHaveLength(postingsBefore.length + 2);
    expect(await balances(t.sql, orgId)).toEqual([
      { account: accounts.customer(alice), asset: TOKEN, amount: -70n },
      { account: accounts.onchain(accountId), asset: TOKEN, amount: 70n },
    ]);
    expect(await casesBy()).toEqual([{ kind: 'unattributed_deposit', status: 'resolved', n: 1 }]);
    const events =
      await t.sql`SELECT from_status::text, to_status::text, actor, reason FROM case_events ORDER BY id`;
    expect(events.at(-1)).toEqual({
      from_status: 'open',
      to_status: 'resolved',
      actor: 'ana',
      reason: 'customer sent receipt',
    });
    const [log] =
      await t.sql`SELECT action, actor FROM audit_log WHERE action = 'deposit.attribute'`;
    expect(log).toEqual({ action: 'deposit.attribute', actor: 'ana' });
  });

  it('cannot attribute twice, without a reason, or across organizations', async () => {
    const d = await deposit(5n, null);
    await expect(
      attributeDeposit(t.sql, {
        orgId,
        depositId: d.id,
        customerId: alice,
        actor: 'a',
        reason: ' ',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await attributeDeposit(t.sql, {
      orgId,
      depositId: d.id,
      customerId: alice,
      actor: 'a',
      reason: 'ok',
    });
    await expect(
      attributeDeposit(t.sql, {
        orgId,
        depositId: d.id,
        customerId: bob,
        actor: 'a',
        reason: 'again',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const [{ id: other }] =
      (await t.sql`INSERT INTO organizations (name) VALUES ('Other') RETURNING id`) as unknown as [
        { id: string },
      ];
    await expect(
      attributeDeposit(t.sql, {
        orgId: other,
        depositId: d.id,
        customerId: alice,
        actor: 'a',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('concurrent attributions of the same deposit: exactly one wins', async () => {
    const d = await deposit(9n, null);
    const results = await Promise.allSettled(
      [alice, bob, alice].map((c) =>
        attributeDeposit(t.sql, {
          orgId,
          depositId: d.id,
          customerId: c,
          actor: 'a',
          reason: 'race',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [{ n }] =
      (await t.sql`SELECT count(*)::int AS n FROM journal_entries WHERE kind = 'reattribution'`) as unknown as [
        { n: number },
      ];
    expect(n).toBe(1);
  });
});

describe('case transitions', () => {
  it('enforces the state machine in code and in the database', async () => {
    const d = await deposit(1n, null);
    const [c] = await t.sql<
      { id: string }[]
    >`SELECT id FROM exception_cases WHERE subject_ref = ${'deposit:' + d.id}`;
    await transitionCase(t.sql, {
      orgId,
      caseId: c!.id,
      to: 'investigating',
      actor: 'ana',
      reason: 'looking',
    });
    await transitionCase(t.sql, {
      orgId,
      caseId: c!.id,
      to: 'dismissed',
      actor: 'ana',
      reason: 'dust',
    });
    await expect(
      transitionCase(t.sql, { orgId, caseId: c!.id, to: 'open', actor: 'ana', reason: 'x' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(
      t.sql`UPDATE exception_cases SET status = 'open' WHERE id = ${c!.id}`,
    ).rejects.toThrow(/invalid case transition/);
    await expect(t.sql`DELETE FROM exception_cases`).rejects.toThrow(/append-only/);
  });
});
