# Welyvra Platform — instructions for Claude

Public monorepo for Welyvra: a reconciliation layer for payments on Stellar (ingest → attribute → double-entry ledger → reconcile → exceptions → API/webhooks → dashboard). The founder writes in Spanish: reply to them in Spanish; code, comments, docs, issues and PRs in English.

## Status

MVP implemented on testnet (issues #2–#11). Do not scaffold empty packages; new packages come with an issue.

## Stack (ADR-0001)

pnpm workspaces · TypeScript (strict) · Node 24 LTS · Fastify · PostgreSQL 16 · Drizzle ORM (SQL migrations) · Next.js + Tailwind (dashboard) · Vitest · Playwright · `@stellar/stellar-sdk` ≥ 17.3.0 (W address support).
Layout: `packages/core` (pure domain: amounts, events, reconciliation, case state machine), `packages/stellar` (RPC client, event decoding), `packages/db` (SQL migrations, Drizzle schema), `packages/ingestion` (worker), `packages/reconciliation` (ledger, cases, runs, webhook outbox), `apps/api` (Fastify, layered: `middleware/` → `routes/` → `repositories/`), `apps/webapp` (web frontend, Next.js), `apps/contracts` (Soroban contracts in Rust, ADR-0005). Demo: `scripts/demo`. Full map: docs/architecture/project-structure.md. Rules for any AI agent: AGENTS.md.

## Commands

- Before saying a task is done: `make check` (same checks as CI; `E2E=1` adds browser tests).
- `pnpm install` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm demo` · `pnpm e2e`
- Database tests need `DATABASE_URL` (start `infra/docker/compose.yml`); they fail rather than skip without it.
- After changing API routes: `pnpm --filter @welyvra/api openapi` (a test checks the committed spec).

## Architecture

- Overview: @docs/architecture/overview.md
- Project structure (where code goes): docs/architecture/project-structure.md
- Environment variables: docs/deployment/environment-variables.md
- Stellar integration (memo / M / W addresses, events, retention): docs/architecture/stellar-integration.md
- Data model and invariants: docs/architecture/data-model.md
- Threat model: docs/architecture/threat-model.md
- ADRs: docs/adr/

## Non-negotiable rules for financial code

Detailed in `.claude/rules/financial-correctness.md`. In short: integer amounts only, idempotency enforced by DB unique constraints, every financial write in one DB transaction, append-only ledger and audit log, tenant scoping on every query, no secrets in code or logs, testnet and fake data only.

## Workflow

1. Work only on an issue with acceptance criteria. Branch `feat/<issue>-slug`.
2. Tests first for invariants (duplicates, out-of-order, crash mid-batch, concurrency).
3. Open a PR with the template; `Closes #n`. Never push to `main`, never merge yourself.
4. Run `/security-check` for changes touching money, auth, ingestion, webhooks, CI or dependencies.
5. Do not claim a capability in docs until a test proves it.

Skills: `/implement-issue`, `/review-pr`, `/security-check`, `/release-check`.
