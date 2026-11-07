import { Asset, Networks } from '@stellar/stellar-sdk';

/** Server configuration, read once from the environment at startup. See docs/deployment/environment-variables.md. */
export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** 32-byte hex key that encrypts webhook signing secrets at rest. */
  webhookEncryptionKey: string;
  /** Local development only: allow http:// and private webhook destinations. */
  webhookAllowInsecure: boolean;
  network: 'testnet' | 'mainnet';
  ingestion: {
    enabled: boolean;
    rpcUrl: string;
    sourceName: string;
    tokenContracts: string[];
    startLedger: number;
    allowMainnet: boolean;
  };
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const network = required(env, 'STELLAR_NETWORK', 'testnet');
  if (network !== 'testnet' && network !== 'mainnet')
    throw new Error('STELLAR_NETWORK must be testnet or mainnet');
  const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const enabled = env.INGEST_ENABLED === 'true';

  return {
    host: required(env, 'HOST', '127.0.0.1'),
    port: Number(required(env, 'PORT', '3001')),
    databaseUrl: required(env, 'DATABASE_URL'),
    webhookEncryptionKey: required(env, 'WEBHOOK_ENCRYPTION_KEY'),
    webhookAllowInsecure: env.WEBHOOK_ALLOW_INSECURE === 'true',
    network,
    ingestion: {
      enabled,
      rpcUrl: required(env, 'STELLAR_RPC_URL', 'https://soroban-testnet.stellar.org'),
      sourceName: required(env, 'INGEST_SOURCE_NAME', 'default'),
      tokenContracts: (env.TOKEN_CONTRACTS ?? Asset.native().contractId(passphrase)).split(','),
      // Only required when ingestion runs.
      startLedger: enabled ? Number(required(env, 'INGEST_START_LEDGER')) : 0,
      allowMainnet: env.ALLOW_MAINNET === 'true',
    },
  };
}
