import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessibilityAnalyzer } from '../analyzers/accessibility/accessibility-analyzer.js';
import { makeCtx } from '../analyzers/test-helpers.js';
import { createSafeFetch, isBlockedIp } from '@wi/net-guard';
import { PlaywrightAxeRunner } from './browser.js';

/**
 * REAL-BROWSER tests. Opt-in because they need a Chromium/Chrome binary:
 *   WI_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm test -w @wi/worker
 * (or `npx playwright-core install chromium` and set the path to it). Skipped otherwise.
 */
const CHROME = process.env.WI_CHROME_PATH;

describe.runIf(CHROME)('PlaywrightAxeRunner with a real browser', () => {
  const secretHits: string[] = [];
  let site: http.Server;
  let internal: http.Server;
  let siteOrigin = '';
  let internalOrigin = '';

  beforeAll(async () => {
    // "Internal" server on a different loopback address: must never be contacted by the browser.
    internal = http.createServer((req, res) => {
      secretHits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(10));
    });
    await new Promise<void>((r) => internal.listen(0, '127.0.0.2', r));
    internalOrigin = `http://127.0.0.2:${(internal.address() as AddressInfo).port}`;

    site = http.createServer((req, res) => {
      if (req.url === '/redirect') return void res.writeHead(302, { location: `${internalOrigin}/via-redirect.png` }).end();
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html lang="en"><head><title>Contrast test</title></head><body>
        <main><h1>Heading</h1>
        <p style="color:#aaaaaa;background:#ffffff">Light grey text that fails WCAG contrast</p>
        <a href="/a">One</a> <a href="/b">Two</a>
        <img src="${internalOrigin}/probe.png" alt="internal probe" width="5" height="5">
        <script>fetch(${JSON.stringify(internalOrigin)} + '/xhr-probe').catch(() => {});</script>
        <iframe src="${internalOrigin}/frame" title="f"></iframe>
        </main></body></html>`);
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
    siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    for (const s of [site, internal]) {
      s?.closeAllConnections();
      s?.close();
    }
  });

  // Test policy: ONLY 127.0.0.1 (the test site) is reachable and any port is allowed; everything else
  // (including 127.0.0.2, where the "internal" server lives) is blocked by the real deny-list.
  const testFetch = () => createSafeFetch({ isBlockedIp: (ip) => ip !== '127.0.0.1' && isBlockedIp(ip), allowedPorts: null });
  const runner = () => new PlaywrightAxeRunner({ executablePath: CHROME, fetch: testFetch(), logger: { warn: () => undefined } as never });

  it('runs axe in a real browser: finds colour-contrast (needs layout) and probes keyboard focus', async () => {
    const r = runner();
    try {
      const out = await createAccessibilityAnalyzer(r).run({ ...makeCtx(), url: `${siteOrigin}/` });
      expect(out.status).toBe('completed');
      const failed = out.findings.filter((f) => f.status === 'failed').map((f) => f.ruleId);
      expect(failed).toContain('accessibility.color-contrast');
      const kb = out.findings.find((f) => f.ruleId === 'accessibility.keyboard-focusable');
      expect(kb?.status).toBe('passed');
    } finally {
      await r.close();
    }
  }, 60_000);

  it('blocks the browser from reaching internal addresses (img, fetch, iframe, redirect)', async () => {
    const r = runner();
    try {
      await r.run(`${siteOrigin}/`, new AbortController().signal);
      expect(secretHits).toEqual([]); // zero requests ever reached the internal server
      await r.run(`${siteOrigin}/redirect`, new AbortController().signal).catch(() => undefined); // redirect to internal target
      expect(secretHits).toEqual([]);
    } finally {
      await r.close();
    }
  }, 60_000);

  it('aborting the analyzer closes the browser context promptly', async () => {
    const r = runner();
    const ac = new AbortController();
    const started = Date.now();
    const p = r.run(`${siteOrigin}/`, ac.signal).catch((e: Error) => e);
    setTimeout(() => ac.abort(), 50);
    await p;
    expect(Date.now() - started).toBeLessThan(15_000);
    await r.close();
  }, 60_000);
});
