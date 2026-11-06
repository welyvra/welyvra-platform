---
paths:
  - 'apps/api/**'
  - 'packages/core/**'
  - 'packages/db/**'
  - 'packages/stellar/**'
---

# Financial correctness rules

- Amounts: integer minor units only (`bigint` in TS, `NUMERIC(39,0)` in SQL). Never `number` or float for money.
- Idempotency: every externally sourced write has a natural unique key enforced by a DB constraint (`(network, event_id)`, `(org_id, external_id)`).
- Transactions: a batch's events, deposits, postings, outbox rows and cursor commit together or not at all.
- Ledger and audit log are append-only. Corrections are new entries with a reason.
- Every query is scoped by `org_id`.
- Order by ledger sequence and event ID, never by timestamps.
- Unknown or malformed input is recorded and surfaced as an exception, never silently dropped.
- Logs never contain secrets, API keys or full webhook secrets.
