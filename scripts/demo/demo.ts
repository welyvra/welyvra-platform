/**
 * pnpm demo [--live]
 *
 * Recorded mode (default, no network): ingests the real testnet events captured in issue #3.
 * Live mode: sends fresh payments on testnet (Friendbot-funded throwaway accounts) and
 * ingests them from Stellar RPC. Then reconciles and verifies the money invariants.
 * Exits non-zero on any invariant violation.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatAmount } from '@welyvra/core';
import {
  freshDatabase,
  liveSource,
  loadCapture,
  recordedSource,
  seedDemo,
  verifyInvariants,
} from './seed.ts';

const live = process.argv.includes('--live');
const adminUrl = process.env.DATABASE_URL ?? 'postgres://welyvra:welyvra@localhost:54329/welyvra';

let capture = loadCapture();
if (live) {
  const dir = mkdtempSync(join(tmpdir(), 'welyvra-demo-'));
  console.log(
    'Sending fresh payments on Stellar testnet (memo id, memo text, M, plain C, W, SAC to M)…',
  );
  execFileSync('node', ['scripts/research/p30-events.ts'], {
    stdio: 'inherit',
    env: { ...process.env, P30_OUT_DIR: dir },
  });
  capture = loadCapture(join(dir, 'p30-testnet-events.json'));
}

const url = await freshDatabase(adminUrl, 'welyvra_demo');
const demo = await seedDemo(url, capture, live ? liveSource() : recordedSource(capture));
const report = await verifyInvariants(url, demo.orgId, Object.keys(capture.transactions).length);

console.log(`
Welyvra demo (${live ? 'live testnet' : 'recorded testnet events'})
  deposits            ${report.deposits} (${report.attributed} attributed)
  on-chain total      ${formatAmount(report.onchainTotal as never, 7)} XLM
  open cases          ${JSON.stringify(report.openCases)}
  database            ${url.replace(/:[^:@/]+@/, ':***@')}
  admin API key       ${demo.apiKey}

Next: start the API (apps/api) with DATABASE_URL pointing at welyvra_demo and open the dashboard.
`);
if (report.violations.length) {
  console.error('INVARIANT VIOLATIONS:\n  ' + report.violations.join('\n  '));
  process.exit(1);
}
console.log('All invariants hold.');
