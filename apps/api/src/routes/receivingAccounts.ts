import { audit } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import {
  insertReceivingAccount,
  listReceivingAccounts,
} from '../repositories/receivingAccounts.js';

export function registerReceivingAccountRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.get(
    '/v1/receiving-accounts',
    { ...guard.viewer, schema: { tags: ['accounts'] } },
    async (req) => ({ data: await listReceivingAccounts(sql, auth(req).orgId) }),
  );

  app.post<{ Body: { network: 'testnet' | 'mainnet'; address: string; label?: string } }>(
    '/v1/receiving-accounts',
    {
      ...guard.admin,
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
      const row = await insertReceivingAccount(sql, a.orgId, req.body);
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
}
