# Contracts

Soroban smart contracts in Rust. A Cargo workspace, separate from the pnpm workspace.

| Contract                                               | What it does                                                                                                                    | Moves funds |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| [`receiver-vault`](contracts/receiver-vault)           | A business's receiving account: customers pay its `W` address; funds leave only by sweep to the treasury or refund of a deposit | Yes         |
| [`reconciliation-seal`](contracts/reconciliation-seal) | Write-once, public fingerprint (SHA-256) of each reconciliation run, verifiable by anyone                                       | No          |

Why they exist and what they deliberately do not do: [ADR-0005](../../docs/adr/0005-contracts-vault-and-seal.md).

**Status: pre-alpha, testnet only, not audited.** The receiver vault holds funds: it must pass an independent security audit before any mainnet deployment.

## Commands

Requires Rust via `rustup` (the toolchain, `wasm32v1-none` target and components come from `rust-toolchain.toml`) and, for deployment, the Stellar CLI.

```sh
cd apps/contracts
cargo test                                            # unit and adversarial tests
cargo clippy --all-targets -- -D warnings
cargo fmt --all
stellar contract build                                # WASM in target/wasm32v1-none/release/
```

From the repository root, `make check` runs all of the above together with the TypeScript checks.

## Receiver vault

| Role     | Who holds the key                              | Can do                                                                                     |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| admin    | The business (never Welyvra)                   | Refund deposits, change operator / treasury / tokens, unpause, hand over admin (two steps) |
| operator | An automated key (Welyvra service or business) | Sweep to the treasury, pause                                                               |
| treasury | The business's main account                    | Receives sweeps                                                                            |

- Customers pay to the vault's muxed `W` address. The 64-bit muxed ID identifies the customer; Welyvra reads it from the transfer event (`to_muxed_id`). Nothing in the contract runs on receipt: Soroban token transfers do not call the recipient, so the vault cannot reject a deposit.
- `sweep(token, amount)`: operator signature; the destination is always the treasury, so a leaked operator key cannot redirect funds.
- `refund(token, to, amount, deposit_ref)`: admin signature; at most once per `deposit_ref`, recorded on-chain (`refund_of`).
- `deposit_ref` = `SHA-256("<network>:<event_id>")`, e.g. `SHA-256("testnet:0004538292381761536-0000000001")`, where `event_id` is the RPC event ID of the deposit.
- Only allowlisted tokens (max 20) can be swept or refunded. `pause` stops both.
- Not upgradeable. A fix means deploying a new vault and sweeping to it.
- Events: `swept`, `refunded`, `config_changed`.

## Reconciliation seal

- `seal(sealer, run_id, digest, results)`: sealer signature; write-once per `(sealer, run_id)`. `run_id` is the run UUID as 16 bytes.
- `verify(sealer, run_id, digest)` returns `true` only for the exact digest that was sealed. `get` returns the seal with its ledger and timestamp.
- No admin, no upgrade: nobody, Welyvra included, can change a seal.
- Seals use persistent storage with a ~180 day TTL. Anyone can call `extend`; an archived seal can be restored, not lost.

### Digest format (v1)

**Specified, not yet produced by the API** (tracked separately). The digest is SHA-256 over UTF-8 lines joined by `\n`, no trailing newline:

```
welyvra-seal-v1
<run uuid, lowercase>
<one line per result, sorted bytewise>
```

Each result line is `<outcome>|<deposit_id or ->|<internal_record_id or ->`. `results` is the number of result lines. Anyone with the run's results from the API can recompute it.

## Tests

Every test runs in the Soroban test environment (`soroban-sdk` testutils) with a real Stellar Asset Contract. Besides the happy paths they cover: signatures from the wrong role, an operator trying to refund to an address of its choice, double refunds, failed transfers leaving no record, pause, allowlist limits, two-step admin hand-over, write-once seals and sealer isolation.
