# Testing

Run everything CI runs with `make check` (add `E2E=1` for browser tests). Database tests need PostgreSQL from `infra/docker/compose.yml` and fail, never skip, without it.

| Kind            | Where                                        | What it protects                                                                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unit            | `packages/*/src/*.test.ts`                   | Pure rules: amounts, event decoding, matching, case transitions                      |
| Database        | `packages/db`, `ingestion`, `reconciliation` | Invariants enforced by PostgreSQL: duplicates, crash mid-batch, concurrency, replays |
| API integration | `apps/api/src/__tests__/`                    | Auth, roles, tenant isolation, validation, webhooks, SSRF, OpenAPI spec is current   |
| Fixtures        | `tests/fixtures/stellar/`                    | Real Protocol 30 testnet events (memo, `M`, `W` addresses), recorded once            |
| End-to-end      | `tests/e2e/`                                 | Dashboard flows in a real browser (Playwright) against the demo data                 |
| Demo            | `scripts/demo/`                              | Full pipeline on recorded events with money invariant checks                         |

## Conventions

- Unit tests sit next to the file they test (`amount.ts` / `amount.test.ts`). API tests exercise several layers at once, so they live in `apps/api/src/__tests__/`.
- Each database test creates its own throwaway database (`createTestDatabase()` from `@welyvra/db/testing`).
- A test must fail when the invariant it protects is broken. Prefer adversarial cases: the same event twice, out of order, a crash between steps, another tenant's IDs.
- Never use real customer data or mainnet keys in tests.
