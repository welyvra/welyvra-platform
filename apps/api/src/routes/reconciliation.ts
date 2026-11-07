import { recordInternalRecords, runReconciliation } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import {
  findReconciliationRun,
  listReconciliationRuns,
} from '../repositories/reconciliationRuns.js';

interface InternalRecordBody {
  external_id: string;
  customer_id?: string;
  token_contract: string;
  amount: string;
  tx_hash?: string;
}

export function registerReconciliationRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.post<{ Body: { records: InternalRecordBody[] } }>(
    '/v1/internal-records',
    {
      ...guard.operator,
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

  app.post(
    '/v1/reconciliation-runs',
    { ...guard.operator, schema: { tags: ['reconciliation'] } },
    async (req, reply) => {
      const a = auth(req);
      return reply.code(201).send(await runReconciliation(sql, { orgId: a.orgId, actor: a.actor }));
    },
  );

  app.get<{ Querystring: S.Limit }>(
    '/v1/reconciliation-runs',
    { ...guard.viewer, schema: { tags: ['reconciliation'], querystring: S.listQuery } },
    async (req) => ({
      data: await listReconciliationRuns(sql, auth(req).orgId, req.query.limit),
    }),
  );

  app.get<{ Params: S.Id }>(
    '/v1/reconciliation-runs/:id',
    { ...guard.viewer, schema: { tags: ['reconciliation'], params: S.idParams } },
    async (req, reply) =>
      (await findReconciliationRun(sql, auth(req).orgId, req.params.id)) ??
      reply.code(404).send({ error: 'not_found' }),
  );
}
