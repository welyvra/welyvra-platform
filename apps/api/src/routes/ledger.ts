import { balances } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import * as S from '../dto/common.js';
import { auth, guard } from '../middleware/auth.js';
import { listAuditLog, listSyncStatus } from '../repositories/auditLog.js';

/** Read-only views: ledger balances, audit log and ingestion sync status. */
export function registerLedgerRoutes(app: FastifyInstance, { sql }: AppConfig): void {
  app.get(
    '/v1/ledger/balances',
    { ...guard.viewer, schema: { tags: ['ledger'] } },
    async (req) => ({
      data: (await balances(sql, auth(req).orgId)).map((b) => ({
        ...b,
        amount: b.amount.toString(),
      })),
    }),
  );

  app.get<{ Querystring: S.Limit }>(
    '/v1/audit-log',
    { ...guard.viewer, schema: { tags: ['audit'], querystring: S.listQuery } },
    async (req) => ({ data: await listAuditLog(sql, auth(req).orgId, req.query.limit) }),
  );

  app.get('/v1/sync-status', { ...guard.viewer, schema: { tags: ['meta'] } }, async () => ({
    data: await listSyncStatus(sql),
  }));
}
