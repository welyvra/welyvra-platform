import { createTestDatabase } from '@welyvra/db/testing';
import { enqueueWebhook } from '@welyvra/reconciliation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret, signWebhook, verifyWebhook } from '../utils/security.js';
import { backoffSeconds, dispatchDue } from '../services/webhooks/dispatcher.js';
import { assertSafeWebhookUrl, isBlockedAddress } from '../services/webhooks/ssrf.js';

const KEY = 'b'.repeat(64);
const SECRET = 'whsec_test';
let t: Awaited<ReturnType<typeof createTestDatabase>>;
let orgId: string;
const policy = { resolve: async () => ['93.184.215.14'] };
// Explicit clock slightly ahead: the database clock (e.g. a Docker VM) may differ from the host.
const soon = () => new Date(Date.now() + 60_000);

beforeEach(async () => {
  t = await createTestDatabase();
  [{ id: orgId }] =
    (await t.sql`INSERT INTO organizations (name) VALUES ('W') RETURNING id`) as unknown as [
      { id: string },
    ];
  await t.sql`INSERT INTO webhook_endpoints (org_id, url, secret_ciphertext) VALUES (${orgId}, 'https://hooks.example.com/w', ${encryptSecret(SECRET, KEY)})`;
});
afterEach(async () => {
  await t?.close();
});

function recorder(status = 200) {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response('', { status });
  }) as unknown as typeof fetch;
  return { fn, sent };
}

describe('signatures', () => {
  it('a receiver can verify, and rejects tampering, wrong secrets and replays', () => {
    const body = '{"a":1}';
    const header = signWebhook(SECRET, body, 1_000_000);
    expect(verifyWebhook(SECRET, header, body, 1_000_100)).toBe(true);
    expect(verifyWebhook(SECRET, header, '{"a":2}', 1_000_100)).toBe(false);
    expect(verifyWebhook('other', header, body, 1_000_100)).toBe(false);
    expect(verifyWebhook(SECRET, header, body, 1_000_000 + 301)).toBe(false); // older than 5 minutes
    expect(verifyWebhook(SECRET, 't=1,v1=zz', body, 1)).toBe(false);
  });
});

describe('dispatcher', () => {
  it('delivers signed payloads with an idempotency id, exactly once', async () => {
    await t.sql.begin((tx) =>
      enqueueWebhook(tx as never, orgId, 'deposit.created', { deposit_id: 'd1', amount: '5' }),
    );
    const r = recorder();
    const now = new Date(Date.now() + 60_000); // rows are due from their real creation time
    expect(
      await dispatchDue(t.sql, {
        encryptionKey: KEY,
        fetch: r.fn,
        urlPolicy: policy,
        now: () => now,
      }),
    ).toEqual({ delivered: 1, retried: 0, failed: 0 });
    expect(
      await dispatchDue(t.sql, {
        encryptionKey: KEY,
        fetch: r.fn,
        urlPolicy: policy,
        now: () => now,
      }),
    ).toEqual({ delivered: 0, retried: 0, failed: 0 });
    const [msg] = r.sent;
    const [row] = await t.sql<{ id: string }[]>`SELECT id FROM webhook_outbox`;
    expect(msg!.headers['welyvra-delivery']).toBe(row!.id);
    expect(
      verifyWebhook(SECRET, msg!.headers['welyvra-signature']!, msg!.body, now.getTime() / 1000),
    ).toBe(true);
    expect(JSON.parse(msg!.body)).toMatchObject({
      id: row!.id,
      type: 'deposit.created',
      data: { deposit_id: 'd1', amount: '5' },
    });
  });

  it('retries with backoff and gives up after max attempts', async () => {
    await t.sql.begin((tx) => enqueueWebhook(tx as never, orgId, 'case.opened', {}));
    const r = recorder(500);
    let clock = Date.now() + 60_000;
    const opts = {
      encryptionKey: KEY,
      fetch: r.fn,
      urlPolicy: policy,
      maxAttempts: 3,
      now: () => new Date(clock),
    };
    expect((await dispatchDue(t.sql, opts)).retried).toBe(1);
    expect((await dispatchDue(t.sql, opts)).retried).toBe(0); // not due yet
    clock += backoffSeconds(1) * 1000;
    expect((await dispatchDue(t.sql, opts)).retried).toBe(1);
    clock += backoffSeconds(2) * 1000;
    expect((await dispatchDue(t.sql, opts)).failed).toBe(1);
    const [row] = await t.sql`SELECT status, attempts, last_error FROM webhook_outbox`;
    expect(row).toEqual({ status: 'failed', attempts: 3, last_error: 'HTTP 500' });
  });

  it('re-checks the destination at delivery time (DNS rebinding) and never calls internal addresses', async () => {
    await t.sql.begin((tx) => enqueueWebhook(tx as never, orgId, 'case.opened', {}));
    const r = recorder();
    const res = await dispatchDue(t.sql, {
      encryptionKey: KEY,
      fetch: r.fn,
      urlPolicy: { resolve: async () => ['10.0.0.5'] },
      now: soon,
    });
    expect(res.retried).toBe(1);
    expect(r.sent).toHaveLength(0);
  });

  it('concurrent dispatchers never send the same row twice', async () => {
    for (let i = 0; i < 20; i++)
      await t.sql.begin((tx) => enqueueWebhook(tx as never, orgId, 'case.opened', { i }));
    const r = recorder();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        dispatchDue(t.sql, {
          encryptionKey: KEY,
          fetch: r.fn,
          urlPolicy: policy,
          limit: 7,
          now: soon,
        }),
      ),
    );
    const ids = r.sent.map((s) => s.headers['welyvra-delivery']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
  });
});

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(['93.184.215.14', '8.8.8.8', '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
  it('rejects hosts that resolve to any private address', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example', {
        resolve: async () => ['93.184.215.14', '127.0.0.1'],
      }),
    ).rejects.toThrow(/private/);
  });
});
