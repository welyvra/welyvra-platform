import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from 'postgres';
import { findActiveApiKey } from '../repositories/apiKeys.js';
import { parseApiKey, safeEqual, sha256Hex } from '../utils/security.js';

export type Role = 'viewer' | 'operator' | 'admin';
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

export interface AuthContext {
  orgId: string;
  role: Role;
  keyId: string;
  /** Recorded as the actor in audit logs. Never contains the secret. */
  actor: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function authenticate(sql: Sql) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const parsed = header.startsWith('Bearer ') ? parseApiKey(header.slice(7).trim()) : null;
    if (!parsed)
      return reply
        .code(401)
        .send({ error: 'unauthorized', message: 'missing or malformed API key' });
    const key = await findActiveApiKey(sql, parsed.prefix);
    // Compare even when the key is unknown, so timing does not reveal valid prefixes.
    const ok = safeEqual(sha256Hex(parsed.secret), key?.secret_hash ?? '0'.repeat(64));
    if (!key || !ok)
      return reply.code(401).send({ error: 'unauthorized', message: 'invalid API key' });
    req.auth = {
      orgId: key.org_id,
      role: key.role,
      keyId: key.id,
      actor: `api_key:${parsed.prefix}`,
    };
  };
}

export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth || RANK[req.auth.role] < RANK[min]) {
      return reply.code(403).send({ error: 'forbidden', message: `requires role ${min}` });
    }
  };
}

/** Narrow `req.auth` after the auth hook ran. */
export function auth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new Error('invariant: route reached without authentication');
  return req.auth;
}

/** Route options that enforce a minimum role, e.g. `app.get(path, { ...guard.operator }, handler)`. */
export const guard = {
  viewer: { preHandler: requireRole('viewer') },
  operator: { preHandler: requireRole('operator') },
  admin: { preHandler: requireRole('admin') },
} as const;
