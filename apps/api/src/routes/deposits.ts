import { attributeDeposit } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import { findDeposit, listDeposits } from '../repositories/deposits.js';

export function registerDepositRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.get<{ Querystring: S.Limit & { status?: string; customer_id?: string } }>(
    '/v1/deposits',
    {
      ...guard.viewer,
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
      const { status, customer_id, limit } = req.query;
      return {
        data: await listDeposits(sql, auth(req).orgId, { status, customerId: customer_id, limit }),
      };
    },
  );

  app.get<{ Params: S.Id }>(
    '/v1/deposits/:id',
    { ...guard.viewer, schema: { tags: ['deposits'], params: S.idParams } },
    async (req, reply) =>
      (await findDeposit(sql, auth(req).orgId, req.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );

  app.post<{ Params: S.Id; Body: { customer_id: string; reason: string } }>(
    '/v1/deposits/:id/attribute',
    {
      ...guard.operator,
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
}
