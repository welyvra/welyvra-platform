import { InvalidTransitionError } from '@welyvra/core';
import { ConflictError, NotFoundError } from '@welyvra/reconciliation';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { UnsafeUrlError } from '../services/webhooks/ssrf.js';

type AppError = FastifyError & { code?: string };

/**
 * Maps every error to a stable `{ error, message }` body. Unknown errors become a generic 500:
 * internal details (SQL, stack traces) are logged, never returned to the client.
 */
export function errorHandler(err: AppError, req: FastifyRequest, reply: FastifyReply) {
  const send = (status: number, error: string, message?: string) =>
    reply.code(status).send(message === undefined ? { error } : { error, message });

  if (err.validation) return send(400, 'invalid_request', err.message);
  if (err instanceof NotFoundError) return send(404, 'not_found', err.message);
  if (err instanceof ConflictError || err instanceof InvalidTransitionError)
    return send(409, 'conflict', err.message);
  if (err instanceof UnsafeUrlError) return send(400, 'unsafe_url', err.message);
  // Domain parsers (amounts, routing ids) throw RangeError for out-of-range input.
  if (err instanceof RangeError) return send(400, 'invalid_request', err.message);
  // PostgreSQL: unique -> 409; foreign key (e.g. another tenant's id) -> 404; check -> 400.
  if (err.code === '23505') return send(409, 'conflict', 'already exists');
  if (err.code === '23503') return send(404, 'not_found', 'referenced resource not found');
  if (err.code === '23514' || err.code === '22P02')
    return send(400, 'invalid_request', 'value rejected');
  if (err.statusCode && err.statusCode < 500)
    return send(err.statusCode, 'request_error', err.message);
  req.log.error({ err }, 'unhandled error');
  return send(500, 'internal_error');
}
