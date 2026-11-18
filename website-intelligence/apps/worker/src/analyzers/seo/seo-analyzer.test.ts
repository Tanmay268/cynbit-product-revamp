import { SafeFetchError } from '@wi/net-guard';
import { describe, expect, it } from 'vitest';
import { byRule, GOOD_PAGE, makeCtx } from '../test-helpers.js';
import { parseRobots } from './robots.js';
import { seoAnalyzer } from './seo-analyzer.js';

const okRoutes = {
  '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: Buffer.from('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml') },
  '/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: Buffer.from('<?xml version="1.0"?><urlset xmlns="x"><url><loc>https://example.com/</loc></url></urlset>') },
  '/products': { status: 200 },
  '/about': { status: 200 },
};

describe('seoAnalyzer: healthy page', () => {
  it('passes every check and scores 100', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { html: GOOD_PAGE }, routes: okRoutes }));
    expect(r.status).toBe('completed');
    expect(r.findings.filter((f) => f.status !== 'passed')).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.summary.failed).toBe(0);
  });

  it('samples internal links with HEAD requests and only on the same host', async () => {
    const ctx = makeCtx({
      page: { html: GOOD_PAGE.replace('</body>', '<a href="https://other.com/x">x</a></body>') },
      routes: okRoutes,
    });
    await seoAnalyzer.run(ctx);
    expect(ctx.requests).toContain('HEAD https://example.com/products');
    expect(ctx.requests.some((q) => q.includes('other.com'))).toBe(false);
  });
});

describe('seoAnalyzer: problems', () => {
  it('flags missing title, description, h1, canonical, lang, viewport, OG and alt text', async () => {
    const html = '<html><head></head><body><h2>x</h2><img src="a.png"></body></html>';
    const r = await seoAnalyzer.run(makeCtx({ page: { html }, routes: {} }));
    for (const id of ['seo.title', 'seo.meta-description', 'seo.h1', 'seo.canonical', 'seo.html-lang', 'seo.viewport', 'seo.open-graph', 'seo.image-alt']) {
      expect(byRule(r, id).status, id).toBe('failed');
    }
    expect(byRule(r, 'seo.image-alt').evidence).toMatch(/a\.png/);
    expect(r.score).toBeLessThan(50); // still gets credit for status/indexability, but clearly poor
  });

  it('warns about out-of-range title/description lengths and multiple H1s', async () => {
    const html = `<html lang="en"><head><title>Hi</title><meta name="description" content="short"></head><body><h1>A</h1><h1>B</h1></body></html>`;
    const r = await seoAnalyzer.run(makeCtx({ page: { html } }));
    expect(byRule(r, 'seo.title').status).toBe('warning');
    expect(byRule(r, 'seo.meta-description').status).toBe('warning');
    expect(byRule(r, 'seo.h1').status).toBe('warning');
  });

  it('detects skipped heading levels', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { html: '<html><body><h1>a</h1><h4>b</h4></body></html>' } }));
    const f = byRule(r, 'seo.heading-hierarchy');
    expect(f.status).toBe('failed');
    expect(f.evidence).toContain('h1 -> h4');
  });

  it('treats noindex (meta or header) as a critical indexability failure', async () => {
    const meta = await seoAnalyzer.run(makeCtx({ page: { html: '<html><head><meta name="robots" content="noindex, nofollow"></head></html>' } }));
    expect(byRule(meta, 'seo.indexability')).toMatchObject({ status: 'failed', severity: 'critical' });
    const hdr = await seoAnalyzer.run(makeCtx({ page: { html: GOOD_PAGE, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } } }));
    expect(byRule(hdr, 'seo.indexability').status).toBe('failed');
  });

  it('flags a canonical that points to another host', async () => {
    const html = '<html><head><link rel="canonical" href="https://elsewhere.com/"></head></html>';
    const r = await seoAnalyzer.run(makeCtx({ page: { html } }));
    expect(byRule(r, 'seo.canonical').status).toBe('warning');
  });

  it('flags generic/empty anchor text', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { html: '<html><body><a href="/a">click here</a><a href="/b"></a></body></html>' }, routes: { '/a': {}, '/b': {} } }));
    expect(byRule(r, 'seo.anchor-text').status).toBe('failed');
  });

  it('reports broken internal links with their status codes', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { html: GOOD_PAGE }, routes: { ...okRoutes, '/products': { status: 404 } } }));
    const f = byRule(r, 'seo.broken-links');
    expect(f.status).toBe('failed');
    expect(f.evidence).toMatch(/products -> 404/);
  });

  it('falls back to GET when a server rejects HEAD', async () => {
    const ctx = makeCtx({
      page: { html: GOOD_PAGE },
      routes: { ...okRoutes, 'HEAD /products': { status: 405 }, 'GET /products': { status: 200 } },
    });
    const r = await seoAnalyzer.run(ctx);
    expect(byRule(r, 'seo.broken-links').status).toBe('passed');
    expect(ctx.requests).toContain('GET https://example.com/products');
  });

  it('treats unreachable links as a warning, not a confirmed break', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { html: GOOD_PAGE }, routes: { ...okRoutes, '/products': new SafeFetchError('TIMEOUT', 'slow') } }));
    expect(byRule(r, 'seo.broken-links').status).toBe('warning');
  });
});

