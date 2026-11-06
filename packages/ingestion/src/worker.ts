import type { Network } from '@welyvra/core';
import { type IngestConfig, ingestBatch } from './ingest.js';

export interface WorkerOptions extends IngestConfig {
  pollIntervalMs?: number;
  /** Must be true to run against mainnet. The MVP is testnet-only. */
  allowMainnet?: boolean;
  signal?: AbortSignal;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export function assertNetworkAllowed(network: Network, allowMainnet: boolean | undefined): void {
  if (network === 'mainnet' && allowMainnet !== true) {
    throw new Error(
      'Refusing to ingest mainnet: set ALLOW_MAINNET=true only after explicit founder approval',
    );
  }
}

/** Polls until aborted. Errors are logged and retried on the next tick; the cursor only moves on commit. */
export async function runWorker(opts: WorkerOptions): Promise<void> {
  assertNetworkAllowed(opts.network, opts.allowMainnet);
  const log =
    opts.log ?? ((msg, data) => console.log(JSON.stringify({ level: 'info', msg, ...data })));
  const interval = opts.pollIntervalMs ?? 5_000;
  while (!opts.signal?.aborted) {
    try {
      const r = await ingestBatch(opts);
      log('ingest.batch', { ...r });
      if (r.status === 'gap_detected') {
        log('ingest.gap_detected', { network: opts.network, source: opts.sourceName });
        return; // needs operator action (backfill); never report in-sync
      }
      if (r.status === 'ok' && r.fetched >= (opts.pageLimit ?? 200)) continue; // more pages ready
    } catch (e) {
      log('ingest.error', { error: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
