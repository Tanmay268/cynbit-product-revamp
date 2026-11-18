import { SafeFetchError } from '@wi/net-guard';
import { describe, expect, it } from 'vitest';
import { byRule, makeCtx } from '../test-helpers.js';
import type { PageSpeedOutcome } from '../types.js';
import { bestPracticesAnalyzer } from './best-practices-analyzer.js';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title>
<link rel="stylesheet" href="/app.css"><script src="/app.js"></script></head>
<body><img src="/hero.webp" width="800" height="400" alt="h"></body></html>`;

const long = { 'cache-control': 'public, max-age=31536000, immutable' };
const goodAssets = {
  '/app.css': { headers: { 'content-type': 'text/css', 'content-length': '5000', 'content-encoding': 'br', ...long } },
  '/app.js': { headers: { 'content-type': 'application/javascript', 'content-length': '40000', 'content-encoding': 'gzip', ...long } },
  '/hero.webp': { headers: { 'content-type': 'image/webp', 'content-length': '90000', ...long } },
};
const pageHeaders = { 'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'content-encoding': 'br' };

describe('bestPracticesAnalyzer: healthy page', () => {
  it('passes all checks', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders }, routes: goodAssets }));
    const bad = r.findings.filter((f) => f.status !== 'passed' && f.severity !== 'info');
    expect(bad).toEqual([]);
    expect(r.score).toBe(100);
  });
});

describe('bestPracticesAnalyzer: mixed content', () => {
  it('flags active insecure resources as failed, passive as warning', async () => {
    const active = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE.replace('/app.js', 'http://cdn.example.org/lib.js'), headers: pageHeaders }, routes: goodAssets }));
    expect(byRule(active, 'best-practices.mixed-content')).toMatchObject({ status: 'failed', severity: 'high' });
    expect(byRule(active, 'best-practices.mixed-content').evidence).toMatch(/lib\.js/);

    const passive = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE.replace('/hero.webp', 'http://img.example.org/a.png'), headers: pageHeaders }, routes: goodAssets }));
    expect(byRule(passive, 'best-practices.mixed-content').status).toBe('warning');
  });

  it('does not check mixed content on plain-HTTP pages', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ url: 'http://example.com/', page: { url: 'http://example.com/', html: PAGE.replace('/app.js', 'http://x.com/a.js'), headers: pageHeaders }, routes: goodAssets }));
    expect(r.findings.some((f) => f.ruleId === 'best-practices.mixed-content')).toBe(false);
  });
});

describe('bestPracticesAnalyzer: resources', () => {
  it('reports broken resources with status codes', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders }, routes: { ...goodAssets, '/app.js': { status: 404 } } }));
    const f = byRule(r, 'best-practices.broken-resources');
    expect(f.status).toBe('failed');
    expect(f.evidence).toMatch(/app\.js → 404/);
  });

  it('flags missing/short caching for same-origin assets only', async () => {
    const html = PAGE.replace('</body>', '<script src="https://cdn.other.com/x.js"></script></body>');
    const r = await bestPracticesAnalyzer.run(
      makeCtx({
        page: { html, headers: pageHeaders },
        routes: {
          ...goodAssets,
          '/app.css': { headers: { ...goodAssets['/app.css'].headers, 'cache-control': 'max-age=60' } },
          'https://cdn.other.com/x.js': { headers: { 'content-type': 'text/javascript' } }, // no caching, but third-party
        },
      }),
    );
    const f = byRule(r, 'best-practices.static-caching');
    expect(f.status).toBe('warning');
    expect(f.evidence).toMatch(/1 of 3 same-origin/);
    expect(f.evidence).not.toMatch(/cdn\.other\.com/);
  });

  it('treats no-store/no-cache as not cacheable', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders }, routes: { ...goodAssets, '/app.js': { headers: { ...goodAssets['/app.js'].headers, 'cache-control': 'no-cache, max-age=31536000' } } } }));
    expect(byRule(r, 'best-practices.static-caching').status).toBe('warning');
  });

  it('flags uncompressed text assets, oversize resources and legacy large images', async () => {
    const r = await bestPracticesAnalyzer.run(
      makeCtx({
        page: { html: PAGE.replace('hero.webp', 'hero.png'), headers: pageHeaders },
        routes: {
          '/app.css': { headers: { 'content-type': 'text/css', 'content-length': '50000', ...long } }, // uncompressed
          '/app.js': { headers: { 'content-type': 'application/javascript', 'content-length': '3000000', 'content-encoding': 'gzip', ...long } }, // 3 MB
          '/hero.png': { headers: { 'content-type': 'image/png', 'content-length': '300000', ...long } }, // legacy, 293 KB
        },
      }),
    );
    expect(byRule(r, 'best-practices.compression').status).toBe('warning');
    expect(byRule(r, 'best-practices.resource-size').status).toBe('failed');
    expect(byRule(r, 'best-practices.resource-size').evidence).toMatch(/app\.js/);
    expect(byRule(r, 'best-practices.image-formats').status).toBe('warning');
  });

  it('uses a GET fallback when HEAD is not allowed and survives unreachable assets', async () => {
    const ctx = makeCtx({ page: { html: PAGE, headers: pageHeaders }, routes: { ...goodAssets, 'HEAD /app.js': { status: 405 }, 'GET /app.js': goodAssets['/app.js'], '/hero.webp': new SafeFetchError('TIMEOUT', 'slow') } });
    const r = await bestPracticesAnalyzer.run(ctx);
    expect(ctx.requests).toContain('GET https://example.com/app.js');
    expect(byRule(r, 'best-practices.broken-resources').status).toBe('warning');
  });

  it('never fetches data: URIs or follows non-http schemes', async () => {
    const ctx = makeCtx({ page: { html: '<!doctype html><img src="data:image/png;base64,AAAA"><script src="javascript:alert(1)"></script>', headers: pageHeaders } });
    await bestPracticesAnalyzer.run(ctx);
    expect(ctx.requests).toEqual([]);
  });

  it('caps the number of probed resources', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `<img src="/i${i}.webp" width="1" height="1">`).join('');
    const ctx = makeCtx({ page: { html: `<!doctype html><html><meta charset=utf-8>${many}`, headers: pageHeaders } });
    await bestPracticesAnalyzer.run(ctx);
    expect(ctx.requests.length).toBeLessThanOrEqual(12);
  });
});

describe('bestPracticesAnalyzer: document', () => {
  it('flags missing doctype, charset, image dimensions and cache validators', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: '<html><body><img src="a.webp"></body></html>', headers: { 'content-type': 'text/html' } }, routes: { '/a.webp': {} } }));
    expect(byRule(r, 'best-practices.doctype').status).toBe('failed');
    expect(byRule(r, 'best-practices.charset').status).toBe('failed');
    expect(byRule(r, 'best-practices.image-dimensions').status).toBe('failed');
    expect(byRule(r, 'best-practices.document-caching').status).toBe('failed');
  });

  it('accepts a doctype preceded by a comment or BOM', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: '﻿<!-- hi --><!DOCTYPE html><html></html>', headers: pageHeaders } }));
    expect(byRule(r, 'best-practices.doctype').status).toBe('passed');
  });

  it('warns about long redirect chains, but not short ones', async () => {
    const hop = (n: number) => Array.from({ length: n }, (_, i) => ({ from: `https://a/${i}`, to: `https://a/${i + 1}`, status: 301 }));
    const long = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders, redirects: hop(3) }, routes: goodAssets }));
    expect(byRule(long, 'best-practices.redirects').status).toBe('warning');
    const short = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders, redirects: hop(1) }, routes: goodAssets }));
    expect(byRule(short, 'best-practices.redirects').status).toBe('passed');
  });

  it('flags uncompressed HTML and truncated documents', async () => {
    const big = `<!doctype html><meta charset=utf-8>${'x'.repeat(5000)}`;
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: big, headers: { 'content-type': 'text/html', etag: 'x' }, truncated: true } }));
    expect(byRule(r, 'best-practices.compression').status).toBe('failed');
    expect(byRule(r, 'best-practices.document-size').status).toBe('failed');
  });
});

