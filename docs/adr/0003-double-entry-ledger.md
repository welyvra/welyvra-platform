# ADR-0003: Minimal internal double-entry ledger

- Status: Accepted · Date: 2026-11-05

## Context

Reconciliation needs a record of what the business owes each customer that can be checked against the chain. Single-entry balances drift silently.

## Decision

Keep a minimal journal: `journal_entries` + `postings`, balanced per asset (deferred constraint), append-only. Accounts for the MVP: `onchain:<receiving_account>`, `customer:<id>`, `unattributed:<receiving_account>`. A deposit debits the on-chain account and credits the customer (or unattributed). Resolving an exception moves funds from unattributed to a customer with a new entry.

## Alternatives

Formance or Blnk as an external ledger: mature, but add a service to operate. Re-evaluate if requirements grow beyond these three account types.

## Consequences

Sum of `onchain:*` postings must equal the on-chain balance change; this is the core reconciliation check.
