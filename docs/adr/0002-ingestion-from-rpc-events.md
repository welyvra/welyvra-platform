# ADR-0002: Ingest from Stellar RPC events with a persisted cursor

- Status: Accepted · Date: 2026-11-05

## Context

Since CAP-67, transfers (classic and Soroban) are visible as unified contract events, and CAP-84 places the muxed ID in event data. One event source covers memo, `M` and `W` attribution (to be verified on testnet).

## Decision

A single worker polls `getEvents`, filtered to token transfer/mint events touching registered accounts. Each batch — events, deposits, postings, outbox rows and the cursor — is committed in one PostgreSQL transaction. Event uniqueness is enforced by `unique (network, event_id)`.

## Alternatives

- Horizon streaming: Horizon is being de-emphasized in favor of RPC; would need a second path for Soroban.
- Third-party indexers: extra dependency and trust; can be added later as a cross-check.
- Galexie data lake: needed for backfill beyond RPC retention; post-MVP.

## Consequences

At-least-once delivery from RPC becomes exactly-once effects in our DB. Gaps longer than RPC retention are detected and surfaced, not silently skipped.
