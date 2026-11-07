# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini and others) working on Welyvra. If you are a person, this is also the shortest path to a pull request that gets merged.

## The one rule

Run `make check` from the repository root before every commit you push. Fix everything it reports and run it again until the last line says `All checks passed.` It runs the same checks as CI: lint, typecheck, unit and database tests, build. `E2E=1 make check` adds the demo and the Playwright tests.

- Start the database first: `docker compose -f infra/docker/compose.yml up -d`. Database tests fail (never skip) without it.
- `make fix` applies formatting and autofixable lint rules.
- After changing API routes, regenerate the spec: `pnpm --filter @welyvra/api build && pnpm --filter @welyvra/api openapi`. A test fails if it is stale.

Do not report a task as done, and do not open a pull request, while `make check` fails.

## Where code goes

| You are changing                       | Put it in                                         |
| -------------------------------------- | ------------------------------------------------- |
| A financial rule (amounts, matching)   | `packages/core` (pure functions, no I/O)          |
| Decoding Stellar events or RPC calls   | `packages/stellar`                                |
| A table, column or constraint          | new SQL migration in `packages/db/src/migrations` |
| Ledger postings, cases, outbox         | `packages/reconciliation`                         |
| An HTTP endpoint                       | `apps/api/src/routes/<domain>.ts`                 |
| A SQL query used by an endpoint        | `apps/api/src/repositories/<domain>.ts`           |
| Auth, validation, error mapping        | `apps/api/src/middleware/`                        |
| A frontend page / component / API call | `apps/webapp/src/app`, `components`, `services`   |

| A smart contract | `apps/contracts/contracts/<name>` (Rust, Soroban) |

Full map: [docs/architecture/project-structure.md](docs/architecture/project-structure.md).

## Read your own diff before you push

Run `git diff main...HEAD --stat`, then read the full diff. Delete anything the issue does not need: generated output (`dist/`, `.next/`, `test-results/`, coverage), scratch notes, commented-out code, placeholder stubs, lockfiles from other package managers (this repo uses pnpm).

## Non-negotiables

- Money is integer minor units (`bigint`, `NUMERIC(39,0)`), never `number` or float.
- Every query is scoped by `org_id`. Every financial write is one database transaction.
- Ledger and audit log are append-only.
- No secrets, API keys or real customer data in code, tests, logs or fixtures. Testnet only.
- Do not claim a capability in docs until a test proves it.

Details: [.claude/rules/financial-correctness.md](.claude/rules/financial-correctness.md) and [docs/architecture/threat-model.md](docs/architecture/threat-model.md).

## Scope and commits

- One issue per pull request. `Closes #<issue>` in the description.
- Conventional Commits: `<type>(<scope>): <summary>`, e.g. `fix(api): reject negative limits`.
- AI-assisted commits carry a `Co-Authored-By` trailer. A human reviews every change before merge.
- Never push to `main`; never merge your own pull request.
