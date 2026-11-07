import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import { registerAdminRoutes } from './admin.js';
import { registerCaseRoutes } from './cases.js';
import { registerCustomerRoutes } from './customers.js';
import { registerDepositRoutes } from './deposits.js';
import { registerLedgerRoutes } from './ledger.js';
import { registerReceivingAccountRoutes } from './receivingAccounts.js';
import { registerReconciliationRoutes } from './reconciliation.js';

/** All authenticated `/v1` routes. Registration order is the order in the OpenAPI document. */
export function registerRoutes(app: FastifyInstance, cfg: AppConfig): void {
  registerReceivingAccountRoutes(app, cfg);
  registerCustomerRoutes(app, cfg);
  registerDepositRoutes(app, cfg);
  registerReconciliationRoutes(app, cfg);
  registerCaseRoutes(app, cfg);
  registerLedgerRoutes(app, cfg);
  registerAdminRoutes(app, cfg);
}
