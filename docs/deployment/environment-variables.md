# Environment variables

Read once at startup by `apps/api/src/config/env.ts`. The server refuses to start when a required variable is missing. A template for local development is in [`.env.example`](../../.env.example).

## API server (`apps/api`)

| Variable                 | Required                   | Default                               | Purpose                                                                                         |
| ------------------------ | -------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | yes                        |                                       | PostgreSQL connection string                                                                    |
| `WEBHOOK_ENCRYPTION_KEY` | yes                        |                                       | 32 bytes of hex. Encrypts webhook signing secrets at rest (AES-256-GCM). Keep it secret.        |
| `HOST`                   | no                         | `127.0.0.1`                           | Listen address                                                                                  |
| `PORT`                   | no                         | `3001`                                | Listen port                                                                                     |
| `STELLAR_NETWORK`        | no                         | `testnet`                             | `testnet` or `mainnet`                                                                          |
| `WEBHOOK_ALLOW_INSECURE` | no                         | `false`                               | Local development only: allows `http://` and private webhook destinations. Never in production. |
| `INGEST_ENABLED`         | no                         | `false`                               | Run the Stellar ingestion worker in the API process                                             |
| `INGEST_START_LEDGER`    | when `INGEST_ENABLED=true` |                                       | First ledger to ingest when no cursor exists yet                                                |
| `STELLAR_RPC_URL`        | no                         | `https://soroban-testnet.stellar.org` | Stellar RPC endpoint                                                                            |
| `INGEST_SOURCE_NAME`     | no                         | `default`                             | Name of the ingestion cursor (one per source)                                                   |
| `TOKEN_CONTRACTS`        | no                         | native XLM contract of the network    | Comma-separated token contract IDs (`C…`) to ingest                                             |
| `ALLOW_MAINNET`          | no                         | `false`                               | Mainnet ingestion is refused unless this is `true`. The project is testnet-only (pre-alpha).    |

Generate an encryption key:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Web frontend (`apps/webapp`)

| Variable          | Required | Default                 | Purpose                                   |
| ----------------- | -------- | ----------------------- | ----------------------------------------- |
| `WELYVRA_API_URL` | no       | `http://127.0.0.1:3001` | API base URL, called from the server only |

The dashboard keeps the API key in an `httpOnly` cookie; it never reaches browser JavaScript.
