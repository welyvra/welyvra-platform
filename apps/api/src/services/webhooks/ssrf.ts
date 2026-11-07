import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Destinations a webhook may never reach: loopback, private, link-local (incl. cloud metadata), CGNAT, multicast, reserved. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
// Note: no IPv4-mapped (::ffff:0:0/96) rule here. Node's BlockList also applies such rules to
// plain IPv4 addresses, which would block every public IPv4. Mapped addresses are rejected by
// isBlockedAddress before the list is consulted.
for (const [net, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

export function isBlockedAddress(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) has no legitimate use for a webhook and is a classic
  // filter bypass, so it is always blocked.
  if (/^::ffff:/i.test(ip)) return true;
  if (ip === '::') return true;
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) return blocked.check(ip, 'ipv6');
  return true;
}

export class UnsafeUrlError extends Error {}

export interface UrlPolicy {
  /** Local development only: allow http:// and private addresses. Never in production. */
  allowInsecure?: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

const defaultResolve = async (host: string) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Validates a customer-provided webhook URL. Run at registration and again before each delivery (DNS can change). */
export async function assertSafeWebhookUrl(raw: string, policy: UrlPolicy = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('invalid URL');
  }
  if (url.username || url.password) throw new UnsafeUrlError('credentials in URL are not allowed');
  if (url.protocol !== 'https:' && !(policy.allowInsecure && url.protocol === 'http:')) {
    throw new UnsafeUrlError('webhook URL must use https');
  }
  if (policy.allowInsecure) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await (policy.resolve ?? defaultResolve)(host).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError('host does not resolve');
  if (addresses.some(isBlockedAddress))
    throw new UnsafeUrlError('host resolves to a private or reserved address');
  return url;
}
