import { describe, expect, it } from 'vitest';
import { isBlockedHostname, isBlockedIp } from './ip.js';

describe('isBlockedIp', () => {
  const blocked = [
    // loopback / unspecified
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3', '::1', '::',
    // private
    '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    // link-local + cloud metadata
    '169.254.169.254', '169.254.0.1', 'fe80::1', 'fd00:ec2::254', 'fd12:3456::1',
    // CGNAT incl. Alibaba metadata
    '100.64.0.1', '100.100.100.200', '100.127.255.255',
    // multicast / reserved / broadcast
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', 'ff02::1',
    // documentation / benchmarking / protocol assignments
    '192.0.2.1', '198.51.100.7', '203.0.113.9', '198.18.0.1', '192.0.0.8', '2001:db8::1',
    // IPv4-mapped, NAT64, 6to4, Teredo
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:0:4136:e378::1',
    // not an IP at all, or zone-scoped: fail closed
    'example.com', '', '999.1.1.1', 'fe80::1%eth0', '1.2.3',
  ];
  for (const ip of blocked) {
    it(`blocks ${JSON.stringify(ip)}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e'];
  for (const ip of allowed) {
    it(`allows public ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
});

describe('isBlockedHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', 'metadata.google.internal', 'foo.local', 'printer.lan', 'x.home.arpa', 'localhost.', 'svc.cluster.internal'])(
    'blocks %s',
    (h) => expect(isBlockedHostname(h)).toBe(true),
  );
  it.each(['example.com', 'localhost.example.com', 'notlocal.com', 'internal-tools.com', 'my.corporate.com'])('allows %s', (h) =>
    expect(isBlockedHostname(h)).toBe(false),
  );
});
