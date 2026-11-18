import { BlockList, isIP } from 'node:net';

/**
 * Deny-list of every non-public-internet range. Anything in these ranges is
 * never fetched. Anything we cannot parse is also blocked (fail closed).
 *
 * Cloud metadata endpoints are covered structurally:
 *  - AWS/GCP/Azure/DO 169.254.169.254   -> 169.254.0.0/16 (link-local)
 *  - AWS IPv6 fd00:ec2::254              -> fc00::/7 (unique local)
 *  - Alibaba 100.100.100.200             -> 100.64.0.0/10 (CGNAT)
 */
const blocked = new BlockList();

const v4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT (+ Alibaba metadata)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (+ cloud metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay (deprecated)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');

const v6: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  // NOTE: IPv4-mapped (::ffff:0:0/96) is deliberately NOT here. Node's BlockList compares IPv4
  // addresses in mapped IPv6 space, so that rule would match every IPv4 address. See isMappedIpv4().
  ['64:ff9b::', 96], // NAT64 (can embed private IPv4)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (incl. Teredo 2001::/32)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fc00::', 7], // unique local (+ AWS IPv6 metadata)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, 'ipv6');

/** True if the address must not be contacted. Non-IP input and zone-scoped addresses are blocked. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 6 && isMappedIpv4(ip)) return true; // a public host never needs a mapped address
  return blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/** IPv4-mapped IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1, 0:0:0:0:0:ffff:...). Canonicalised via the URL parser; unparseable counts as blocked. */
function isMappedIpv4(ip: string): boolean {
  try {
    return new URL(`http://[${ip}]`).hostname.startsWith('[::ffff:');
  } catch {
    return true;
  }
}

const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'local',
  'internal', // metadata.google.internal, *.compute.internal, k8s etc.
  'localdomain',
  'lan',
  'intranet',
  'corp',
  'home',
  'home.arpa',
  'arpa',
];

/** Hostname-level pre-filter, a cheap early rejection. It is NOT the security boundary: resolved IPs are. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
