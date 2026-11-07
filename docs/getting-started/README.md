# Getting started

Requirements: Node 24+, pnpm 10, Docker. Everything runs on **Stellar testnet** with fictional data.

## 1. Run the demo (about 2 minutes)

```sh
pnpm install
docker compose -f infra/docker/compose.yml up -d
export DATABASE_URL=postgres://welyvra:welyvra@localhost:54329/welyvra
pnpm demo            # recorded testnet events, no network needed
pnpm demo:live       # sends fresh payments on testnet and ingests them from Stellar RPC
```

The demo creates a fresh `welyvra_demo` database, registers a receiving account (`G…`) and a smart account (`C…`), four customers with routing keys (memo ID, memo text, `M` muxed ID, `W` muxed ID), ingests six payments **twice** (the replay must change nothing), records internal invoices, reconciles, and checks the money invariants. It prints an admin API key and exits non-zero if any invariant fails.

Expected result:

```
deposits            6 (5 attributed)
on-chain total      16.5000001 XLM
open cases          {"amount_mismatch":1,"missing_internal":3,"missing_onchain":1,"unattributed_deposit":1}
All invariants hold.
```

## 2. Open the dashboard

```sh
export WEBHOOK_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DATABASE_URL=postgres://welyvra:welyvra@localhost:54329/welyvra_demo node apps/api/dist/server.js   # API on :3001
cd apps/webapp && WELYVRA_API_URL=http://127.0.0.1:3001 pnpm start                             # UI on :3000
```

Sign in with the API key the demo printed. Open **Cases → Unattributed deposit** and attribute it to a customer: a new balanced ledger entry is written, the case is resolved, and the audit log records who did it and why.

## 3. Run the tests

```sh
pnpm test            # unit + database tests (needs DATABASE_URL)
pnpm exec playwright install chromium
pnpm e2e             # browser end-to-end tests (seeds its own welyvra_e2e database)
```

## Ingest live testnet continuously

```sh
INGEST_ENABLED=true INGEST_START_LEDGER=<ledger> STELLAR_NETWORK=testnet node apps/api/dist/server.js
```

Mainnet is refused unless `ALLOW_MAINNET=true` is set explicitly.