describe('seoAnalyzer: robots.txt and sitemap', () => {
  it('flags a robots.txt that blocks the whole site as critical', async () => {
    const routes = { ...okRoutes, '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: Buffer.from('User-agent: *\nDisallow: /') } };
    const r = await seoAnalyzer.run(makeCtx({ page: { html: GOOD_PAGE }, routes }));
    expect(byRule(r, 'seo.robots-blocks-all')).toMatchObject({ status: 'failed', severity: 'critical' });
  });

  it('warns when robots.txt or the sitemap are missing, and rejects HTML soft-404s', async () => {
    const r = await seoAnalyzer.run(
      makeCtx({ page: { html: GOOD_PAGE }, routes: { '/products': {}, '/about': {}, '/robots.txt': { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>home</html>') } } }),
    );
    expect(byRule(r, 'seo.robots-txt').status).toBe('warning');
    expect(byRule(r, 'seo.sitemap').status).toBe('failed');
  });

  it('follows the Sitemap: directive from robots.txt', async () => {
    const ctx = makeCtx({
      page: { html: GOOD_PAGE },
      routes: {
        ...okRoutes,
        '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: Buffer.from('Sitemap: https://example.com/custom-map.xml') },
        '/custom-map.xml': { body: Buffer.from('<sitemapindex xmlns="x"></sitemapindex>') },
      },
    });
    const r = await seoAnalyzer.run(ctx);
    expect(byRule(r, 'seo.sitemap').status).toBe('passed');
    expect(ctx.requests).toContain('GET https://example.com/custom-map.xml');
  });
});

describe('seoAnalyzer: error pages', () => {
  it('only reports the HTTP status for non-2xx responses', async () => {
    const r = await seoAnalyzer.run(makeCtx({ page: { status: 500, html: '<html></html>' } }));
    expect(r.findings).toHaveLength(1);
    expect(byRule(r, 'seo.http-status')).toMatchObject({ status: 'failed', severity: 'critical' });
    expect(r.score).toBe(0);
  });

  it('propagates fetch failures so the orchestrator marks the category failed with the safe message', async () => {
    const err = new SafeFetchError('TIMEOUT', 'The website took too long to respond.');
    await expect(seoAnalyzer.run(makeCtx({ pageError: err }))).rejects.toBe(err);
  });
});

describe('parseRobots', () => {
  it('handles groups, comments, CRLF and multiple agents', () => {
    expect(parseRobots('# c\r\nUser-agent: Googlebot\r\nUser-agent: *\r\nDisallow: /private\r\n\r\nUser-agent: bad\r\nDisallow: /\r\nSitemap: https://x.com/s.xml').blocksAll).toBe(false);
    expect(parseRobots('User-agent: *\nDisallow: /').blocksAll).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /\nAllow: /').blocksAll).toBe(false);
    expect(parseRobots('User-agent: *\nDisallow:').blocksAll).toBe(false);
    expect(parseRobots('Sitemap: https://x.com/a.xml\nSitemap: /relative.xml').sitemaps).toEqual(['https://x.com/a.xml']);
  });
});
