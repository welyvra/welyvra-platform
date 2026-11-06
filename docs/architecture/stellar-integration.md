# Stellar integration

Facts below were read on 2026-11-05 from the [Protocol 30 announcement](https://stellar.org/blog/developers/introducing-bell-protocol-30-on-stellar), the [upgrade guide](https://stellar.org/blog/developers/bell-protocol-30-upgrade-guide) (last updated 2026-10-23) and [CAP-84](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0084.md). Every item below was verified on testnet on 2026-11-05 (issue #3). Evidence: `tests/fixtures/stellar/p30-testnet-events.json` (raw RPC responses, tx hashes) and `tests/fixtures/stellar/p30-fixture.test.ts`. Recapture with `pnpm research:p30`.

## Attribution sources

Welyvra treats all three as a _routing key_ on a _receiving account_, so the rest of the system does not care which one was used.

| Source                               | Destination                    | Where the customer ID appears                                                                                     |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Memo                                 | Classic account `G…`           | `to_muxed_id` in the transfer event data, derived from the memo: memo ID → `u64`, memo text → `string` (verified) |
| Muxed account (CAP-27)               | `M…` = `G` account + 64-bit ID | `to_muxed_id` (`u64`); topic `to` is the base `G` (verified, classic payment and SAC transfer)                    |
| Muxed contract (CAP-84, Protocol 30) | `W…` = contract ID + 64-bit ID | `to_muxed_id` (`u64`); topic `to` is the base `C` (verified)                                                      |
| None                                 | `G…` or `C…`                   | Data is a **bare `i128`**, not a map (verified)                                                                   |

## Event shape (verified on testnet, Protocol 30)

```
transfer: topics ["transfer", from, to (always non-muxed), asset (SEP-11 string, e.g. "native")]
          data   i128                                                 when there is no muxed id
          data   { amount: i128, to_muxed_id: u64 | string | bytes }  otherwise
fee:      topics ["fee", account]   data i128 (negative for refunds)  -> ignored by ingestion
```

- The muxed ID is in **data**, never in topics. Filtering by receiving account uses the base `G…`/`C…` address in topic 3.
- `getEvents` returns for each event: `type, ledger, ledgerClosedAt, contractId, id, operationIndex, transactionIndex, txHash, topic[], value` (base64 XDR). `id` (`<19 digits>-<10 digits>`) is unique and ordered; it is our idempotency key.
- Classic operations surface on the asset's SAC contract ID (native XLM: `Asset.native().contractId(passphrase)`).
- `mint` to a `W` address also carries `to_muxed_id` per CAP-84 (not captured yet).

## W address encoding (CAP-84)

Strkey version byte `22 << 3` (`0xb0`), prefix `W`. Payload: 32-byte contract ID + 8-byte big-endian ID. XDR: `SC_ADDRESS_TYPE_MUXED_CONTRACT = 5`. `@stellar/stellar-sdk` 17.4.0 provides `StrKey.encodeMuxedContract` / `decodeMuxedContract` and `Address.fromString('W…')`; it does **not** export a pack helper, so the 40-byte payload is built manually (see the research script).

## Versions and activation

| Item                   | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Testnet                | **Protocol 30 active** (RPC `getVersionInfo`: 30.0.0, checked 2026-11-05)  |
| Mainnet                | Protocol 29 on 2026-11-05; upgrade vote scheduled 2026-11-23 17:00 UTC     |
| Core / RPC / Horizon   | v30.0.0                                                                    |
| `@stellar/stellar-sdk` | 17.4.0 in use (17.3.0 minimum for W addresses)                             |
| Rust soroban-sdk       | 30.0.0-rc.1 (stable promised before mainnet vote) — not needed for the MVP |
| Stellar CLI            | P30 release pending at time of reading                                     |

## Breaking changes we must handle

- **CAP-88** changes the ledger header (`STELLAR_VALUE_SIGNED_MS`, `TimePointMs`). Any non-SDK XDR decoding must be updated; consecutive ledgers can share the same whole-second `closeTime`. We never use `closeTime` for ordering — we use ledger sequence and event ID.
- **CAP-84** adds a new address variant. Address parsing must accept `W` and must store base contract and muxed ID separately.

## Ingestion source and retention

Stellar RPC keeps a limited window of events. SDF testnet RPC reports `ledgerRetentionWindow: 120960` ledgers (about 7 days) via `getHealth` on 2026-11-05; other providers may differ, so the worker reads `oldestLedger` at runtime. If the worker is down longer than the window, `getEvents` cannot fill the gap. The worker must detect this (`startLedger` older than the oldest available ledger), raise an exception case, and never report the account as in sync. Backfill beyond retention (Galexie / history archives) is a post-MVP item.

## Networks

MVP: testnet only, fake data, Friendbot-funded accounts. Mainnet requires explicit approval from the founder.
