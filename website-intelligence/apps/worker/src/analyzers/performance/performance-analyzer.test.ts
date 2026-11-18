import { describe, expect, it } from 'vitest';
import type { PageSpeedData, PageSpeedOutcome } from '../types.js';
import { byRule, makeCtx } from '../test-helpers.js';
import { performanceAnalyzer } from './performance-analyzer.js';

const audit = (id: string, numericValue: number, extra: object = {}) => ({ id, title: id, score: 0.5, numericValue, ...extra });

function ps(over: { perf?: number | null; audits?: Record<string, unknown>; field?: PageSpeedData['loadingExperience'] } = {}): PageSpeedOutcome {
  return {
    ok: true,
    data: {
      lighthouseResult: {
        categories: { performance: { score: over.perf === undefined ? 0.92 : over.perf } },
        audits: (over.audits ?? {
          'first-contentful-paint': audit('first-contentful-paint', 1200),
          'largest-contentful-paint': audit('largest-contentful-paint', 2000),
          'cumulative-layout-shift': audit('cumulative-layout-shift', 0.02),
          'speed-index': audit('speed-index', 2500),
          'total-blocking-time': audit('total-blocking-time', 100),
        }) as PageSpeedData['lighthouseResult']['audits'],
      },
      loadingExperience: over.field,
    },
  };
}

describe('performanceAnalyzer: unavailable is not zero', () => {
  it.each([
    ['missing-key', 'unavailable'],
    ['invalid-key', 'unavailable'],
    ['rate-limited', 'unavailable'],
    ['timeout', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['target-failed', 'unavailable'],
    ['bad-response', 'failed'],
  ] as const)('%s -> %s with a null score and the safe reason', async (reason, status) => {
    const r = await performanceAnalyzer.run(makeCtx({ pagespeed: { ok: false, reason, message: `msg for ${reason}` } }));
    expect(r.status).toBe(status);
    expect(r.score).toBeNull();
    expect(r.findings).toEqual([]);
    expect(r.reason).toBe(`msg for ${reason}`);
  });

  it('is unavailable when PSI returns no performance score', async () => {
    const r = await performanceAnalyzer.run(makeCtx({ pagespeed: ps({ perf: null }) }));
    expect(r.status).toBe('unavailable');
  });
});

describe('performanceAnalyzer: metrics', () => {
  it('passes the Lighthouse score through unchanged and rates good metrics as passed', async () => {
    const r = await performanceAnalyzer.run(makeCtx({ pagespeed: ps() }));
    expect(r.status).toBe('completed');
    expect(r.score).toBe(92);
    for (const k of ['fcp', 'lcp', 'cls', 'si', 'tbt']) expect(byRule(r, `performance.${k}`).status, k).toBe('passed');
    expect(byRule(r, 'performance.lcp').evidence).toMatch(/2\.0 s, good \(lab data/);
  });

  it('rates needs-improvement as warning and poor as failed with the metric severity', async () => {
    const r = await performanceAnalyzer.run(
      makeCtx({
        pagespeed: ps({
          perf: 0.3,
          audits: {
            'first-contentful-paint': audit('first-contentful-paint', 2400), // warning
            'largest-contentful-paint': audit('largest-contentful-paint', 6000), // poor
            'cumulative-layout-shift': audit('cumulative-layout-shift', 0.4), // poor
            'speed-index': audit('speed-index', 3400), // boundary = good
            'total-blocking-time': audit('total-blocking-time', 900), // poor
          },
        }),
      }),
    );
    expect(byRule(r, 'performance.fcp').status).toBe('warning');
    expect(byRule(r, 'performance.lcp')).toMatchObject({ status: 'failed', severity: 'high' });
    expect(byRule(r, 'performance.cls')).toMatchObject({ status: 'failed', severity: 'high' });
    expect(byRule(r, 'performance.si').status).toBe('passed');
    expect(r.score).toBe(30);
  });

  it('uses real-user INP when available and otherwise reports it as not measured (never invents it)', async () => {
    const withField = await performanceAnalyzer.run(makeCtx({ pagespeed: ps({ field: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 640, category: 'SLOW' } } } }) }));
    expect(byRule(withField, 'performance.inp')).toMatchObject({ status: 'failed' });
    expect(byRule(withField, 'performance.inp').evidence).toMatch(/real-user/);

    const without = await performanceAnalyzer.run(makeCtx({ pagespeed: ps() }));
    expect(without.findings.find((f) => f.ruleId === 'performance.inp')).toBeUndefined();
    expect(byRule(without, 'performance.metrics-unavailable').evidence).toMatch(/Interaction to Next Paint/);
  });

  it('skips metrics Lighthouse did not return instead of defaulting them', async () => {
    const r = await performanceAnalyzer.run(makeCtx({ pagespeed: ps({ audits: { 'speed-index': audit('speed-index', 1000) } }) }));
    expect(r.findings.some((f) => f.ruleId === 'performance.lcp')).toBe(false);
    expect(byRule(r, 'performance.metrics-unavailable').evidence).toMatch(/Largest Contentful Paint/);
  });

  it('adds the biggest Lighthouse opportunities with estimated savings', async () => {
    const r = await performanceAnalyzer.run(
      makeCtx({
        pagespeed: ps({
          audits: {
            'speed-index': audit('speed-index', 1000),
            'render-blocking-resources': { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', description: 'Resources are [blocking](https://x) the first paint.', score: 0.2, details: { type: 'opportunity', overallSavingsMs: 1500 } },
            'tiny-win': { id: 'tiny-win', title: 'Tiny', score: 0.5, details: { type: 'opportunity', overallSavingsMs: 50 } },
            'already-good': { id: 'already-good', title: 'Good', score: 1, details: { type: 'opportunity', overallSavingsMs: 900 } },
          },
        }),
      }),
    );
    const opp = byRule(r, 'performance.opportunity.render-blocking-resources');
    expect(opp).toMatchObject({ status: 'failed', severity: 'high' });
    expect(opp.description).toBe('Resources are blocking the first paint.'); // markdown links stripped
    expect(opp.impact).toMatch(/1500 ms/);
    expect(r.findings.some((f) => f.ruleId.includes('tiny-win') || f.ruleId.includes('already-good'))).toBe(false);
  });
});
