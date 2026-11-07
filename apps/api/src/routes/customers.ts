import { audit } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import { insertCustomer, insertRoutingKey, listCustomers } from '../repositories/customers.js';
import { type RoutingKeyInput, normalizeRoutingKey } from '../utils/routingKey.js';

export function registerCustomerRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.get<{ Querystring: S.Limit }>(
    '/v1/customers',
    { ...guard.viewer, schema: { tags: ['customers'], querystring: S.listQuery } },
    async (req) => ({ data: await listCustomers(sql, auth(req).orgId, req.query.limit) }),
  );

  app.post<{ Body: { external_ref: string; name?: string } }>(
    '/v1/customers',
    {
      ...guard.operator,
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
      const row = await insertCustomer(sql, a.orgId, req.body);
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

  app.post<{ Params: S.Id; Body: RoutingKeyInput & { receiving_account_id: string } }>(
    '/v1/customers/:id/routing-keys',
    {
      ...guard.operator,
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
      const key = normalizeRoutingKey(req.body);
      const row = await insertRoutingKey(sql, a.orgId, {
        customerId: req.params.id,
        receivingAccountId: req.body.receiving_account_id,
        ...key,
      });
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
}