describe('bestPracticesAnalyzer: Lighthouse insights (shared, no duplicates)', () => {
  const lh = (audits: Record<string, object>): PageSpeedOutcome => ({
    ok: true,
    data: { lighthouseResult: { categories: { performance: { score: 1 } }, audits: audits as never } },
  });

  it('adopts selected Lighthouse audits and skips ones our analyzers already cover', async () => {
    const r = await bestPracticesAnalyzer.run(
      makeCtx({
        page: { html: PAGE, headers: pageHeaders },
        routes: goodAssets,
        pagespeed: lh({
          'errors-in-console': { id: 'errors-in-console', title: 'Browser errors were logged to the console', score: 0, scoreDisplayMode: 'binary', displayValue: '3 errors' },
          deprecations: { id: 'deprecations', title: 'Avoids deprecated APIs', score: 1, scoreDisplayMode: 'binary' },
          'is-on-https': { id: 'is-on-https', title: 'Uses HTTPS', score: 0, scoreDisplayMode: 'binary' }, // duplicate of Security: skipped
          doctype: { id: 'doctype', title: 'Doctype', score: 0, scoreDisplayMode: 'binary' }, // duplicate of ours: skipped
          'image-aspect-ratio': { id: 'image-aspect-ratio', title: 'Aspect ratio', score: null, scoreDisplayMode: 'notApplicable' },
        }),
      }),
    );
    expect(byRule(r, 'best-practices.lighthouse.errors-in-console')).toMatchObject({ status: 'failed', evidence: '3 errors' });
    expect(byRule(r, 'best-practices.lighthouse.deprecations').status).toBe('passed');
    for (const dup of ['is-on-https', 'doctype', 'image-aspect-ratio']) expect(r.findings.some((f) => f.ruleId.endsWith(`.${dup}`) && f.ruleId.includes('lighthouse'))).toBe(false);
    expect(r.findings.filter((f) => f.ruleId === 'best-practices.doctype')).toHaveLength(1);
  });

  it('notes (informationally) when Lighthouse data is unavailable, without affecting the score', async () => {
    const r = await bestPracticesAnalyzer.run(makeCtx({ page: { html: PAGE, headers: pageHeaders }, routes: goodAssets }));
    const f = byRule(r, 'best-practices.lighthouse-unavailable');
    expect(f).toMatchObject({ severity: 'info', status: 'warning' });
    expect(r.score).toBe(100);
  });
});
