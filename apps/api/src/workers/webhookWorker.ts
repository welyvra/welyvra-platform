import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from 'postgres';
import { type DispatchOptions, dispatchDue } from '../services/webhooks/dispatcher.js';

/** Delivers due webhooks every `intervalMs` until `signal` aborts. Errors are logged, never fatal. */
export async function runWebhookWorker(opts: {
  sql: Sql;
  dispatch: DispatchOptions;
  log: FastifyBaseLogger;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<void> {
  while (!opts.signal.aborted) {
    try {
      const r = await dispatchDue(opts.sql, opts.dispatch);
      if (r.delivered + r.retried + r.failed > 0) opts.log.info(r, 'webhooks.dispatch');
    } catch (e) {
      opts.log.error({ err: e }, 'webhooks.dispatch_error');
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 2_000));
  }
}
