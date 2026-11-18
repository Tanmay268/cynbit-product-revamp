import { describe, expect, it } from 'vitest';
import { computeCategoryScore, computeOverallScore, summarizeFindings } from './scoring.js';
import type { Finding } from './types/index.js';

const f = (severity: Finding['severity'], status: Finding['status']) => ({ severity, status });

describe('computeCategoryScore', () => {
  it('is 100 when everything passes', () => {
    expect(computeCategoryScore([f('critical', 'passed'), f('low', 'passed')])).toBe(100);
  });

  it('is 0 when everything scorable fails', () => {
    expect(computeCategoryScore([f('critical', 'failed'), f('high', 'failed')])).toBe(0);
  });

  it('weights by severity: failing a critical hurts more than failing a low', () => {
    const critical = computeCategoryScore([f('critical', 'failed'), f('low', 'passed')]);
    const low = computeCategoryScore([f('critical', 'passed'), f('low', 'failed')]);
    expect(critical).toBe(9); // 1 / 11
    expect(low).toBe(91); // 10 / 11
  });

  it('gives half credit for warnings', () => {
    expect(computeCategoryScore([f('medium', 'warning')])).toBe(50);
  });

  it('ignores informational findings', () => {
    expect(computeCategoryScore([f('info', 'failed'), f('high', 'passed')])).toBe(100);
  });

  it('returns null (not 0 or 100) when nothing is scorable', () => {
    expect(computeCategoryScore([])).toBeNull();
    expect(computeCategoryScore([f('info', 'passed')])).toBeNull();
  });
});

describe('summarizeFindings', () => {
  it('counts by status', () => {
    expect(summarizeFindings([f('low', 'passed'), f('low', 'failed'), f('low', 'warning'), f('low', 'passed')])).toEqual({
      passed: 2,
      failed: 1,
      warnings: 1,
    });
  });
});

describe('computeOverallScore', () => {
  it('uses the documented weights when all categories completed', () => {
    const r = computeOverallScore([
      { category: 'performance', status: 'completed', score: 80 }, // .25
      { category: 'seo', status: 'completed', score: 100 }, // .20
      { category: 'accessibility', status: 'completed', score: 60 }, // .20
      { category: 'security', status: 'completed', score: 40 }, // .20
      { category: 'best-practices', status: 'completed', score: 100 }, // .15
    ]);
    // 20 + 20 + 12 + 8 + 15 = 75
    expect(r.score).toBe(75);
    expect(r.includedCategories).toHaveLength(5);
  });

  it('re-normalises over available categories instead of treating them as zero', () => {
    const r = computeOverallScore([
      { category: 'performance', status: 'unavailable', score: null },
      { category: 'seo', status: 'completed', score: 90 },
      { category: 'security', status: 'failed', score: null },
    ]);
    expect(r.score).toBe(90);
    expect(r.includedCategories).toEqual(['seo']);
  });

  it('is null when no category produced a score', () => {
    expect(computeOverallScore([{ category: 'seo', status: 'failed', score: null }])).toEqual({
      score: null,
      includedCategories: [],
    });
  });

  it('ignores a score attached to a non-completed category', () => {
    expect(computeOverallScore([{ category: 'seo', status: 'failed', score: 50 }]).score).toBeNull();
  });
});
