import { transitionCase } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import { findCase, listCases } from '../repositories/cases.js';

export function registerCaseRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.get<{ Querystring: S.Limit & { status?: string } }>(
    '/v1/cases',
    {
      ...guard.viewer,
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
    async (req) => ({ data: await listCases(sql, auth(req).orgId, req.query) }),
  );

  app.get<{ Params: S.Id }>(
    '/v1/cases/:id',
    { ...guard.viewer, schema: { tags: ['cases'], params: S.idParams } },
    async (req, reply) =>
      (await findCase(sql, auth(req).orgId, req.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );

  app.post<{
    Params: S.Id;
    Body: { to: 'investigating' | 'resolved' | 'dismissed'; reason: string };
  }>(
    '/v1/cases/:id/transitions',
    {
      ...guard.operator,
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
}
