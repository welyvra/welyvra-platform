import { inTransaction } from '@welyvra/db';
import type { Sql } from 'postgres';
import { decryptSecret, signWebhook } from '../security.js';
import { type UrlPolicy, assertSafeWebhookUrl } from './ssrf.js';

export interface DispatchOptions {
  encryptionKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
  urlPolicy?: UrlPolicy;
  limit?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface DispatchResult {
  delivered: number;
  retried: number;
  failed: number;
}

/** Backoff after the n-th failed attempt: 30 s, 1 min, 2 min ... capped at 1 h. */
export const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 3600);

/**
 * Delivers due outbox rows (at least once). Rows are claimed with FOR UPDATE SKIP LOCKED and
 * leased for 5 minutes, so several dispatchers never send the same row concurrently. Each
 * delivery carries `Welyvra-Delivery: <outbox id>` for receiver-side idempotency.
 */
export async function dispatchDue(sql: Sql, opts: DispatchOptions): Promise<DispatchResult> {
  const now = opts.now ?? (() => new Date());
  const maxAttempts = opts.maxAttempts ?? 10;
  const claimed = await inTransaction(
    sql,
    (tx) =>
      tx<
        {
          id: string;
          event_type: string;
          payload: unknown;
          attempts: number;
          url: string;
          secret_ciphertext: string;
        }[]
      >`
      UPDATE webhook_outbox o SET next_attempt_at = ${now().toISOString()}::timestamptz + interval '5 minutes'
      FROM webhook_endpoints e
      WHERE o.id IN (
        SELECT id FROM webhook_outbox
        WHERE status = 'pending' AND next_attempt_at <= ${now().toISOString()}::timestamptz
        ORDER BY next_attempt_at, created_at LIMIT ${opts.limit ?? 50} FOR UPDATE SKIP LOCKED
      ) AND e.id = o.endpoint_id
      RETURNING o.id, o.event_type, o.payload, o.attempts, e.url, e.secret_ciphertext`,
  );

  const result: DispatchResult = { delivered: 0, retried: 0, failed: 0 };
  for (const row of claimed) {
    const body = JSON.stringify({ id: row.id, ...(row.payload as object) });
    let error: string | null = null;
    try {
      await assertSafeWebhookUrl(row.url, opts.urlPolicy);
      const secret = decryptSecret(row.secret_ciphertext, opts.encryptionKey);
      const res = await (opts.fetch ?? fetch)(row.url, {
        method: 'POST',
        redirect: 'manual', // a redirect could point at an internal address
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Welyvra-Webhooks/0',
          'welyvra-delivery': row.id,
          'welyvra-event': row.event_type,
          'welyvra-signature': signWebhook(secret, body, Math.floor(now().getTime() / 1000)),
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 500);
    }

    if (!error) {
      await sql`UPDATE webhook_outbox SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ${row.id}`;
      result.delivered++;
      continue;
    }
    const attempts = row.attempts + 1;
    if (attempts >= maxAttempts) {
      await sql`UPDATE webhook_outbox SET status = 'failed', attempts = ${attempts}, last_error = ${error} WHERE id = ${row.id}`;
      result.failed++;
    } else {
      const next = new Date(now().getTime() + backoffSeconds(attempts) * 1000);
      await sql`UPDATE webhook_outbox SET attempts = ${attempts}, last_error = ${error}, next_attempt_at = ${next.toISOString()}::timestamptz WHERE id = ${row.id}`;
      result.retried++;
    }
  }
  return result;
}
