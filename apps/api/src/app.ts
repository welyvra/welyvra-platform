import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { InvalidTransitionError } from '@welyvra/core';
import { ConflictError, NotFoundError } from '@welyvra/reconciliation';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { authenticate } from './auth.js';
import { registerRoutes } from './routes.js';
import { UnsafeUrlError, type UrlPolicy } from './webhooks/ssrf.js';

export interface AppConfig {
  sql: Sql;
  /** 32-byte hex key to encrypt webhook secrets at rest. */
  webhookEncryptionKey: string;
  urlPolicy?: UrlPolicy;
  rateLimitPerMinute?: number;
  logger?: boolean;
}

export async function buildApp(cfg: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.logger ? { redact: ['req.headers.authorization'] } : false,
    bodyLimit: 1_048_576,
  });

  // Bodies are validated strictly: no type coercion, so an amount sent as a JSON number is
  // rejected instead of silently becoming a string. Querystrings and params need coercion.
  const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
  const strict = addFormats(
    new Ajv({ coerceTypes: false, useDefaults: true, removeAdditional: false, strict: false }),
  );
  const coercing = addFormats(
    new Ajv({ coerceTypes: 'array', useDefaults: true, removeAdditional: false, strict: false }),
  );
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? strict : coercing).compile(schema),
  );

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Welyvra API',
        version: '0.1.0',
        description:
          'Reconciliation layer for payments on Stellar. Amounts are strings of integer minor units. Testnet only (pre-alpha).',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'http', scheme: 'bearer', description: 'wlv_<prefix>_<secret>' },
        },
      },
      security: [{ apiKey: [] }],
    },
  });

  await app.register(rateLimit, {
    max: cfg.rateLimitPerMinute ?? 300,
    timeWindow: '1 minute',
    // Per API key prefix when present (never the secret), otherwise per IP.
    keyGenerator: (req) =>
      /^Bearer wlv_([a-z0-9]{12})_/.exec(req.headers.authorization ?? '')?.[1] ?? req.ip,
  });

  app.setErrorHandler(
    (err: Error & { statusCode?: number; validation?: unknown; code?: string }, req, reply) => {
      if (err.validation)
        return reply.code(400).send({ error: 'invalid_request', message: err.message });
      if (err instanceof NotFoundError)
        return reply.code(404).send({ error: 'not_found', message: err.message });
      if (err instanceof ConflictError || err instanceof InvalidTransitionError) {
        return reply.code(409).send({ error: 'conflict', message: err.message });
      }
      if (err instanceof UnsafeUrlError)
        return reply.code(400).send({ error: 'unsafe_url', message: err.message });
      // Domain parsers (amounts, routing ids) throw RangeError for out-of-range input.
      if (err instanceof RangeError)
        return reply.code(400).send({ error: 'invalid_request', message: err.message });
      // PostgreSQL: unique -> 409; foreign key (e.g. another tenant's id) -> 404; check -> 400.
      if (err.code === '23505')
        return reply.code(409).send({ error: 'conflict', message: 'already exists' });
      if (err.code === '23503')
        return reply
          .code(404)
          .send({ error: 'not_found', message: 'referenced resource not found' });
      if (err.code === '23514' || err.code === '22P02')
        return reply.code(400).send({ error: 'invalid_request', message: 'value rejected' });
      if (err.statusCode && err.statusCode < 500)
        return reply.code(err.statusCode).send({ error: 'request_error', message: err.message });
      req.log.error({ err }, 'unhandled error');
      return reply.code(500).send({ error: 'internal_error' });
    },
  );

  app.get(
    '/v1/health',
    { schema: { security: [], tags: ['meta'] }, config: { rateLimit: false } },
    async () => ({ status: 'ok' }),
  );

  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate(cfg.sql));
    registerRoutes(secured, cfg);
  });

  return app;
}
