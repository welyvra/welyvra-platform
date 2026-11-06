import { connect, migrate } from '@welyvra/db';
import { runWorker } from '@welyvra/ingestion';
import { RpcEventSource } from '@welyvra/stellar';
import { Asset, Networks } from '@stellar/stellar-sdk';
import { buildApp } from './app.js';
import { dispatchDue } from './webhooks/dispatcher.js';

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is required`);
  return v;
};

const network = env('STELLAR_NETWORK', 'testnet') as 'testnet' | 'mainnet';
const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const { sql, close } = connect(env('DATABASE_URL'));
await migrate(sql);

const encryptionKey = env('WEBHOOK_ENCRYPTION_KEY');
const allowInsecure = process.env.WEBHOOK_ALLOW_INSECURE === 'true';
const app = await buildApp({
  sql,
  webhookEncryptionKey: encryptionKey,
  logger: true,
  urlPolicy: { allowInsecure },
});
await app.listen({ host: env('HOST', '127.0.0.1'), port: Number(env('PORT', '3001')) });

const stop = new AbortController();
const tasks: Promise<void>[] = [];

if (process.env.INGEST_ENABLED === 'true') {
  tasks.push(
    runWorker({
      sql,
      network,
      source: new RpcEventSource({
        url: env('STELLAR_RPC_URL', 'https://soroban-testnet.stellar.org'),
      }),
      sourceName: env('INGEST_SOURCE_NAME', 'default'),
      tokenContracts: (process.env.TOKEN_CONTRACTS ?? Asset.native().contractId(passphrase)).split(
        ',',
      ),
      startLedger: Number(env('INGEST_START_LEDGER')),
      allowMainnet: process.env.ALLOW_MAINNET === 'true',
      signal: stop.signal,
      log: (msg, data) => app.log.info({ ...data }, msg),
    }),
  );
}

tasks.push(
  (async () => {
    while (!stop.signal.aborted) {
      try {
        const r = await dispatchDue(sql, { encryptionKey, urlPolicy: { allowInsecure } });
        if (r.delivered + r.retried + r.failed > 0) app.log.info(r, 'webhooks.dispatch');
      } catch (e) {
        app.log.error({ err: e }, 'webhooks.dispatch_error');
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  })(),
);

const shutdown = async () => {
  stop.abort();
  await app.close();
  await Promise.allSettled(tasks);
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
