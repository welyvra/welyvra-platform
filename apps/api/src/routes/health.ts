import type { FastifyInstance } from 'fastify';

/** Public liveness probe: no authentication, no rate limit, no database access. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get(
    '/v1/health',
    { schema: { security: [], tags: ['meta'] }, config: { rateLimit: false } },
    async () => ({ status: 'ok' }),
  );
}
