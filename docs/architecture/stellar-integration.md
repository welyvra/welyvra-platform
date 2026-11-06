# Stellar integration

Facts below were read on 2026-11-05 from the [Protocol 30 announcement](https://stellar.org/blog/developers/introducing-bell-protocol-30-on-stellar), the [upgrade guide](https://stellar.org/blog/developers/bell-protocol-30-upgrade-guide) (last updated 2026-10-23) and [CAP-84](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0084.md). Items marked **verify** are tracked in the Protocol 30 research issue and must be confirmed on testnet before code depends on them.

## Attribution sources

Welyvra treats all three as a _routing key_ on a _receiving account_, so the rest of the system does not care which one was used.

| Source                               | Destination                    | Where the customer ID appears                                                                                                                                            |
| ------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Memo                                 | Classic account `G…`           | Transaction memo (ID or text). Per CAP-67, classic payments emit unified `transfer` events with `to_muxed_id` derived from the memo — **verify** exact shape on testnet. |
| Muxed account (CAP-27)               | `M…` = `G` account + 64-bit ID | `to_muxed_id` in the transfer event data (CAP-67)                                                                                                                        |
| Muxed contract (CAP-84, Protocol 30) | `W…` = contract ID + 64-bit ID | `to_muxed_id` (u64) in the transfer/mint event data                                                                                                                      |

## Event shape (CAP-84, for W destinations)

```
transfer: topics ["transfer", from: <non-muxed address>, to: <non-muxed contract address>]
          data   { amount: i128, to_muxed_id: u64 }
mint:     topics ["mint", to: <non-muxed contract address>]
          data   { amount: i128, to_muxed_id: u64 }
```

The muxed ID is in **data**, not topics. Topics carry the underlying (non-muxed) address, so filtering by receiving account works on the base `C…`/`G…` address.

## W address encoding (CAP-84)

Strkey version byte `22 << 3` (`0xb0`), prefix `W`. Payload: 32-byte contract ID + 8-byte big-endian ID. XDR: `SC_ADDRESS_TYPE_MUXED_CONTRACT = 5`. The normative strkey definition is expected in SEP-23 (**verify**).

## Versions and activation

| Item                   | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Testnet upgrade vote   | 2026-11-03 17:00 UTC (outcome: **verify**)                                 |
| Mainnet upgrade vote   | 2026-11-23 17:00 UTC (scheduled; subject to change)                        |
| Core / RPC / Horizon   | v30.0.0                                                                    |
| `@stellar/stellar-sdk` | 17.3.0 for W addresses (16.4.0 decodes P30 ledgers without W support)      |
| Rust soroban-sdk       | 30.0.0-rc.1 (stable promised before mainnet vote) — not needed for the MVP |
| Stellar CLI            | P30 release pending at time of reading                                     |

## Breaking changes we must handle

- **CAP-88** changes the ledger header (`STELLAR_VALUE_SIGNED_MS`, `TimePointMs`). Any non-SDK XDR decoding must be updated; consecutive ledgers can share the same whole-second `closeTime`. We never use `closeTime` for ordering — we use ledger sequence and event ID.
- **CAP-84** adds a new address variant. Address parsing must accept `W` and must store base contract and muxed ID separately.

## Ingestion source and retention

Stellar RPC keeps a limited window of events (default retention is a node setting; **verify** for the provider we use). If the worker is down longer than the window, `getEvents` cannot fill the gap. The worker must detect this (`startLedger` older than the oldest available ledger), raise an exception case, and never report the account as in sync. Backfill beyond retention (Galexie / history archives) is a post-MVP item.

## Networks

MVP: testnet only, fake data, Friendbot-funded accounts. Mainnet requires explicit approval from the founder.
