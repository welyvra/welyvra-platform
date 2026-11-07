# Project structure

A pnpm monorepo. `packages/` hold the domain and infrastructure libraries; `apps/` are the things you run. Dependencies only point downwards in this list.

```
welyvra-platform/
├── packages/
│   ├── core/              Pure domain: amounts, events, matching, case state machine. No I/O.
│   ├── stellar/           Stellar RPC client and event decoding (G, M, C, W addresses)
│   ├── db/                SQL migrations, schema, connection, test database helper
│   ├── reconciliation/    Ledger postings, attribution, reconciliation runs, cases, webhook outbox
│   └── ingestion/         Transactional ingestion worker with a persisted cursor
├── apps/
│   ├── api/               REST API (Fastify) + background workers
│   ├── webapp/            Web frontend: operations UI for finance and support (Next.js)
│   └── contracts/         Soroban smart contracts (Rust): receiver vault, reconciliation seal
├── tests/
│   ├── e2e/               Playwright browser tests
│   └── fixtures/stellar/  Recorded Protocol 30 testnet events
├── scripts/
│   ├── check.sh           Same checks as CI (run with `make check`)
│   ├── demo/              Reproducible end-to-end demo
│   └── research/          One-off scripts used to verify Protocol 30 on testnet
├── infra/docker/          Local PostgreSQL
├── docs/                  Documentation (index: docs/README.md)
├── .github/               CI workflow, PR and issue templates, Dependabot
├── .claude/               Agents, skills and rules for Claude Code
├── AGENTS.md              Rules for any AI coding agent
└── CLAUDE.md              Claude Code entry point
```

## API (`apps/api/src`)

Layered: each layer only calls the one below it.

```
request ─▶ middleware ─▶ routes ─▶ repositories / @welyvra/reconciliation ─▶ PostgreSQL
           (auth, roles,   (HTTP shape,  (SQL, always scoped
            validation,     JSON schema)  by org_id)
            errors)
```

| Folder          | Responsibility                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `app.ts`        | Builds the Fastify app: plugins, middleware, routes. No `listen`, so tests can inject requests.            |
| `server.ts`     | Process entry point: config, migrations, HTTP server, workers, graceful shutdown                           |
| `config/`       | Environment variables (`env.ts`) and OpenAPI metadata                                                      |
| `middleware/`   | API key authentication and role guards, request validation, error mapping                                  |
| `routes/`       | One file per domain: receiving accounts, customers, deposits, reconciliation, cases, ledger, admin, health |
| `dto/`          | Shared JSON schemas and request types                                                                      |
| `repositories/` | SQL queries, one file per table group. Every query takes `orgId`.                                          |
| `services/`     | Logic beyond one query: webhook dispatcher, SSRF guard, OpenAPI generation                                 |
| `workers/`      | Long-running loops started by `server.ts`: ingestion and webhook delivery                                  |
| `utils/`        | Small pure helpers: API key and secret cryptography, routing key validation                                |
| `cli/`          | Command-line tools: `welyvra-admin create-org`, OpenAPI export                                             |
| `__tests__/`    | API integration tests                                                                                      |

Write operations that move money or change cases (attribution, reconciliation, case transitions) live in `packages/reconciliation`, not in `repositories/`, so they run in one transaction with their ledger entries, audit log and webhook outbox rows.

## Web frontend (`apps/webapp/src`)

| Folder        | Responsibility                                                       |
| ------------- | -------------------------------------------------------------------- |
| `app/`        | Pages (Next.js App Router) and server actions                        |
| `components/` | Shared components; `components/ui/` holds the base design components |
| `services/`   | Server-only API client. The API key stays in an `httpOnly` cookie.   |
| `types/`      | Response shapes of the API                                           |
| `lib/`        | Small pure helpers: formatting, class names                          |
| `proxy.ts`    | Redirects to `/login` when there is no session                       |
