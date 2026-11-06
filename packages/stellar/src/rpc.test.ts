import { describe, expect, it } from 'vitest';
import { RetentionGapError, RpcEventSource } from './index.js';

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
const page = { events: [], cursor: 'c', latestLedger: 10, oldestLedger: 1 };

function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  const calls: unknown[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('RpcEventSource', () => {
  it('sends startLedger or cursor pagination as stellar-rpc expects', async () => {
    const f = fakeFetch([() => ok(page), () => ok(page)]);
    const src = new RpcEventSource({ url: 'http://rpc', fetch: f.fn });
    await src.getEvents({ startLedger: 5, contractIds: ['C1'], limit: 10 });
    await src.getEvents({ cursor: 'abc', contractIds: ['C1'], limit: 10 });
    expect(f.calls).toMatchObject([
      {
        method: 'getEvents',
        params: {
          startLedger: 5,
          pagination: { limit: 10 },
          filters: [{ type: 'contract', contractIds: ['C1'] }],
        },
      },
      { method: 'getEvents', params: { pagination: { cursor: 'abc', limit: 10 } } },
    ]);
  });

  it('retries 5xx and network errors with backoff, then succeeds', async () => {
    const f = fakeFetch([
      () => new Response('down', { status: 503 }),
      () => Promise.reject(new TypeError('fetch failed')),
      () => ok(page),
    ]);
    const res = await new RpcEventSource({ url: 'http://rpc', fetch: f.fn }).getEvents({
      startLedger: 1,
      contractIds: [],
      limit: 1,
    });
    expect(res.cursor).toBe('c');
    expect(f.calls).toHaveLength(3);
  });

  it('gives up after the configured number of retries', async () => {
    const f = fakeFetch(
      Array.from({ length: 3 }, () => () => new Response('down', { status: 500 })),
    );
    await expect(
      new RpcEventSource({ url: 'http://rpc', fetch: f.fn, retries: 3 }).getEvents({
        startLedger: 1,
        contractIds: [],
        limit: 1,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('maps the retention error to RetentionGapError and does not retry it', async () => {
    const err = () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message:
              'startLedger must be between the oldest ledger: 100 and the latest ledger: 200',
          },
        }),
      );
    const f = fakeFetch([err]);
    const p = new RpcEventSource({ url: 'http://rpc', fetch: f.fn }).getEvents({
      startLedger: 1,
      contractIds: [],
      limit: 1,
    });
    await expect(p).rejects.toBeInstanceOf(RetentionGapError);
    await expect(p).rejects.toMatchObject({ oldestLedger: 100 });
    expect(f.calls).toHaveLength(1);
  });

  it('rejects malformed responses', async () => {
    const f = fakeFetch([() => ok({ nope: true })]);
    await expect(
      new RpcEventSource({ url: 'http://rpc', fetch: f.fn }).getEvents({
        startLedger: 1,
        contractIds: [],
        limit: 1,
      }),
    ).rejects.toThrow(/malformed/);
  });
});
