# ADR-0001: Technology stack

- Status: Accepted · Date: 2026-11-05

## Context

Solo founder; financial correctness first; the official Stellar JS SDK is the best-maintained client for W addresses (v17.3.0).

## Options considered

| Area        | Chosen                   | Alternative   | Why                                                                                      |
| ----------- | ------------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| Language    | TypeScript (strict)      | Rust, Go      | Same language for API, dashboard and SDK; official JS SDK supports P30                   |
| API         | Fastify                  | NestJS        | Less ceremony, JSON-Schema validation that feeds OpenAPI directly                        |
| Database    | PostgreSQL 16            | —             | Transactions, unique and deferred constraints, `NUMERIC(39,0)`                           |
| Data access | Drizzle (SQL migrations) | Prisma        | Schema close to SQL; constraints, triggers and raw SQL are first-class; no engine binary |
| Dashboard   | Next.js + Tailwind       | Vite SPA      | Common, accessible component ecosystem                                                   |
| Tests       | Vitest, Playwright       | Jest          | Fast, ESM-native                                                                         |
| Monorepo    | pnpm workspaces          | Turborepo, Nx | Enough for 5 packages; add a task runner only if builds get slow                         |
| Runtime     | Node 24 LTS              | Bun           | LTS stability for financial code                                                         |

## Consequences

One language and one database. Revisit Rust only if contracts or high-throughput decoding become necessary.
