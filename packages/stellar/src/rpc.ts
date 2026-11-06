import type { RawRpcEvent } from './decode.js';

export interface EventPage {
  events: RawRpcEvent[];
  /** Opaque RPC cursor to resume after this page. */
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
}

export type EventQuery = { contractIds: string[]; limit: number } & (
  { cursor: string } | { startLedger: number }
);

/** Anything that can page through contract events. Real RPC in production, recorded data in tests. */
export interface EventSource {
  getEvents(query: EventQuery): Promise<EventPage>;
}

/** Raised when the requested position is older than the RPC retention window. */
export class RetentionGapError extends Error {
  constructor(
    message: string,
    readonly oldestLedger: number | null,
  ) {
    super(message);
    this.name = 'RetentionGapError';
  }
}

export interface RpcOptions {
  url: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

/**
 * Minimal JSON-RPC client for `getEvents`. Retries network errors and 5xx with
 * exponential backoff (pattern adapted from Akkuea's StellarService: 5 attempts,
 * 100 ms initial, 5 s cap). Never retries JSON-RPC errors: they are deterministic.
 */
export class RpcEventSource implements EventSource {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: RpcOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 5;
    this.fetchFn = options.fetch ?? fetch;
  }

  async getEvents(query: EventQuery): Promise<EventPage> {
    const filters = [{ type: 'contract', contractIds: query.contractIds }];
    const params =
      'cursor' in query
        ? { filters, pagination: { cursor: query.cursor, limit: query.limit } }
        : { startLedger: query.startLedger, filters, pagination: { limit: query.limit } };
    const result = (await this.call('getEvents', params)) as Partial<EventPage> & {
      events?: RawRpcEvent[];
    };
    if (!Array.isArray(result.events) || typeof result.cursor !== 'string') {
      throw new Error('getEvents: malformed response');
    }
    return {
      events: result.events,
      cursor: result.cursor,
      latestLedger: Number(result.latestLedger),
      oldestLedger: Number(result.oldestLedger),
    };
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    let delay = 100;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.fetchFn(this.options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status >= 500) throw new TransientError(`RPC HTTP ${res.status}`);
        if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
        const body = (await res.json()) as {
          result?: unknown;
          error?: { code: number; message: string };
        };
        if (body.error) {
          const msg = body.error.message ?? 'unknown';
          // stellar-rpc rejects positions outside its retention window with an explicit message.
          if (/startLedger must be between|cursor.*(older|before)|retention/i.test(msg)) {
            throw new RetentionGapError(msg, parseOldest(msg));
          }
          throw new Error(`RPC ${method} error ${body.error.code}: ${msg}`);
        }
        return body.result;
      } catch (e) {
        const transient =
          e instanceof TransientError ||
          (e instanceof Error &&
            /fetch failed|aborted|timeout|ECONN/i.test(e.message + String(e.name)));
        if (!transient || attempt >= this.retries) throw e;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 5_000);
      }
    }
  }
}

class TransientError extends Error {}

function parseOldest(msg: string): number | null {
  const m = /between the oldest ledger: (\d+)/i.exec(msg) ?? /oldest[^\d]*(\d+)/i.exec(msg);
  return m ? Number(m[1]) : null;
}
