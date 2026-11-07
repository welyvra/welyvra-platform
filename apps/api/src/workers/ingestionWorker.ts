import { runWorker } from '@welyvra/ingestion';
import { RpcEventSource } from '@welyvra/stellar';
import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from 'postgres';
import type { ServerConfig } from '../config/env.js';

/** Runs the Stellar ingestion worker (packages/ingestion) inside the API process. */
export function runIngestionWorker(opts: {
  sql: Sql;
  config: ServerConfig;
  log: FastifyBaseLogger;
  signal: AbortSignal;
}): Promise<void> {
  const { ingestion, network } = opts.config;
  return runWorker({
    sql: opts.sql,
    network,
    source: new RpcEventSource({ url: ingestion.rpcUrl }),
    sourceName: ingestion.sourceName,
    tokenContracts: ingestion.tokenContracts,
    startLedger: ingestion.startLedger,
    allowMainnet: ingestion.allowMainnet,
    signal: opts.signal,
    log: (msg, data) => opts.log.info({ ...data }, msg),
  });
}
