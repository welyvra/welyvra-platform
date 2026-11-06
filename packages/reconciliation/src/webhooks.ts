import type { Sql } from 'postgres';

export type WebhookEventType =
  'deposit.created' | 'case.opened' | 'case.updated' | 'reconciliation.completed';

/** Queues one outbox row per active endpoint of the organization. Call inside the transaction of the change. */
export async function enqueueWebhook(
  tx: Sql,
  orgId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<number> {
  const payload = JSON.stringify({ type, created_at: new Date().toISOString(), data });
  const rows = await tx`
    INSERT INTO webhook_outbox (org_id, endpoint_id, event_type, payload)
    SELECT ${orgId}, id, ${type}, ${payload}::jsonb FROM webhook_endpoints WHERE org_id = ${orgId} AND active
    RETURNING id`;
  return rows.length;
}
