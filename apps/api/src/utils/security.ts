import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Constant-time comparison for secrets. Adapted from Akkuea (MIT, Copyright (c) Acachete Labs),
 * apps/api/src/utils/safeEqual.ts: both inputs are hashed to fixed-length digests first, so the
 * comparison never exits early on length, and missing values never authorize.
 */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0)
    return false;
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** API key format: `wlv_<12-char prefix>_<32-char secret>`. Only sha256(secret) is stored. */
export function generateApiKey(): { key: string; prefix: string; secretHash: string } {
  const prefix = randomToken(12);
  const secret = randomToken(32);
  return { key: `wlv_${prefix}_${secret}`, prefix, secretHash: sha256Hex(secret) };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const m = /^wlv_([a-z0-9]{12})_([a-z0-9]{32})$/.exec(key);
  return m ? { prefix: m[1] as string, secret: m[2] as string } : null;
}

/** AES-256-GCM for webhook signing secrets at rest. `keyHex` is 32 bytes of hex from the environment. */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ct.toString('base64'),
  ].join('.');
}

export function decryptSecret(ciphertext: string, keyHex: string): string {
  const [v, iv, tag, ct] = ciphertext.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', decodeKey(keyHex), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

function decodeKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new Error('WEBHOOK_ENCRYPTION_KEY must be 32 bytes of hex');
  return Buffer.from(hex, 'hex');
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Webhook signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
 * Signing the timestamp lets receivers reject replays (pattern from Akkuea's WebhookService:
 * HMAC-SHA256, constant-time compare, 5-minute timestamp tolerance).
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

/** What a receiver runs. Exported and documented so customers can copy it. */
export function verifyWebhook(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isSafeInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
