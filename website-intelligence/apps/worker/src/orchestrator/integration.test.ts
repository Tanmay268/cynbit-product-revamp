import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSafeFetch, isBlockedIp } from '@wi/net-guard';
import { AUDIT_CATEGORIES } from '@wi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JsdomAxeRunner } from '../analyzers/accessibility/jsdom-runner.js';
import { createAnalyzers } from '../analyzers/registry.js';
import type { PageSpeedOutcome } from '../analyzers/types.js';
import { runAudit } from './run-audit.js';
import { InMemoryAuditStore, silentLogger } from './test-helpers.js';

/**
 * End-to-end: the real orchestrator + all five REAL analyzers + the real safeFetch, against a local web server.
 * Only the externals are substituted: Chromium -> jsdom running real axe, Google PSI -> a fixture.
 */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Integration Test Site | Widgets</title>
<meta name="description" content="A small test website used to verify the full website audit pipeline end to end, from fetching to scoring.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/">
<link rel="stylesheet" href="/app.css"></head>
<body><header><nav aria-label="Main"><a href="/about">About us</a></nav></header>
<main><h1>Widgets</h1><h2>Why us</h2><img src="/logo.png" alt="Logo" width="10" height="10"></main><footer>f</footer></body></html>`;

const hits: Record<string, number> = {};
let server: http.Server;
let origin = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = req.url ?? '/';
    hits[p] = (hits[p] ?? 0) + 1;
    const cache = { 'cache-control': 'public, max-age=31536000, immutable' };
    if (p === '/') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: '"1"', 'x-content-type-options': 'nosniff' }).end(PAGE);
    else if (p === '/about') res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
    else if (p === '/app.css') res.writeHead(200, { 'content-type': 'text/css', ...cache }).end('body{margin:0}');
    else if (p === '/logo.png') res.writeHead(200, { 'content-type': 'image/png', ...cache }).end(Buffer.alloc(200));
    else if (p === '/robots.txt') res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n');
    else if (p === '/sitemap.xml') res.writeHead(200, { 'content-type': 'application/xml' }).end('<?xml version="1.0"?><urlset xmlns="x"></urlset>');
    else if (p === '/broken') res.writeHead(500).end('x');
    else res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://site.example:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const relaxed = { lookup: async () => [{ address: '127.0.0.1', family: 4 }], isBlockedIp: (ip: string) => ip !== '127.0.0.1' && isBlockedIp(ip), allowedPorts: null } as const;

const pagespeed = async (): Promise<PageSpeedOutcome> => ({
  ok: true,
  data: {
    lighthouseResult: {
      categories: { performance: { score: 0.88 }, 'best-practices': { score: 0.9 } },
      audits: {
        'first-contentful-paint': { id: 'fcp', title: 'FCP', score: 1, numericValue: 1000 },
        'largest-contentful-paint': { id: 'lcp', title: 'LCP', score: 1, numericValue: 2100 },
        'cumulative-layout-shift': { id: 'cls', title: 'CLS', score: 1, numericValue: 0.01 },
        'speed-index': { id: 'si', title: 'SI', score: 1, numericValue: 2000 },
        'total-blocking-time': { id: 'tbt', title: 'TBT', score: 1, numericValue: 90 },
      },
    },
  },
});

function deps(store: InMemoryAuditStore, over: Partial<Parameters<typeof runAudit>[1]> = {}) {
  const safeFetch = createSafeFetch(relaxed);
  return {
    store,
    analyzers: createAnalyzers({ axeRunner: new JsdomAxeRunner(PAGE) }),
    fetch: safeFetch,
    pagespeed,
    analyzerTimeoutMs: 15_000,
    resolveHost: async () => ['127.0.0.1'],
    normalizeOptions: { allowedPorts: null, isBlockedIp: relaxed.isBlockedIp },
    logger: silentLogger,
    ...over,
  };
}

describe('full audit pipeline against a real local site', () => {
  it('completes all five categories with real findings and a weighted overall score', async () => {
    for (const k of Object.keys(hits)) delete hits[k];
    const store = new InMemoryAuditStore({ targetUrl: origin });

    const out = await runAudit('audit-1', deps(store));

    expect(out!.status).toBe('completed');
    expect([...store.results.keys()].sort()).toEqual([...AUDIT_CATEGORIES].sort());
    for (const category of AUDIT_CATEGORIES) {
      const r = store.results.get(category)!;
      expect(r.status, `${category}: ${r.reason}`).toBe('completed');
      expect(r.score, category).toBeGreaterThan(0);
      expect(r.findings.length, category).toBeGreaterThan(3);
      expect(r.summary.passed + r.summary.failed + r.summary.warnings).toBe(r.findings.length);
    }
    expect(store.results.get('performance')!.score).toBe(88); // Lighthouse score passed through
    expect(store.results.get('seo')!.score).toBeGreaterThan(85);
    expect(out!.overallScore).toBeGreaterThan(50);
    expect(store.audit.status).toBe('completed');
  });

  it('fetches the home page ONCE even though SEO, Security and Best Practices all need it', async () => {
    for (const k of Object.keys(hits)) delete hits[k];
    await runAudit('audit-1', deps(new InMemoryAuditStore({ targetUrl: origin })));
    expect(hits['/']).toBe(1);
  });

  it('reports real problems found on the site (broken link, plain HTTP)', async () => {
    const store = new InMemoryAuditStore({ targetUrl: origin });
    // Same site but with a broken internal link
    const broken = PAGE.replace('</nav>', '<a href="/broken">Broken page</a></nav>');
    const bad = http.createServer((_req, res) => {
      const p = _req.url ?? '/';
      if (p === '/') res.writeHead(200, { 'content-type': 'text/html' }).end(broken);
      else if (p === '/broken') res.writeHead(500).end('x');
      else res.writeHead(404).end('n');
    });
    await new Promise<void>((r) => bad.listen(0, '127.0.0.1', r));
    const target = `http://site.example:${(bad.address() as AddressInfo).port}`;
    try {
      await runAudit('audit-1', deps(new InMemoryAuditStore({ targetUrl: target }), { store: Object.assign(store, { audit: { ...store.audit, targetUrl: target } }) }));
      const seo = store.results.get('seo')!;
      expect(seo.findings.find((f) => f.ruleId === 'seo.broken-links')).toMatchObject({ status: 'failed' });
      const sec = store.results.get('security')!;
      expect(sec.findings.find((f) => f.ruleId === 'security.https')).toMatchObject({ status: 'failed', severity: 'critical' });
    } finally {
      bad.closeAllConnections();
      bad.close();
    }
  });

  it('without a PageSpeed key: performance is UNAVAILABLE, the rest still complete, overall excludes it', async () => {
    const store = new InMemoryAuditStore({ targetUrl: origin });
    const out = await runAudit('audit-1', deps(store, { pagespeed: undefined }));

    expect(store.results.get('performance')).toMatchObject({ status: 'unavailable', score: null });
    expect(store.results.get('best-practices')!.status).toBe('completed'); // works without Lighthouse data
    expect(out!.status).toBe('partial');
    expect(out!.overallScore).not.toBeNull();
  });

  it('an unreachable site fails SEO/Security/Best Practices with a safe reason, while a browser outage only affects accessibility', async () => {
    const { BrowserUnavailableError } = await import('../analyzers/accessibility/types.js');
    const store = new InMemoryAuditStore({ targetUrl: 'http://site.example:1' }); // nothing listens on port 1
    const axeRunner = { run: async () => { throw new BrowserUnavailableError('Browser not installed.'); } };
    const out = await runAudit('audit-1', deps(store, { analyzers: createAnalyzers({ axeRunner }) }));

    for (const c of ['seo', 'security', 'best-practices'] as const) {
      expect(store.results.get(c), c).toMatchObject({ status: 'failed', score: null, reason: 'Could not connect to the website.' });
    }
    expect(store.results.get('accessibility')).toMatchObject({ status: 'unavailable', reason: 'Browser not installed.' });
    expect(out!.status).toBe('partial'); // performance (fixture) still completed
  });
});
