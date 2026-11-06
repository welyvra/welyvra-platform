# Architecture overview

Status: proposed (2026-11-05). Nothing below is implemented yet; each part is tracked by an issue.

## Shape

A **modular monolith**: one API process, one ingestion worker, one PostgreSQL database. No message broker, no microservices. Correctness comes from database constraints and transactions, not from distributed infrastructure.

```
Stellar RPC ──getEvents──▶ ingestion worker ──tx──▶ PostgreSQL ◀──tx── API (Fastify) ◀── dashboard (Next.js)
                              │                        ▲                     │
                              └── cursor per source ───┘                     └──▶ webhook dispatcher (outbox)
```

## Pipeline

1. **Ingest.** The worker polls Stellar RPC `getEvents` for `transfer`/`mint` events touching registered receiving accounts, starting from a persisted cursor.
2. **Normalize.** Each event becomes a `chain_event` keyed by its network-unique event ID. Insert is `ON CONFLICT DO NOTHING`, so replays are no-ops.
3. **Attribute.** The routing key (memo ID, or `to_muxed_id` from an `M`/`W` destination) is looked up for the receiving account. Known → `attributed`; unknown/missing → `unattributed` + exception case.
4. **Post.** A balanced double-entry journal entry is written in the **same transaction** as the deposit and the cursor advance.
5. **Reconcile.** On demand or on schedule, deposits are matched against internal records submitted by the business. Results are deterministic and re-runnable.
6. **Notify.** Webhook deliveries are written to an outbox in the same transaction and dispatched afterwards (at-least-once, idempotent IDs, HMAC signatures).

## Modules

| Module             | Responsibility                                                           | Depends on             |
| ------------------ | ------------------------------------------------------------------------ | ---------------------- |
| `packages/core`    | Pure domain: event normalization, attribution, ledger rules, matching    | nothing (no I/O)       |
| `packages/stellar` | RPC client, XDR and strkey (`G`/`M`/`C`/`W`) decoding                    | `@stellar/stellar-sdk` |
| `packages/db`      | Schema, migrations, repositories                                         | Drizzle, PostgreSQL    |
| `apps/api`         | REST API, auth, OpenAPI, ingestion worker entrypoint, webhook dispatcher | all packages           |
| `apps/dashboard`   | Operations UI                                                            | API                    |

Keeping `core` free of I/O makes the financial rules unit-testable with fixtures, including adversarial sequences.

## Explicit non-goals

Custody, signing, moving funds, smart contracts (none needed for the MVP — see ADR-0004), multi-chain, Kubernetes, Kafka.
