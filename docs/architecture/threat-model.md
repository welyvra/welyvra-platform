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

## Smart contracts (ADR-0005)

| Threat                 | Example                                            | Mitigation                                                                               |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Elevation of privilege | Leaked operator key used to drain the vault        | Operator can only sweep to the admin-set treasury; refunds need the admin (the business) |
| Tampering              | Same unattributed deposit refunded twice           | On-chain refund record per `deposit_ref`; second call fails (`AlreadyRefunded`)          |
| Elevation of privilege | Admin key typo or loss locks the vault             | Two-step admin hand-over (`propose_admin` / `accept_admin`)                              |
| Tampering              | Malicious code upgrade                             | Neither contract is upgradeable; fixes are new deployments                               |
| Tampering              | Past reconciliation run edited after the fact      | Write-once seal per `(sealer, run_id)`; `verify` recomputes against the published digest |
| Spoofing               | Seal written in another business's name            | `sealer.require_auth()`; seals namespaced by sealer                                      |
| Denial of service      | Vault keeps working after a compromise is detected | Admin or operator can `pause` all outflows                                               |
| Financial correctness  | Logic bug in the vault                             | Adversarial unit tests, clippy in CI; **independent audit required before mainnet**      |

## Out of scope

Key custody and signing (Welyvra holds no keys that move funds).
