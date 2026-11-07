# ADR-0004: No custom Soroban contracts in the MVP

- Status: Superseded by [ADR-0005](0005-contracts-vault-and-seal.md) · Date: 2026-11-05

## Decision

Welyvra reads payments; it does not hold or move them. Attribution works from events alone, so the MVP ships no contracts. For W address demos we use an existing contract account on testnet, or a minimal receiver contract justified in its own issue.

## Consequences

Smaller attack surface, no contract audit needed for the MVP. Revisit if customers need on-chain logic (sweeps, limits).
