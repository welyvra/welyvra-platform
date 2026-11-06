import { parseRoutingId } from '@welyvra/core';
import {
  attributeDeposit,
  audit,
  balances,
  recordInternalRecords,
  runReconciliation,
  transitionCase,
} from '@welyvra/reconciliation';
import { one } from '@welyvra/db';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './app.js';
import { auth, requireRole } from './auth.js';
import * as S from './schemas.js';
import { encryptSecret, generateApiKey, generateWebhookSecret } from './security.js';
import { assertSafeWebhookUrl } from './webhooks/ssrf.js';

type Id = { id: string };
type Limit = { limit: number };

function normalizeRoutingKey(k: { kind: 'id' | 'text' | 'hash'; value: string }) {
  if (k.kind === 'id') return parseRoutingId(k.value);
  if (k.kind === 'hash' && !/^[0-9a-f]{64}$/.test(k.value))
    throw Object.assign(new Error('hash must be 64 lowercase hex'), { statusCode: 400 });
  if (k.kind === 'text' && Buffer.byteLength(k.value) > 28)
    throw Object.assign(new Error('memo text is at most 28 bytes'), { statusCode: 400 });
  return k;
}

export function registerRoutes(app: FastifyInstance, cfg: AppConfig): void {
  const { sql } = cfg;
  const viewer = { preHandler: requireRole('viewer') };
  const operator = { preHandler: requireRole('operator') };
  const admin = { preHandler: requireRole('admin') };

  // Receiving accounts
  app.get('/v1/receiving-accounts', { ...viewer, schema: { tags: ['accounts'] } }, async (req) => {
    const { orgId } = auth(req);
    return {
      data: await sql`SELECT id, network, address, label, created_at FROM receiving_accounts WHERE org_id = ${orgId} ORDER BY created_at`,
    };
  });
  app.post<{ Body: { network: 'testnet' | 'mainnet'; address: string; label?: string } }>(
    '/v1/receiving-accounts',
    {
      ...admin,
      schema: {
        tags: ['accounts'],
        body: {
          type: 'object',
          required: ['network', 'address'],
          additionalProperties: false,
          properties: {
            network: { type: 'string', enum: ['testnet', 'mainnet'] },
            address: S.stellarAddress,
            label: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const a = auth(req);
      const row = one(
        await sql`
        INSERT INTO receiving_accounts (org_id, network, address, label)
        VALUES (${a.orgId}, ${req.body.network}, ${req.body.address}, ${req.body.label ?? null})
        RETURNING id, network, address, label, created_at`,
      );
      await audit(sql, {
        orgId: a.orgId,
        actor: a.actor,
        action: 'receiving_account.create',
        subject: `receiving_account:${row.id}`,
        after: row,
      });
      return reply.code(201).send(row);
    },
  );

  // Customers and routing keys
  app.get<{ Querystring: Limit }>(
    '/v1/customers',
    { ...viewer, schema: { tags: ['customers'], querystring: S.listQuery } },
    async (req) => {
      const { orgId } = auth(req);
      return {
        data: await sql`
        SELECT c.id, c.external_ref, c.name, c.created_at,
          COALESCE(json_agg(json_build_object('receiving_account_id', k.receiving_account_id, 'kind', k.kind, 'value', k.value))
            FILTER (WHERE k.id IS NOT NULL), '[]') AS routing_keys
        FROM customers c LEFT JOIN routing_keys k ON k.customer_id = c.id AND k.org_id = c.org_id
        WHERE c.org_id = ${orgId} GROUP BY c.id ORDER BY c.created_at LIMIT ${req.query.limit}`,
      };
    },
  );
  app.post<{ Body: { external_ref: string; name?: string } }>(
    '/v1/customers',
    {
      ...operator,
      schema: {
        tags: ['customers'],
        body: {
          type: 'object',
          required: ['external_ref'],
          additionalProperties: false,
          properties: {
            external_ref: { type: 'string', minLength: 1, maxLength: 200 },
            name: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const a = auth(req);
      const row = one(
        await sql`
        INSERT INTO customers (org_id, external_ref, name) VALUES (${a.orgId}, ${req.body.external_ref}, ${req.body.name ?? null})
        RETURNING id, external_ref, name, created_at`,
      );
      await audit(sql, {
        orgId: a.orgId,
        actor: a.actor,
        action: 'customer.create',
        subject: `customer:${row.id}`,
        after: row,
      });
      return reply.code(201).send(row);
    },
  );
  app.post<{
    Params: Id;
    Body: { receiving_account_id: string; kind: 'id' | 'text' | 'hash'; value: string };
  }>(
    '/v1/customers/:id/routing-keys',
    {
      ...operator,
      schema: {
        tags: ['customers'],
        params: S.idParams,
        body: {
          type: 'object',
          required: ['receiving_account_id', 'kind', 'value'],
          additionalProperties: false,
          properties: { receiving_account_id: S.uuid, ...S.routingKey.properties },
        },
      },
    },
    async (req, reply) => {
      const a = auth(req);
      const key = normalizeRoutingKey(req.body) as { kind: string; value: string };
      // Composite foreign keys reject another tenant's account or customer (mapped to 404).
      const row = one(
        await sql`
        INSERT INTO routing_keys (org_id, receiving_account_id, kind, value, customer_id)
        VALUES (${a.orgId}, ${req.body.receiving_account_id}, ${key.kind}::routing_kind, ${key.value}, ${req.params.id})
        RETURNING id, receiving_account_id, kind, value, customer_id`,
      );
      await audit(sql, {
        orgId: a.orgId,
        actor: a.actor,
        action: 'routing_key.create',
        subject: `customer:${req.params.id}`,
        after: row,
      });
      return reply.code(201).send(row);
    },
  );

  // Deposits
  app.get<{ Querystring: Limit & { status?: string; customer_id?: string } }>(
    '/v1/deposits',
    {
      ...viewer,
      schema: {
        tags: ['deposits'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...S.listQuery.properties,
            status: { type: 'string', enum: ['attributed', 'unattributed'] },
            customer_id: S.uuid,
          },
        },
      },
    },
    async (req) => {
      const { orgId } = auth(req);
      const { status, customer_id, limit } = req.query;
      return {
        data: await sql`
          SELECT d.id, d.status, d.customer_id, d.receiving_account_id, d.token_contract, d.amount::text AS amount,
                 ce.event_id, ce.tx_hash, ce.ledger, ce.ledger_closed_at, ce.from_address, ce.routing_kind, ce.routing_value, d.created_at
          FROM deposits d JOIN chain_events ce ON ce.id = d.chain_event_id
          WHERE d.org_id = ${orgId}
            ${status ? sql`AND d.status = ${status}::deposit_status` : sql``}
            ${customer_id ? sql`AND d.customer_id = ${customer_id}` : sql``}
          ORDER BY ce.event_id DESC LIMIT ${limit}`,
      };
    },
  );
  app.get<{ Params: Id }>(
    '/v1/deposits/:id',
    { ...viewer, schema: { tags: ['deposits'], params: S.idParams } },
    async (req, reply) => {
      const { orgId } = auth(req);
      const [row] = await sql`
        SELECT d.id, d.status, d.customer_id, d.receiving_account_id, d.token_contract, d.amount::text AS amount,
               ce.event_id, ce.tx_hash, ce.ledger, ce.ledger_closed_at, ce.from_address, ce.routing_kind, ce.routing_value, d.created_at
        FROM deposits d JOIN chain_events ce ON ce.id = d.chain_event_id WHERE d.id = ${req.params.id} AND d.org_id = ${orgId}`;
      return row ?? reply.code(404).send({ error: 'not_found' });
    },
  );
  app.post<{ Params: Id; Body: { customer_id: string; reason: string } }>(
    '/v1/deposits/:id/attribute',
    {
      ...operator,
      schema: {
        tags: ['deposits'],
        params: S.idParams,
        body: {
          type: 'object',
          required: ['customer_id', 'reason'],
          additionalProperties: false,
          properties: { customer_id: S.uuid, reason: S.reason },
        },
      },
    },
    async (req) => {
      const a = auth(req);
      await attributeDeposit(sql, {
        orgId: a.orgId,
        depositId: req.params.id,
        customerId: req.body.customer_id,
        actor: a.actor,
        reason: req.body.reason,
      });
      return { status: 'attributed' };
    },
  );

  // Internal records
  app.post<{
    Body: {
      records: {
        external_id: string;
        customer_id?: string;
        token_contract: string;
        amount: string;
        tx_hash?: string;
      }[];
    };
  }>(
    '/v1/internal-records',
    {
      ...operator,
      schema: {
        tags: ['reconciliation'],
        body: {
          type: 'object',
          required: ['records'],
          additionalProperties: false,
          properties: {
            records: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['external_id', 'token_contract', 'amount'],
                additionalProperties: false,
                properties: {
                  external_id: { type: 'string', minLength: 1, maxLength: 200 },
                  customer_id: S.uuid,
                  token_contract: { type: 'string', pattern: '^C[A-Z2-7]{55}$' },
                  amount: S.amount,
                  tx_hash: S.txHash,
                },
              },
            },
          },
        },
      },
    },
    async (req) => {
      const a = auth(req);
      return recordInternalRecords(
        sql,
        a.orgId,
        a.actor,
        req.body.records.map((r) => ({
          externalId: r.external_id,
          customerId: r.customer_id ?? null,
          tokenContract: r.token_contract,
          amount: BigInt(r.amount),
          txHash: r.tx_hash ?? null,
        })),
      );
    },
  );

  // Reconciliation
  app.post(
    '/v1/reconciliation-runs',
    { ...operator, schema: { tags: ['reconciliation'] } },
    async (req, reply) => {
      const a = auth(req);
      return reply.code(201).send(await runReconciliation(sql, { orgId: a.orgId, actor: a.actor }));
    },
  );
  app.get<{ Querystring: Limit }>(
    '/v1/reconciliation-runs',
    { ...viewer, schema: { tags: ['reconciliation'], querystring: S.listQuery } },
    async (req) => {
      const { orgId } = auth(req);
      return {
        data: await sql`SELECT id, actor, summary, created_at FROM reconciliation_runs WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${req.query.limit}`,
      };
    },
  );
  app.get<{ Params: Id }>(
    '/v1/reconciliation-runs/:id',
    { ...viewer, schema: { tags: ['reconciliation'], params: S.idParams } },
    async (req, reply) => {
      const { orgId } = auth(req);
      const [run] =
        await sql`SELECT id, actor, summary, created_at FROM reconciliation_runs WHERE id = ${req.params.id} AND org_id = ${orgId}`;
      if (!run) return reply.code(404).send({ error: 'not_found' });
      const results = await sql`
      SELECT outcome, deposit_id, internal_record_id, detail FROM reconciliation_results
      WHERE run_id = ${req.params.id} AND org_id = ${orgId} ORDER BY id`;
      return { ...run, results };
    },
  );

  // Exception cases
  app.get<{ Querystring: Limit & { status?: string } }>(
    '/v1/cases',
    {
      ...viewer,
      schema: {
        tags: ['cases'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...S.listQuery.properties,
            status: { type: 'string', enum: ['open', 'investigating', 'resolved', 'dismissed'] },
          },
        },
      },
    },
    async (req) => {
      const { orgId } = auth(req);
      return {
        data: await sql`
          SELECT id, kind, status, subject_ref, detail, created_at, updated_at FROM exception_cases
          WHERE org_id = ${orgId} ${req.query.status ? sql`AND status = ${req.query.status}::case_status` : sql``}
          ORDER BY created_at DESC LIMIT ${req.query.limit}`,
      };
    },
  );
  app.get<{ Params: Id }>(
    '/v1/cases/:id',
    { ...viewer, schema: { tags: ['cases'], params: S.idParams } },
    async (req, reply) => {
      const { orgId } = auth(req);
      const [c] =
        await sql`SELECT id, kind, status, subject_ref, detail, created_at, updated_at FROM exception_cases WHERE id = ${req.params.id} AND org_id = ${orgId}`;
      if (!c) return reply.code(404).send({ error: 'not_found' });
      const events =
        await sql`SELECT actor, from_status, to_status, reason, at FROM case_events WHERE case_id = ${req.params.id} AND org_id = ${orgId} ORDER BY id`;
      return { ...c, events };
    },
  );
  app.post<{
    Params: Id;
    Body: { to: 'investigating' | 'resolved' | 'dismissed'; reason: string };
  }>(
    '/v1/cases/:id/transitions',
    {
      ...operator,
      schema: {
        tags: ['cases'],
        params: S.idParams,
        body: {
          type: 'object',
          required: ['to', 'reason'],
          additionalProperties: false,
          properties: {
            to: { type: 'string', enum: ['investigating', 'resolved', 'dismissed'] },
            reason: S.reason,
          },
        },
      },
    },
    async (req) => {
      const a = auth(req);
      await transitionCase(sql, {
        orgId: a.orgId,
        caseId: req.params.id,
        to: req.body.to,
        actor: a.actor,
        reason: req.body.reason,
      });
      return { status: req.body.to };
    },
  );

  // Ledger, audit, sync status
  app.get('/v1/ledger/balances', { ...viewer, schema: { tags: ['ledger'] } }, async (req) => {
    const { orgId } = auth(req);
    return {
      data: (await balances(sql, orgId)).map((b) => ({ ...b, amount: b.amount.toString() })),
    };
  });
  app.get<{ Querystring: Limit }>(
    '/v1/audit-log',
    { ...viewer, schema: { tags: ['audit'], querystring: S.listQuery } },
    async (req) => {
      const { orgId } = auth(req);
      return {
        data: await sql`SELECT id::text, actor, action, subject, before, after, at FROM audit_log WHERE org_id = ${orgId} ORDER BY id DESC LIMIT ${req.query.limit}`,
      };
    },
  );
  app.get('/v1/sync-status', { ...viewer, schema: { tags: ['meta'] } }, async () => ({
    data: await sql`SELECT network, source, last_ledger, status, status_detail, updated_at FROM ingestion_cursors ORDER BY network, source`,
  }));

  // Admin: API keys and webhook endpoints (secrets are returned once)
  app.post<{ Body: { name: string; role: 'admin' | 'operator' | 'viewer' } }>(
    '/v1/api-keys',
    {
      ...admin,
      schema: {
        tags: ['admin'],
        body: {
          type: 'object',
          required: ['name', 'role'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            role: { type: 'string', enum: ['admin', 'operator', 'viewer'] },
          },
        },
      },
    },
    async (req, reply) => {
      const a = auth(req);
      const k = generateApiKey();
      const row = one(
        await sql`
        INSERT INTO api_keys (org_id, name, prefix, secret_hash, role) VALUES (${a.orgId}, ${req.body.name}, ${k.prefix}, ${k.secretHash}, ${req.body.role})
        RETURNING id, name, role, created_at`,
      );
      await audit(sql, {
        orgId: a.orgId,
        actor: a.actor,
        action: 'api_key.create',
        subject: `api_key:${row.id}`,
        after: { name: req.body.name, role: req.body.role, prefix: k.prefix },
      });
      return reply.code(201).send({ ...row, key: k.key });
    },
  );
  app.get('/v1/webhook-endpoints', { ...admin, schema: { tags: ['admin'] } }, async (req) => {
    const { orgId } = auth(req);
    return {
      data: await sql`SELECT id, url, active, created_at FROM webhook_endpoints WHERE org_id = ${orgId} ORDER BY created_at`,
    };
  });
  app.post<{ Body: { url: string } }>(
    '/v1/webhook-endpoints',
    {
      ...admin,
      schema: {
        tags: ['admin'],
        body: {
          type: 'object',
          required: ['url'],
          additionalProperties: false,
          properties: { url: { type: 'string', maxLength: 2048 } },
        },
      },
    },
    async (req, reply) => {
      const a = auth(req);
      const url = await assertSafeWebhookUrl(req.body.url, cfg.urlPolicy);
      const secret = generateWebhookSecret();
      const row = one(
        await sql`
        INSERT INTO webhook_endpoints (org_id, url, secret_ciphertext) VALUES (${a.orgId}, ${url.toString()}, ${encryptSecret(secret, cfg.webhookEncryptionKey)})
        RETURNING id, url, active, created_at`,
      );
      await audit(sql, {
        orgId: a.orgId,
        actor: a.actor,
        action: 'webhook_endpoint.create',
        subject: `webhook_endpoint:${row.id}`,
        after: { url: url.toString() },
      });
      return reply.code(201).send({ ...row, secret });
    },
  );
}
