import { audit } from '@welyvra/reconciliation';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../app.js';
import { type Role, auth, guard } from '../middleware/auth.js';
import { insertApiKey } from '../repositories/apiKeys.js';
import { insertWebhookEndpoint, listWebhookEndpoints } from '../repositories/webhookEndpoints.js';
import { assertSafeWebhookUrl } from '../services/webhooks/ssrf.js';
import { encryptSecret, generateApiKey, generateWebhookSecret } from '../utils/security.js';

/** Admin-only: API keys and webhook endpoints. Secrets are returned once and never stored in clear. */
export function registerAdminRoutes(app: FastifyInstance, cfg: AppConfig): void {
  const { sql } = cfg;

  app.post<{ Body: { name: string; role: Role } }>(
    '/v1/api-keys',
    {
      ...guard.admin,
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
      const row = await insertApiKey(sql, a.orgId, {
        name: req.body.name,
        role: req.body.role,
        prefix: k.prefix,
        secretHash: k.secretHash,
      });
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

  app.get(
    '/v1/webhook-endpoints',
    { ...guard.admin, schema: { tags: ['admin'] } },
    async (req) => ({
      data: await listWebhookEndpoints(sql, auth(req).orgId),
    }),
  );

  app.post<{ Body: { url: string } }>(
    '/v1/webhook-endpoints',
    {
      ...guard.admin,
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
      const row = await insertWebhookEndpoint(sql, a.orgId, {
        url: url.toString(),
        secretCiphertext: encryptSecret(secret, cfg.webhookEncryptionKey),
      });
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
