// Process entry point: load config, migrate, serve HTTP, run background workers, shut down cleanly.
import { connect, migrate } from '@welyvra/db';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { runIngestionWorker } from './workers/ingestionWorker.js';
import { runWebhookWorker } from './workers/webhookWorker.js';

const config = loadConfig();
const { sql, close } = connect(config.databaseUrl);
await migrate(sql);

const urlPolicy = { allowInsecure: config.webhookAllowInsecure };
const app = await buildApp({
  sql,
  webhookEncryptionKey: config.webhookEncryptionKey,
  logger: true,
  urlPolicy,
});
await app.listen({ host: config.host, port: config.port });

const stop = new AbortController();
const tasks: Promise<void>[] = [];
if (config.ingestion.enabled)
  tasks.push(runIngestionWorker({ sql, config, log: app.log, signal: stop.signal }));
tasks.push(
  runWebhookWorker({
    sql,
    dispatch: { encryptionKey: config.webhookEncryptionKey, urlPolicy },
    log: app.log,
    signal: stop.signal,
  }),
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
