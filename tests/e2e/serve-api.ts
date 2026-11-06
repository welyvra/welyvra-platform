// Seeds a fresh `welyvra_e2e` database with the recorded testnet events, then starts the real API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { freshDatabase, loadCapture, recordedSource, seedDemo } from '../../scripts/demo/seed.ts';

const adminUrl = process.env.DATABASE_URL ?? 'postgres://welyvra:welyvra@localhost:54329/welyvra';
const url = await freshDatabase(adminUrl, 'welyvra_e2e');
const capture = loadCapture();
const demo = await seedDemo(url, capture, recordedSource(capture));
mkdirSync(new URL('./.state/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('./.state/demo.json', import.meta.url),
  JSON.stringify({ apiKey: demo.apiKey }),
);

process.env.DATABASE_URL = url;
process.env.PORT = '3401';
process.env.WEBHOOK_ENCRYPTION_KEY ??= 'e'.repeat(64); // throwaway, test only
await import('../../apps/api/dist/server.js');
