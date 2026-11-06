# Welyvra API (v1, pre-alpha, testnet only)

The full specification is [openapi.json](openapi.json), generated from the route schemas (`pnpm --filter @welyvra/api openapi`). A test fails if it is out of date.

## Authentication

`Authorization: Bearer wlv_<prefix>_<secret>`. Keys are created by an admin (`POST /v1/api-keys`) or bootstrapped with `welyvra-admin create-org "<name>"`. The full key is shown once; only a SHA-256 hash of the secret is stored.

| Role     | Can                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------- |
| viewer   | read everything in its organization                                                             |
| operator | + customers, routing keys, internal records, attribution, reconciliation runs, case transitions |
| admin    | + receiving accounts, API keys, webhook endpoints                                               |

Every request is scoped to the key's organization. Another organization's IDs return `404`.

## Conventions

- Amounts are **strings** of integer minor units (`"10000001"` = 1.0000001 XLM). JSON numbers are rejected.
- Errors: `{ "error": "<code>", "message": "..." }` with 400, 401, 403, 404, 409 or 429.
- Rate limit: 300 requests per minute per API key (configurable).

## Webhooks

Events: `deposit.created`, `case.opened`, `case.updated`, `reconciliation.completed`. Delivery is at least once; use the `Welyvra-Delivery` header (or the body `id`) to deduplicate.

Each request carries `Welyvra-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Verify it and reject timestamps older than 5 minutes:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(
  secret: string,
  header: string,
  rawBody: string,
  now = Date.now() / 1000,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isSafeInteger(t) || Math.abs(now - t) > 300 || !/^[0-9a-f]{64}$/.test(parts.v1 ?? ''))
    return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}
```

Webhook URLs must be `https` and must not resolve to private, loopback, link-local or reserved addresses (checked at registration and before every delivery). Failed deliveries are retried with exponential backoff (30 s up to 1 h) and marked `failed` after 10 attempts.
