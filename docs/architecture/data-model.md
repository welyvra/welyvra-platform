# Data model and invariants

Status: proposed. Final schema lands with its issue; invariants here are requirements.

## Tables (PostgreSQL)

| Table                                            | Key columns                                                                                              | Constraints                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `organizations`                                  | id                                                                                                       | —                                                                             |
| `receiving_accounts`                             | id, org_id, network, base_address                                                                        | unique (network, base_address)                                                |
| `customers`                                      | id, org_id, external_ref                                                                                 | unique (org_id, external_ref)                                                 |
| `routing_keys`                                   | id, receiving_account_id, kind (`id` = memo ID or M/W muxed ID, `text`, `hash`), value, customer_id      | unique (receiving_account_id, kind, value)                                    |
| `chain_events`                                   | id, network, event_id, ledger, tx_hash, contract_id, type, from, to_base, to_muxed_id, memo, amount, raw | **unique (network, event_id)**                                                |
| `deposits`                                       | id, org_id, chain_event_id, receiving_account_id, customer_id NULL, asset, amount, status                | **unique (chain_event_id, receiving_account_id)**                             |
| `journal_entries`                                | id, org_id, kind, source_ref, created_at                                                                 | unique (org_id, kind, source_ref)                                             |
| `postings`                                       | entry_id, account, asset, amount (signed)                                                                | sum(amount) per (entry_id, asset) = 0, checked by deferred constraint trigger |
| `internal_records`                               | id, org_id, external_id, customer_id, asset, amount, tx_hash NULL                                        | unique (org_id, external_id)                                                  |
| `reconciliation_runs` / `reconciliation_results` | run_id, deposit_id NULL, internal_record_id NULL, outcome                                                | deterministic per input snapshot                                              |
| `exception_cases` / `case_events`                | id, org_id, kind, status, subject_ref                                                                    | unique open case per (org_id, kind, subject_ref)                              |
| `ingestion_cursors`                              | network, source, last_ledger, last_cursor                                                                | one row per source; updated in the same tx as the batch                       |
| `webhook_outbox`                                 | id, org_id, event_type, payload, status, attempts                                                        | id is the idempotency key sent to the receiver                                |
| `audit_log`                                      | id, org_id, actor, action, before, after, at                                                             | append-only (no UPDATE/DELETE grants)                                         |
| `api_keys`                                       | id, org_id, hash, role                                                                                   | only the hash is stored                                                       |

## Money

- Amounts are integers in the asset's smallest unit (i128 on Soroban) stored as `NUMERIC(39,0)` and handled as `bigint` in TypeScript. No floats anywhere.
- Asset is part of every amount; postings are balanced per asset.

## Invariants (each has a test)

1. Processing the same event any number of times produces exactly one deposit and one journal entry.
2. A crash between any two statements of a batch leaves no partial state (single transaction: events + deposits + postings + outbox + cursor).
3. Every journal entry is balanced per asset.
4. Ledger and audit rows are never updated or deleted; corrections are new entries.
5. Every query is scoped by `org_id`; a cross-tenant read test exists for every endpoint.
6. Re-running reconciliation on the same inputs yields identical results and opens no duplicate cases.
7. Out-of-order arrival of events does not change final balances.

## Implementation (issue #5)

- SQL migrations in `packages/db/src/migrations/` are the source of truth; `packages/db/src/schema.ts` mirrors them for typed queries.
- Append-only: `chain_events`, `chain_event_rejections`, `journal_entries`, `postings`, `audit_log` reject `UPDATE`/`DELETE` (and `TRUNCATE` for the ledger) through triggers, for every role.
- Balance: two deferred constraint triggers check every entry at commit (≥ 2 postings, sum per asset = 0), including postings added later to an old entry.
- Tenancy: composite foreign keys `(id, org_id)` make cross-organization references impossible at the database level.
- Local database: `docker compose -f infra/docker/compose.yml up -d`, then `DATABASE_URL` from `.env.example`. Database tests fail loudly without it.

## Ledger, reconciliation and cases (issue #8)

- Every deposit gets a `deposit` journal entry in the ingestion transaction: `onchain:<receiving account>` +amount, and `customer:<id>` or `unattributed:<receiving account>` −amount (per token contract).
- Resolving an unattributed deposit (`attributeDeposit`) writes a new `reattribution` entry (`unattributed` +amount, `customer` −amount); no existing posting changes. Concurrent attempts: exactly one wins.
- `internal_records` are immutable and idempotent by `(org_id, external_id)`; a resubmission with different content is reported as a conflict, never overwritten.
- `runReconciliation` is deterministic (pure `reconcile()` in `packages/core`): tx-hash matches first, then `(customer, token, amount)`, oldest first. Outcomes: matched, amount mismatch, customer mismatch, missing internally, missing on-chain.
- Exception cases are unique per `(org_id, kind, subject_ref)`, so repeated or concurrent runs never duplicate them and dismissed cases are not reopened. Status changes follow `open → investigating → resolved | dismissed`, enforced in code and by a database trigger; every change is recorded in `case_events` and `audit_log`.
- CLI: `DATABASE_URL=... pnpm --filter @welyvra/reconciliation reconcile <org-id>`.
