# Threat model (initial)

Status: draft (2026-11-05). Will be expanded before any testnet pilot. Method: STRIDE over the data flow in [overview.md](overview.md).

## Assets

Correctness of the ledger · tenant data isolation · API keys · webhook secrets · availability of ingestion.

## Threats and mitigations

| Threat                 | Example                                           | Mitigation                                                                                       |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Spoofing               | Stolen API key used to post fake internal records | Hashed keys, roles, per-key rate limits, audit log, key rotation                                 |
| Spoofing               | Fake webhook sent to a customer's endpoint        | HMAC-SHA256 signature over timestamp + body; receivers reject old timestamps                     |
| Tampering              | Edit a historical journal entry to hide a loss    | Append-only tables, no UPDATE/DELETE grants, corrections as new entries                          |
| Tampering              | Malicious RPC returns fabricated events           | Use trusted RPC; post-MVP: cross-check against a second source or ledger hashes                  |
| Repudiation            | Operator resolves a case and denies it            | Case transitions require actor + reason; audit log                                               |
| Information disclosure | Tenant A reads tenant B deposits                  | `org_id` scoping enforced in repository layer + cross-tenant tests                               |
| Information disclosure | Secrets in logs                                   | Structured logging with redaction; secret scanning in CI                                         |
| Denial of service      | Flood of dust deposits creates millions of cases  | Per-account thresholds; batch case creation; rate limits                                         |
| Elevation of privilege | Malicious PR exfiltrates CI secrets               | No secrets in CI for PRs; no `pull_request_target`; minimal `permissions`; actions pinned by SHA |
| Financial correctness  | Duplicate or replayed event                       | Unique `(network, event_id)`; single transaction per batch                                       |
| Financial correctness  | Indexer down longer than RPC retention            | Gap detection → exception; never report "in sync"                                                |
| Financial correctness  | Malformed muxed ID / unknown address variant      | Strict parsing; unknown → unattributed, never dropped                                            |

## Out of scope

Key custody and signing (Welyvra holds no keys that move funds).
