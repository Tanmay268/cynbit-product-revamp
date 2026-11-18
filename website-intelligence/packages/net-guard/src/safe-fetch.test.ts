import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedIp } from './ip.js';
import { createSafeFetch, SafeFetchError } from './safe-fetch.js';

let server: http.Server;
let port = 0;
const url = (path: string, host = 'site.example') => `http://${host}:${port}${path}`;

// Local test server stands in for "the internet". Everything below talks to it
// through the real safe-fetch code path; only the *policy* is relaxed so that
// loopback is reachable (hostnames resolve to 127.0.0.1 via the stub resolver).
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/ok') {
      res.setHeader('set-cookie', ['a=1; Secure', 'b=2']);
      res.end('hello');
    } else if (path === '/echo-headers') {
      res.end(JSON.stringify(req.headers));
    } else if (path === '/r1') {
      res.writeHead(302, { location: '/r2' }).end();
    } else if (path === '/r2') {
      res.writeHead(301, { location: '/ok' }).end();
    } else if (path === '/loop') {
      res.writeHead(302, { location: '/loop' }).end();
    } else if (path === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    } else if (path === '/to-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' }).end();
    } else if (path === '/to-port') {
      res.writeHead(302, { location: 'http://site.example:6379/' }).end();
    } else if (path === '/to-private-name') {
      res.writeHead(302, { location: 'http://rebind.example/' }).end();
    } else if (path === '/to-credentials') {
      res.writeHead(302, { location: 'http://u:p@site.example/' }).end();
    } else if (path === '/big') {
      res.end(Buffer.alloc(1_000_000, 97));
    } else if (path === '/gzip-bomb') {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync(Buffer.alloc(50_000_000, 0))); // ~50 KB on the wire, 50 MB decompressed
    } else if (path === '/gzip') {
      res.writeHead(200, { 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('compressed hello'));
    } else if (path === '/hang') {
      // never respond
    } else if (path === '/slow-body') {
      res.writeHead(200);
      res.write('start');
      // never finishes
    } else {
      res.statusCode = 404;
      res.end('nope');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// site.example -> loopback (allowed for tests); rebind.example -> private (must be blocked)
const lookup = async (hostname: string) =>
  hostname === 'rebind.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
const relaxedLoopback = (ip: string) => ip !== '127.0.0.1' && isBlockedIp(ip);
const safeFetch = createSafeFetch({ lookup, isBlockedIp: relaxedLoopback, allowedPorts: null });

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as SafeFetchError;
  }
  throw new Error('expected rejection');
};

