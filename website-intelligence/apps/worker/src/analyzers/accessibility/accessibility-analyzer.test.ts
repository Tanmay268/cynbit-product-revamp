import { describe, expect, it } from 'vitest';
import { byRule, makeCtx } from '../test-helpers.js';
import { createAccessibilityAnalyzer } from './accessibility-analyzer.js';
import { normalizeAxeResults } from './axe-normalize.js';
import { JsdomAxeRunner } from './jsdom-runner.js';
import { BrowserUnavailableError, PageLoadError, type AxeRunResult, type AxeRunner } from './types.js';

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessible page</title></head>
<body><a href="#main">Skip to main content</a>
<header><nav aria-label="Primary"><a href="/">Home</a> <a href="/about">About</a></nav></header>
<main id="main"><h1>Welcome</h1><h2>Contact</h2>
<form><label for="e">Email</label><input id="e" type="email"><button type="submit">Send</button></form>
<img src="/a.png" alt="A friendly team photo"></main><footer><p>Footer</p></footer></body></html>`;

const BAD = `<html><head></head><body>
<h2>Skipped the h1</h2><h4>and a level</h4>
<img src="/x.png">
<button></button>
<input type="text">
<a href="/z"></a>
<div role="banana">x</div>
<div aria-labelledby="nope">y</div>
</body></html>`;

const run = (html: string) => createAccessibilityAnalyzer(new JsdomAxeRunner(html)).run(makeCtx());

describe('accessibilityAnalyzer with the real axe engine (jsdom)', () => {
  it('finds no violations on an accessible page and scores it highly', async () => {
    const r = await run(GOOD);
    expect(r.status).toBe('completed');
    expect(r.findings.filter((f) => f.status === 'failed')).toEqual([]);
    expect(r.summary.passed).toBeGreaterThan(10);
    expect(r.score).toBeGreaterThanOrEqual(95);
  });

  it('detects missing alt text, accessible names, form labels, language, title, h1 and landmarks', async () => {
    const r = await run(BAD);
    const failedIds = r.findings.filter((f) => f.status === 'failed').map((f) => f.ruleId);
    for (const id of ['image-alt', 'button-name', 'label', 'link-name', 'html-has-lang', 'document-title', 'heading-order', 'region']) {
      expect(failedIds, `expected accessibility.${id}`).toContain(`accessibility.${id}`);
    }
    // Without layout, jsdom makes axe return the page-level heading/landmark rules as "needs review"
    // (a real browser reports them as violations). Either way the problem must surface in the report.
    const reviewIds = r.findings.filter((f) => f.status === 'warning').map((f) => f.ruleId);
    expect(reviewIds).toEqual(expect.arrayContaining(['accessibility.review.page-has-heading-one', 'accessibility.review.landmark-one-main']));
    expect(r.score!).toBeLessThan(80);
  });

  it('detects ARIA violations', async () => {
    const r = await run(BAD);
    const ids = r.findings.filter((f) => f.status === 'failed').map((f) => f.ruleId);
    expect(ids.some((id) => /aria-(roles|valid-attr-value)/.test(id))).toBe(true);
  });

  it('maps axe impact to severity and returns rule ids with DOM evidence', async () => {
    const r = await run(BAD);
    const alt = byRule(r, 'accessibility.image-alt');
    expect(alt.severity).toBe('critical'); // axe impact: critical
    expect(alt.evidence).toMatch(/<img src="\/x\.png"/); // the offending DOM node
    expect(alt.evidence).toMatch(/1 element\(s\) affected/);
    expect(alt.recommendation).toMatch(/dequeuniversity\.com/);
    expect(alt.impact).toMatch(/axe impact: critical.*WCAG 1\.1\.1/);

    const lang = byRule(r, 'accessibility.html-has-lang');
    expect(lang.severity).toBe('high'); // serious -> high
    expect(lang.impact).toMatch(/WCAG 3\.1\.1/);
  });

  it('a failing rule is never also reported as passed', async () => {
    const r = await run(BAD);
    const ids = r.findings.map((f) => f.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keyboard checks: passes with focusable controls and detects a skip link', async () => {
    const r = await run(GOOD);
    expect(byRule(r, 'accessibility.keyboard-focusable').status).toBe('passed');
    const many = '<main><h1>x</h1>' + Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('') + '</main>';
    const noSkip = await run(`<!doctype html><html lang="en"><title>t</title><body>${many}</body></html>`);
    expect(byRule(noSkip, 'accessibility.skip-link').status).toBe('warning');
    expect(byRule(r, 'accessibility.keyboard-focusable').evidence).toMatch(/interactive/);
  });
});

describe('accessibilityAnalyzer: runner outcomes', () => {
  const runner = (fn: () => Promise<AxeRunResult>): AxeRunner => ({ run: fn });
  const analyze = (fn: () => Promise<AxeRunResult>) => createAccessibilityAnalyzer(runner(fn)).run(makeCtx());

  it('a missing browser makes the category UNAVAILABLE with a null score, not failed or zero', async () => {
    const r = await analyze(async () => {
      throw new BrowserUnavailableError('The accessibility testing browser is not installed or could not start on this worker.');
    });
    expect(r).toMatchObject({ status: 'unavailable', score: null, findings: [] });
    expect(r.reason).toMatch(/not installed/);
  });

  it('a page that cannot be loaded fails the category with a safe reason', async () => {
    const r = await analyze(async () => {
      throw new PageLoadError('The page could not be loaded in the browser.');
    });
    expect(r).toMatchObject({ status: 'failed', score: null, reason: 'The page could not be loaded in the browser.' });
  });

  it('unexpected errors propagate to the orchestrator (which reports a generic failure)', async () => {
    await expect(analyze(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('caps "needs review" items and treats them as low-severity warnings', async () => {
    const inc = Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, impact: 'serious' as const, help: `Review ${i}`, description: 'd', helpUrl: '', tags: [], nodeCount: 2, nodes: [{ html: '<p>', target: ['p'] }] }));
    const r = await analyze(async () => ({ violations: [], incomplete: inc, passes: [{ id: 'ok', help: 'ok' }], keyboard: { interactiveCount: 0, tabStopsReached: 0, hasSkipLink: false } }));
    const review = r.findings.filter((f) => f.ruleId.startsWith('accessibility.review.'));
    expect(review).toHaveLength(10);
    expect(review.every((f) => f.status === 'warning' && f.severity === 'low')).toBe(true);
  });

  it('fails keyboard reachability when controls exist but Tab reaches none', async () => {
    const r = await analyze(async () => ({ violations: [], incomplete: [], passes: [{ id: 'ok', help: 'ok' }], keyboard: { interactiveCount: 5, tabStopsReached: 0, hasSkipLink: false } }));
    expect(byRule(r, 'accessibility.keyboard-focusable')).toMatchObject({ status: 'failed', severity: 'high' });
  });
});

describe('normalizeAxeResults (page content is untrusted)', () => {
  it('caps sizes, drops unexpected fields and rejects non-Deque help URLs', () => {
    const huge = 'x'.repeat(5000);
    const out = normalizeAxeResults(
      {
        violations: [
          {
            id: 'image-alt',
            impact: 'critical',
            help: huge,
            description: huge,
            helpUrl: 'https://evil.example/phish',
            tags: ['wcag111', ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
            nodes: Array.from({ length: 50 }, () => ({ html: huge, target: ['a', 'b', 'c', 'd', 'e', 'f'], failureSummary: huge })),
          },
        ],
        passes: [],
      },
      { interactiveCount: 0, tabStopsReached: 0, hasSkipLink: false },
    );
    const v = out.violations[0]!;
    expect(v.help.length).toBeLessThanOrEqual(200);
    expect(v.description.length).toBeLessThanOrEqual(400);
    expect(v.helpUrl).toBe(''); // a hostile page cannot inject a link into the report
    expect(v.tags).toHaveLength(12);
    expect(v.nodeCount).toBe(50);
    expect(v.nodes).toHaveLength(5);
    expect(v.nodes[0]!.html.length).toBeLessThanOrEqual(200);
    expect(v.nodes[0]!.target).toHaveLength(4);
  });

  it('treats unknown impacts as null', () => {
    const out = normalizeAxeResults({ violations: [{ id: 'x', impact: 'catastrophic' }] }, { interactiveCount: 0, tabStopsReached: 0, hasSkipLink: false });
    expect(out.violations[0]!.impact).toBeNull();
  });
});
