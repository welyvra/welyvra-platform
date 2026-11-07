# ADR-0005: Receiver vault and reconciliation seal contracts

- Status: Accepted · Date: 2026-11-06 · Supersedes [ADR-0004](0004-no-contracts-in-mvp.md)

## Context

ADR-0004 kept the MVP contract-free: attribution works from transfer events alone. Two needs change that:

1. Businesses adopting Protocol 30 receive payments at a muxed contract address (`W…`). That contract is theirs to choose, and today they have no receiving contract built for reconciliation: one that limits how funds leave and records refunds of unattributed deposits on-chain.
2. Reconciliation results live in Welyvra's database. A business, auditor or partner has no independent way to check that a past run was not edited.

## Decision

Two Soroban contracts in `apps/contracts`:

- **Receiver vault.** Customers pay to its `W` address. Funds leave only by `sweep` to a treasury fixed by the business (operator key) or by `refund` of a specific deposit, at most once (admin key). The business is the admin; Welyvra never holds a key that can send funds to an arbitrary address. Not upgradeable.
- **Reconciliation seal.** Write-once SHA-256 digest per reconciliation run, namespaced by the signer, publicly verifiable. No admin, not upgradeable.

## Consequences

- Welyvra still never custodies funds, but it now ships code that holds them. The vault must pass an independent audit before mainnet; until then, testnet only.
- The ingestion pipeline must learn the vault's `swept` and `refunded` events to post them to the ledger, and the API must produce seal digests (format in `apps/contracts/README.md`). Both are follow-up issues; docs must not claim them before tests prove them.
- Contracts get their own CI workflow (`.github/workflows/contracts.yml`) and are part of `make check`.
- Rejected: an upgradeable vault (an admin key that can replace the code is a larger risk than redeploying), letting the operator refund (a leaked automated key could then pay anyone), and a seal with an admin (it would let someone rewrite history).