describe('safeFetch: normal behaviour', () => {
  it('fetches a page and returns normalised headers', async () => {
    const r = await safeFetch(url('/ok'));
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe('hello');
    expect(r.truncated).toBe(false);
    expect(r.headers['set-cookie']).toEqual(['a=1; Secure', 'b=2']);
  });

  it('follows redirects and records the chain', async () => {
    const r = await safeFetch(url('/r1'));
    expect(r.body.toString()).toBe('hello');
    expect(r.redirects.map((x) => x.status)).toEqual([302, 301]);
    expect(r.url).toBe(url('/ok') + '');
  });

  it('decompresses gzip', async () => {
    expect((await safeFetch(url('/gzip'))).body.toString()).toBe('compressed hello');
  });

  it('never sends cookies/authorization even if the caller asks', async () => {
    const r = await safeFetch(url('/echo-headers'), { headers: { cookie: 'sid=1', authorization: 'Bearer x', 'x-ok': '1' } });
    const sent = JSON.parse(r.body.toString()) as Record<string, string>;
    expect(sent.cookie).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
    expect(sent['x-ok']).toBe('1');
  });

  it('supports HEAD without reading a body', async () => {
    const r = await safeFetch(url('/ok'), { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });
});

describe('safeFetch: SSRF protections', () => {
  it('blocks loopback with the DEFAULT policy', async () => {
    const strict = createSafeFetch({ allowedPorts: null });
    expect(await failure(strict(`http://127.0.0.1:${port}/ok`))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks a hostname that resolves to loopback with the DEFAULT policy (connection-time guard)', async () => {
    const strict = createSafeFetch({ lookup, allowedPorts: null });
    expect(await failure(strict(url('/ok')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks redirects to cloud metadata', async () => {
    expect(await failure(safeFetch(url('/to-metadata')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks redirects to non-http schemes', async () => {
    expect(await failure(safeFetch(url('/to-file')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks redirects to non-standard ports when the port policy is on', async () => {
    const portPolicy = createSafeFetch({ lookup, isBlockedIp: relaxedLoopback, allowedPorts: [port] });
    expect(await failure(portPolicy(url('/to-port')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks redirects carrying credentials', async () => {
    expect(await failure(safeFetch(url('/to-credentials')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('blocks a redirect to a hostname that resolves to a private IP (rebinding via redirect)', async () => {
    expect(await failure(safeFetch(url('/to-private-name')))).toMatchObject({ code: 'BLOCKED' });
  });

  it('rejects invalid initial URLs before any network activity', async () => {
    expect(await failure(safeFetch('file:///etc/passwd'))).toMatchObject({ code: 'BLOCKED' });
    expect(await failure(safeFetch('http://169.254.169.254/'))).toMatchObject({ code: 'BLOCKED' });
  });

  it('error messages contain no internal addresses', async () => {
    const e = await failure(safeFetch(url('/to-private-name')));
    expect(e.message).not.toMatch(/10\.0\.0\.5|127\.0\.0\.1/);
  });
});

describe('safeFetch: resource limits', () => {
  it('stops redirect loops', async () => {
    expect(await failure(safeFetch(url('/loop'), { maxRedirects: 3 }))).toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
  });

  it('truncates bodies at maxBytes', async () => {
    const r = await safeFetch(url('/big'), { maxBytes: 1000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(1000);
  });

  it('caps DECOMPRESSED size (gzip bomb)', async () => {
    const r = await safeFetch(url('/gzip-bomb'), { maxBytes: 100_000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBe(100_000);
  });

  it('times out when the server never responds', async () => {
    const t = Date.now();
    expect(await failure(safeFetch(url('/hang'), { timeoutMs: 300 }))).toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('times out when the body never completes', async () => {
    expect(await failure(safeFetch(url('/slow-body'), { timeoutMs: 300 }))).toMatchObject({ code: 'TIMEOUT' });
  });

  it('honours a caller abort signal', async () => {
    const ac = new AbortController();
    const p = safeFetch(url('/hang'), { signal: ac.signal, timeoutMs: 5000 });
    setTimeout(() => ac.abort(), 100);
    expect(await failure(p)).toMatchObject({ code: 'ABORTED' });
  });

  it('reports connection failures generically', async () => {
    const closed = http.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => closed.once('listening', r));
    const p = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    const e = await failure(safeFetch(`http://site.example:${p}/`));
    expect(e).toMatchObject({ code: 'NETWORK', message: 'Could not connect to the website.' });
  });
});

describe('mapFetchError (TLS)', () => {
  const signal = new AbortController().signal;
  it.each([
    ['CERT_HAS_EXPIRED', /has expired/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', /self-signed/],
    ['ERR_TLS_CERT_ALTNAME_INVALID', /does not match the domain/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /could not be verified/],
  ])('maps %s to a user-safe TLS error', async (code, message) => {
    const { mapFetchError } = await import('./safe-fetch.js');
    const e = mapFetchError(Object.assign(new Error('raw openssl detail 10.0.0.1'), { code }), signal);
    expect(e.code).toBe('TLS');
    expect(e.message).toMatch(message);
    expect(e.message).not.toMatch(/openssl|10\.0\.0\.1/);
  });

  it('finds the TLS code on a wrapped cause', async () => {
    const { mapFetchError } = await import('./safe-fetch.js');
    const e = mapFetchError(new Error('outer', { cause: Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }) }), signal);
    expect(e.code).toBe('TLS');
  });
});
