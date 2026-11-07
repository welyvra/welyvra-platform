import { createTestDatabase } from '@welyvra/db/testing';
import { ingestUntilCaughtUp } from '@welyvra/ingestion';
import { RecordedEventSource } from '@welyvra/ingestion/testing';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { buildOpenApi } from '../services/openapi.js';
import { generateApiKey } from '../utils/security.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/stellar/p30-testnet-events.json', import.meta.url),
    'utf8',
  ),
);
const KEY = 'a'.repeat(64);
let t: Awaited<ReturnType<typeof createTestDatabase>>;
let app: FastifyInstance;
const keys: Record<string, string> = {};
let orgA: string;

async function makeOrg(name: string) {
  const [o] = await t.sql<
    { id: string }[]
  >`INSERT INTO organizations (name) VALUES (${name}) RETURNING id`;
  for (const role of ['admin', 'operator', 'viewer'] as const) {
    const k = generateApiKey();
    await t.sql`INSERT INTO api_keys (org_id, name, prefix, secret_hash, role) VALUES (${o!.id}, ${role}, ${k.prefix}, ${k.secretHash}, ${role})`;
    keys[`${name}:${role}`] = k.key;
  }
  return o!.id;
}

const call = (key: string | null, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    payload: payload as never,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

beforeAll(async () => {
  t = await createTestDatabase();
  orgA = await makeOrg('A');
  await makeOrg('B');
  app = await buildApp({
    sql: t.sql,
    webhookEncryptionKey: KEY,
    rateLimitPerMinute: 1000,
    urlPolicy: { resolve: async () => ['93.184.215.14'] },
  });
});
afterAll(async () => {
  await app?.close();
  await t?.close();
});

describe('end-to-end through the API with real testnet events', () => {
  it('registers accounts and customers, ingests, attributes, reconciles', async () => {
    const admin = keys['A:admin']!;
    const op = keys['A:operator']!;
    const g = await call(admin, 'POST', '/v1/receiving-accounts', {
      network: 'testnet',
      address: fixture.accounts.receiver,
    });
    const c = await call(admin, 'POST', '/v1/receiving-accounts', {
      network: 'testnet',
      address: fixture.accounts.receivingContract,
    });
    expect([g.statusCode, c.statusCode]).toEqual([201, 201]);
    const alice = (await call(op, 'POST', '/v1/customers', { external_ref: 'alice' })).json();
    const r = await call(op, 'POST', `/v1/customers/${alice.id}/routing-keys`, {
      receiving_account_id: g.json().id,
      kind: 'id',
      value: '1001',
    });
    expect(r.statusCode).toBe(201);

    await ingestUntilCaughtUp({
      sql: t.sql,
      source: new RecordedEventSource(fixture.getEventsResult.events),
      network: 'testnet',
      sourceName: 'api-test',
      tokenContracts: [fixture.accounts.nativeSac],
      startLedger: Math.min(
        ...fixture.getEventsResult.events.map((e: { ledger: number }) => e.ledger),
      ),
    });

    const deposits = (await call(keys['A:viewer']!, 'GET', '/v1/deposits')).json().data;
    expect(deposits).toHaveLength(6);
    expect(deposits.filter((d: { status: string }) => d.status === 'attributed')).toHaveLength(1);
    expect(typeof deposits[0].amount).toBe('string'); // never a JSON number

    const unattributed = (await call(op, 'GET', '/v1/deposits?status=unattributed')).json().data;
    const res = await call(op, 'POST', `/v1/deposits/${unattributed[0].id}/attribute`, {
      customer_id: alice.id,
      reason: 'confirmed by support',
    });
    expect(res.statusCode).toBe(200);
    expect(
      (
        await call(op, 'POST', `/v1/deposits/${unattributed[0].id}/attribute`, {
          customer_id: alice.id,
          reason: 'again',
        })
      ).statusCode,
    ).toBe(409);

    const rec = await call(op, 'POST', '/v1/internal-records', {
      records: [
        {
          external_id: 'inv-1',
          customer_id: alice.id,
          token_contract: fixture.accounts.nativeSac,
          amount: '10000001',
          tx_hash: fixture.transactions.memo.hash,
        },
      ],
    });
    expect(rec.json()).toEqual({ created: 1, duplicates: 0, conflicts: [] });
    const run = await call(op, 'POST', '/v1/reconciliation-runs');
    expect(run.statusCode).toBe(201);
    expect(run.json().summary.matched).toBe(1);
    const detail = await call(
      keys['A:viewer']!,
      'GET',
      `/v1/reconciliation-runs/${run.json().runId}`,
    );
    expect(detail.json().results.length).toBe(6);

    const balances = (await call(keys['A:viewer']!, 'GET', '/v1/ledger/balances')).json().data;
    expect(balances.reduce((s: bigint, b: { amount: string }) => s + BigInt(b.amount), 0n)).toBe(
      0n,
    );
    expect(
      (await call(keys['A:viewer']!, 'GET', '/v1/audit-log')).json().data.length,
    ).toBeGreaterThan(0);
  });
});

describe('authentication', () => {
  it.each([
    ['no header', null],
    ['malformed', 'nope'],
    ['unknown key', generateApiKey().key],
    [
      'right prefix, wrong secret',
      () => keys['A:admin']!.replace(/_[a-z0-9]{32}$/, '_' + 'x'.repeat(32)),
    ],
  ])('%s -> 401', async (_n, key) => {
    const k = typeof key === 'function' ? key() : key;
    expect((await call(k, 'GET', '/v1/deposits')).statusCode).toBe(401);
  });

  it('revoked keys are rejected', async () => {
    const k = generateApiKey();
    await t.sql`INSERT INTO api_keys (org_id, name, prefix, secret_hash, role, revoked_at) VALUES (${orgA}, 'old', ${k.prefix}, ${k.secretHash}, 'admin', now())`;
    expect((await call(k.key, 'GET', '/v1/deposits')).statusCode).toBe(401);
  });

  it('health needs no key', async () => {
    expect((await call(null, 'GET', '/v1/health')).json()).toEqual({ status: 'ok' });
  });
});

describe('roles', () => {
  const writes: [string, string, unknown][] = [
    ['admin', '/v1/receiving-accounts', { network: 'testnet', address: 'G' + 'Z'.repeat(55) }],
    ['admin', '/v1/api-keys', { name: 'x', role: 'viewer' }],
    ['operator', '/v1/customers', { external_ref: `r-${Math.random()}` }],
    ['operator', '/v1/reconciliation-runs', undefined],
  ];
  it.each(writes)('endpoint needing %s rejects lower roles with 403', async (min, url, body) => {
    const lower = min === 'admin' ? ['operator', 'viewer'] : ['viewer'];
    for (const role of lower)
      expect((await call(keys[`A:${role}`]!, 'POST', url, body)).statusCode).toBe(403);
  });
  it('viewer can read', async () => {
    for (const url of [
      '/v1/deposits',
      '/v1/customers',
      '/v1/cases',
      '/v1/reconciliation-runs',
      '/v1/ledger/balances',
      '/v1/audit-log',
      '/v1/sync-status',
    ]) {
      expect((await call(keys['A:viewer']!, 'GET', url)).statusCode).toBe(200);
    }
  });
});

describe('tenant isolation', () => {
  it('organization B never sees or touches organization A data', async () => {
    const depositA = (await call(keys['A:viewer']!, 'GET', '/v1/deposits')).json().data[0];
    const caseA = (await call(keys['A:viewer']!, 'GET', '/v1/cases')).json().data[0];
    const runA = (await call(keys['A:viewer']!, 'GET', '/v1/reconciliation-runs')).json().data[0];
    const custA = (await call(keys['A:viewer']!, 'GET', '/v1/customers')).json().data[0];
    const accA = (await call(keys['A:viewer']!, 'GET', '/v1/receiving-accounts')).json().data[0];
    expect([depositA, caseA, runA, custA, accA].every(Boolean)).toBe(true);

    const B = keys['B:admin']!;
    for (const url of [
      '/v1/deposits',
      '/v1/cases',
      '/v1/reconciliation-runs',
      '/v1/customers',
      '/v1/receiving-accounts',
      '/v1/ledger/balances',
      '/v1/audit-log',
    ]) {
      expect((await call(B, 'GET', url)).json().data).toEqual([]);
    }
    expect((await call(B, 'GET', `/v1/deposits/${depositA.id}`)).statusCode).toBe(404);
    expect((await call(B, 'GET', `/v1/cases/${caseA.id}`)).statusCode).toBe(404);
    expect((await call(B, 'GET', `/v1/reconciliation-runs/${runA.id}`)).statusCode).toBe(404);
    expect(
      (await call(B, 'POST', `/v1/cases/${caseA.id}/transitions`, { to: 'dismissed', reason: 'x' }))
        .statusCode,
    ).toBe(404);
    const custB = (await call(B, 'POST', '/v1/customers', { external_ref: 'b1' })).json();
    expect(
      (
        await call(B, 'POST', `/v1/deposits/${depositA.id}/attribute`, {
          customer_id: custB.id,
          reason: 'x',
        })
      ).statusCode,
    ).toBe(404);
    // B cannot attach a routing key to A's receiving account or A's customer.
    expect(
      (
        await call(B, 'POST', `/v1/customers/${custB.id}/routing-keys`, {
          receiving_account_id: accA.id,
          kind: 'id',
          value: '7',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(B, 'POST', '/v1/internal-records', {
          records: [
            {
              external_id: 'z',
              customer_id: custA.id,
              token_contract: fixture.accounts.nativeSac,
              amount: '1',
            },
          ],
        })
      ).statusCode,
    ).toBe(404);
    // B cannot register an address A already owns.
    expect(
      (
        await call(B, 'POST', '/v1/receiving-accounts', {
          network: 'testnet',
          address: accA.address,
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('validation', () => {
  it.each([
    [
      'float amount',
      { records: [{ external_id: 'f', token_contract: 'C' + 'A'.repeat(55), amount: '1.5' }] },
    ],
    [
      'numeric amount',
      { records: [{ external_id: 'n', token_contract: 'C' + 'A'.repeat(55), amount: 5 }] },
    ],
    [
      'negative amount',
      { records: [{ external_id: 'g', token_contract: 'C' + 'A'.repeat(55), amount: '-1' }] },
    ],
    [
      'unknown field',
      {
        records: [
          { external_id: 'u', token_contract: 'C' + 'A'.repeat(55), amount: '1', evil: true },
        ],
      },
    ],
  ])('%s -> 400', async (_n, body) => {
    expect((await call(keys['A:operator']!, 'POST', '/v1/internal-records', body)).statusCode).toBe(
      400,
    );
  });
  it('rejects malformed routing ids', async () => {
    const acc = (await call(keys['A:viewer']!, 'GET', '/v1/receiving-accounts')).json().data[0];
    const cust = (await call(keys['A:viewer']!, 'GET', '/v1/customers')).json().data[0];
    for (const value of ['-1', '18446744073709551616', 'abc']) {
      const res = await call(keys['A:operator']!, 'POST', `/v1/customers/${cust.id}/routing-keys`, {
        receiving_account_id: acc.id,
        kind: 'id',
        value,
      });
      expect({ value, status: res.statusCode, body: res.json() }).toMatchObject({
        value,
        status: 400,
      });
    }
  });
  it('rejects invalid case transitions with 409', async () => {
    const c = (await call(keys['A:viewer']!, 'GET', '/v1/cases?status=resolved')).json().data[0];
    expect(
      (
        await call(keys['A:operator']!, 'POST', `/v1/cases/${c.id}/transitions`, {
          to: 'investigating',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('api keys and webhook endpoints', () => {
  it('a new key is shown once and works; only its hash is stored', async () => {
    const res = await call(keys['A:admin']!, 'POST', '/v1/api-keys', {
      name: 'ci',
      role: 'viewer',
    });
    const { key } = res.json();
    expect((await call(key, 'GET', '/v1/deposits')).statusCode).toBe(200);
    const rows = await t.sql`SELECT secret_hash FROM api_keys WHERE name = 'ci'`;
    expect(JSON.stringify(rows)).not.toContain(key.split('_')[2]);
  });
  it('webhook secrets are returned once and stored encrypted', async () => {
    const res = await call(keys['A:admin']!, 'POST', '/v1/webhook-endpoints', {
      url: 'https://hooks.example.com/welyvra',
    });
    expect(res.statusCode).toBe(201);
    const { secret } = res.json();
    const [row] = await t.sql<
      { secret_ciphertext: string }[]
    >`SELECT secret_ciphertext FROM webhook_endpoints`;
    expect(row!.secret_ciphertext).not.toContain(secret);
    expect(
      JSON.stringify((await call(keys['A:admin']!, 'GET', '/v1/webhook-endpoints')).json()),
    ).not.toContain(secret);
  });
  it.each([
    'http://hooks.example.com',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest',
    'https://[::1]/',
    'https://user:pw@example.com',
    'not a url',
  ])('rejects unsafe webhook URL %s', async (url) => {
    expect(
      (await call(keys['A:admin']!, 'POST', '/v1/webhook-endpoints', { url })).statusCode,
    ).toBe(400);
  });
});

describe('rate limiting', () => {
  it('limits per API key', async () => {
    const limited = await buildApp({
      sql: t.sql,
      webhookEncryptionKey: KEY,
      rateLimitPerMinute: 3,
    });
    try {
      const codes = [];
      for (let i = 0; i < 5; i++)
        codes.push(
          (
            await limited.inject({
              method: 'GET',
              url: '/v1/cases',
              headers: { authorization: `Bearer ${keys['A:viewer']}` },
            })
          ).statusCode,
        );
      expect(codes).toEqual([200, 200, 200, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe('OpenAPI', () => {
  it('docs/api/openapi.json matches the code (run `pnpm --filter @welyvra/api openapi` after changing routes)', async () => {
    const committed = readFileSync(
      new URL('../../../../docs/api/openapi.json', import.meta.url),
      'utf8',
    ).trim();
    expect(JSON.parse(committed)).toEqual(JSON.parse(await buildOpenApi()));
  });
});
