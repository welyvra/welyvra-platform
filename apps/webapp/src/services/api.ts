import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export type * from '@/types/api';

export const API_KEY_COOKIE = 'welyvra_api_key';
const API_URL = process.env.WELYVRA_API_URL ?? 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server-only API client. The API key lives in an httpOnly cookie and never reaches the browser. */
export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const key = (await cookies()).get(API_KEY_COOKIE)?.value;
  if (!key) redirect('/login');
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login?expired=1');
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new ApiError(
      res.status,
      body.error ?? 'error',
      body.message ?? `API error ${res.status}`,
    );
  return body as T;
}
