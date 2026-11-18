import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSafeFetch, isBlockedIp, SafeFetchError, type SafeFetchResponse } from '@wi/net-guard';
import { describe, expect, it } from 'vitest';
import { BrowserUnavailableError } from '../analyzers/accessibility/types.js';
import { PlaywrightAxeRunner } from './browser.js';
import { handleBrowserRequest, type RouteLike } from './browser-routing.js';

const resp = (over: Partial<SafeFetchResponse> = {}): SafeFetchResponse => ({
  url: 'https://example.com/',
  status: 200,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from('hi'),
  truncated: false,
  redirects: [],
  durationMs: 1,
  ...over,
});

function harness(fetchImpl: (url: string, o?: Record<string, unknown>) => Promise<SafeFetchResponse>) {
  const calls: { fulfill?: Parameters<RouteLike['fulfill']>[0]; abort?: string } = {};
  const route: RouteLike = {
    fulfill: async (o) => void (calls.fulfill = o),
    abort: async (c) => void (calls.abort = c ?? 'failed'),
  };
  const fetched: { url: string; opts?: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, opts?: Record<string, unknown>) => {
    fetched.push({ url, opts });
    return fetchImpl(url, opts);
  }) as never;
  const send = (url: string, method = 'GET', headers: Record<string, string> = {}) =>
    handleBrowserRequest({ url: () => url, method: () => method, headers: () => headers }, route, fetch);
  return { calls, fetched, send };
}

describe('handleBrowserRequest: the browser never touches the network itself', () => {
  it('serves GET requests via safeFetch and fulfils with the (decoded) response', async () => {
    const h = harness(async () => resp({ headers: { 'content-type': 'text/css', 'content-encoding': 'gzip', 'content-length': '999', 'set-cookie': ['a=1'], etag: '"x"' }, body: Buffer.from('body{}') }));
    await h.send('https://example.com/app.css', 'GET', { accept: 'text/css', cookie: 'secret=1', authorization: 'Bearer t', 'accept-language': 'en' });

    expect(h.fetched[0]).toMatchObject({ url: 'https://example.com/app.css', opts: { method: 'GET', headers: { accept: 'text/css', 'accept-language': 'en' } } });
    // Only whitelisted request headers are forwarded: no cookies, no auth.
    expect(Object.keys(h.fetched[0]!.opts!.headers as object)).toEqual(['accept', 'accept-language']);
    expect(h.calls.fulfill).toMatchObject({ status: 200, body: Buffer.from('body{}') });
    // Encoding headers described the compressed body; cookies are never set in the audit browser.
    expect(Object.keys(h.calls.fulfill!.headers).sort()).toEqual(['content-type', 'etag']);
  });

  it('a redirect to a blocked destination aborts the request; the browser never sees a Location header', async () => {
    // Real safeFetch against a local server that redirects to the metadata IP: the hop is rejected inside safeFetch.
    const server = http.createServer((_req, res) => void res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    // Route the public-looking name to the local stub by rewriting only the address (not the policy).
    const viaStub = createSafeFetch({ lookup: async () => [{ address: '127.0.0.1', family: 4 }], isBlockedIp: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip), allowedPorts: null });
    try {
      const h = harness((u, o) => viaStub(u, o as never));
      await h.send(`http://public.example:${port}/redir`);
      expect(h.calls.abort).toBe('blockedbyclient');
      expect(h.calls.fulfill).toBeUndefined();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('refuses non-GET/HEAD requests without any network activity', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const h = harness(async () => resp());
      await h.send('https://example.com/collect', m);
      expect(h.calls.abort, m).toBe('blockedbyclient');
      expect(h.fetched, m).toHaveLength(0);
    }
  });

  it('HEAD requests are fulfilled without a body', async () => {
    const h = harness(async () => resp());
    await h.send('https://example.com/', 'HEAD');
    expect(h.calls.fulfill!.body).toBeUndefined();
  });

  it('maps BLOCKED to blockedbyclient and every other failure to a generic failed', async () => {
    for (const [err, code] of [
      [new SafeFetchError('BLOCKED', 'x'), 'blockedbyclient'],
      [new SafeFetchError('TIMEOUT', 'x'), 'failed'],
      [new SafeFetchError('TLS', 'x'), 'failed'],
      [new Error('boom'), 'failed'],
    ] as const) {
      const h = harness(async () => { throw err; });
      await h.send('https://example.com/');
      expect(h.calls.abort).toBe(code);
    }
  });

  it('never throws even if the page/context is already closed', async () => {
    const route: RouteLike = { fulfill: async () => { throw new Error('Target closed'); }, abort: async () => { throw new Error('Target closed'); } };
    await expect(
      handleBrowserRequest({ url: () => 'https://example.com/', method: () => 'GET', headers: () => ({}) }, route, (async () => resp()) as never),
    ).resolves.toBeUndefined();
  });

  it('with the REAL default policy, internal targets are refused end to end', async () => {
    const real = createSafeFetch(); // production configuration
    const h = harness((u, o) => real(u, o as never));
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/', 'http://localhost/', 'http://[::1]/', 'file:///etc/passwd', 'http://10.0.0.1/']) {
      await h.send(url);
      expect(h.calls.abort, url).toBe('blockedbyclient');
    }
  });
});

describe('PlaywrightAxeRunner', () => {
  it('reports a missing/unlaunchable browser as BrowserUnavailableError (category becomes "unavailable")', async () => {
    const warnings: string[] = [];
    const runner = new PlaywrightAxeRunner({ executablePath: 'Z:/definitely/not/chrome.exe', fetch: createSafeFetch(), logger: { warn: (m: string) => void warnings.push(m) } as never });
    await expect(runner.run('https://example.com/', new AbortController().signal)).rejects.toBeInstanceOf(BrowserUnavailableError);
    expect(warnings[0]).toMatch(/could not launch Chromium/);
    await runner.close();
  }, 30_000);
});
