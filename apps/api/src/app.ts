import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { openApiOptions } from './config/openapi.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { registerValidation } from './middleware/validation.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerRoutes } from './routes/index.js';
import type { UrlPolicy } from './services/webhooks/ssrf.js';

export interface AppConfig {
  sql: Sql;
  /** 32-byte hex key to encrypt webhook secrets at rest. */
  webhookEncryptionKey: string;
  urlPolicy?: UrlPolicy;
  rateLimitPerMinute?: number;
  logger?: boolean;
}

/**
 * Builds the HTTP application. Request flow:
 * rate limit -> authentication (API key) -> role guard -> schema validation -> route -> repository.
 */
export async function buildApp(cfg: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.logger ? { redact: ['req.headers.authorization'] } : false,
    bodyLimit: 1_048_576,
  });

  registerValidation(app);
  await app.register(swagger, openApiOptions);
  await app.register(rateLimit, {
    max: cfg.rateLimitPerMinute ?? 300,
    timeWindow: '1 minute',
    // Per API key prefix when present (never the secret), otherwise per IP.
    keyGenerator: (req) =>
      /^Bearer wlv_([a-z0-9]{12})_/.exec(req.headers.authorization ?? '')?.[1] ?? req.ip,
  });
  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app);
  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate(cfg.sql));
    registerRoutes(secured, cfg);
  });

  return app;
}
