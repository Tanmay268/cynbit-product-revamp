import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import type { AuditListItem } from '@wi/shared';
import { ApiRequestError, toApiError } from '../services/api';
import { category, finding, makeReport } from '../test/fixtures';
import { addToHistory, clearHistory, loadHistory } from './history';
import { computeStats, diffFindings, flattenFindings, prioritize } from './findings';
import { displayUrl, formatElapsed, safeHref } from './format';
import { groupBySite } from './groups';
import { scoreTone } from './score';

describe('scoreTone', () => {
  it('maps scores to tones and treats null as "none", never as poor', () => {
    expect([100, 90, 89, 50, 49, 0].map(scoreTone)).toEqual(['good', 'good', 'fair', 'fair', 'poor', 'poor']);
    expect(scoreTone(null)).toBe('none');
    expect(scoreTone(undefined)).toBe('none');
  });
});

describe('format helpers', () => {
  it('displayUrl / formatElapsed', () => {
    expect(displayUrl('https://www.example.com/')).toBe('www.example.com');
    expect(displayUrl('http://a.com/p?q=1')).toBe('a.com/p?q=1');
    expect([0, 59_999, 60_000, 125_000].map(formatElapsed)).toEqual(['0s', '59s', '1m 0s', '2m 5s']);
  });
  it('safeHref only allows http(s)', () => {
    expect(safeHref('example.com')).toBe('https://example.com/');
    expect(safeHref('http://a.com')).toBe('http://a.com/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x']) expect(safeHref(bad)).toBeNull();
  });
});

describe('findings utils', () => {
  it('computeStats ignores informational findings as issues', () => {
    const s = computeStats([
      finding({ status: 'failed', severity: 'critical' }),
      finding({ status: 'failed', severity: 'low' }),
      finding({ status: 'warning', severity: 'medium' }),
      finding({ status: 'warning', severity: 'info' }),
      finding({ status: 'passed', severity: 'info' }),
      finding({ status: 'passed', severity: 'high' }),
    ]);
    expect(s).toEqual({ totalIssues: 3, critical: 1, warnings: 1, failed: 2, passed: 2 });
  });

  it('prioritize ranks by score impact (severity weight, failed > warning) and excludes passed/info', () => {
    const report = makeReport({
      categories: [
        category('seo', {
          findings: [
            finding({ ruleId: 'a', severity: 'low', status: 'failed' }), // lost 1
            finding({ ruleId: 'b', severity: 'critical', status: 'warning' }), // lost 5
            finding({ ruleId: 'c', severity: 'high', status: 'failed' }), // lost 6
            finding({ ruleId: 'd', severity: 'info', status: 'failed' }),
            finding({ ruleId: 'e', severity: 'critical', status: 'passed' }),
          ],
        }),
      ],
    });
    expect(prioritize(flattenFindings(report)).map((f) => f.ruleId)).toEqual(['c', 'b', 'a']);
    expect(prioritize(flattenFindings(report), 2)).toHaveLength(2);
  });
});

describe('diffFindings', () => {
  const rep = (cats: Parameters<typeof category>[1][], names = ['seo', 'security'] as const) =>
    makeReport({ categories: cats.map((c, i) => category(names[i]!, c)) });
  const f = (ruleId: string, status: 'failed' | 'passed' = 'failed') => finding({ ruleId, status, severity: 'medium' });

  it('splits issues into fixed / introduced / persisting', () => {
    const before = rep([{ findings: [f('x'), f('y'), f('z', 'passed')] }, { findings: [f('p')] }]);
    const after = rep([{ findings: [f('y'), f('x', 'passed'), f('z')] }, { findings: [f('p'), f('q')] }]);
    const d = diffFindings(before, after);
    expect(d.fixed.map((x) => x.ruleId)).toEqual(['x']);
    expect(d.introduced.map((x) => x.ruleId).sort()).toEqual(['q', 'z']);
    expect(d.persisting.map((x) => x.ruleId).sort()).toEqual(['p', 'y']);
  });

  it('never reports a category as "all fixed" when it was not scored in the later audit', () => {
    const before = rep([{ findings: [f('x')] }, { findings: [f('p')] }]);
    const after = rep([{ findings: [f('x')] }, { status: 'unavailable', score: null, findings: [] }]);
    const d = diffFindings(before, after);
    expect(d.fixed).toEqual([]); // security.p is NOT "fixed": it simply was not analyzed
    expect(d.persisting.map((x) => x.ruleId)).toEqual(['x']);
  });
});

describe('groupBySite', () => {
  const item = (id: string, url: string, created: string, score: number | null, status: AuditListItem['status'] = 'completed'): AuditListItem => ({
    id, targetUrl: url, normalizedUrl: url, status, overallScore: score, createdAt: created, completedAt: created,
  });

  it('groups per site, sorts newest first and computes the change between the latest two scored runs', () => {
    const groups = groupBySite([
      item('1', 'https://a.com', '2026-01-01T00:00:00Z', 60),
      item('2', 'https://b.com', '2026-01-02T00:00:00Z', 90),
      item('3', 'https://a.com', '2026-01-03T00:00:00Z', 75),
      item('4', 'https://a.com', '2026-01-04T00:00:00Z', null, 'failed'), // newest but failed: ignored for the delta
    ]);
    expect(groups.map((g) => g.normalizedUrl)).toEqual(['https://a.com', 'https://b.com']);
    const a = groups[0]!;
    expect(a.audits.map((x) => x.id)).toEqual(['4', '3', '1']);
    expect(a.latestScore).toBe(75);
    expect(a.delta).toBe(15);
    expect(a.trend.map((t) => t.score)).toEqual([60, 75]); // oldest -> newest
    expect(groups[1]!.delta).toBeNull(); // a single run has nothing to compare against
  });
});

describe('history storage', () => {
  const A = '3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10';
  const B = '8a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

  it('stores ids newest first without duplicates and rejects non-UUIDs', () => {
    addToHistory(A);
    addToHistory(B);
    addToHistory(A);
    addToHistory('not-a-uuid');
    addToHistory('<script>');
    expect(loadHistory()).toEqual([A, B]);
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });

  it('ignores tampered or corrupt storage', () => {
    localStorage.setItem('wi.audit-history.v1', JSON.stringify([A, 5, 'x', { a: 1 }]));
    expect(loadHistory()).toEqual([A]);
    localStorage.setItem('wi.audit-history.v1', '{not json');
    expect(loadHistory()).toEqual([]);
  });

  it('caps the list at 50', () => {
    for (let i = 0; i < 60; i++) addToHistory(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(loadHistory()).toHaveLength(50);
  });

  it('does not throw when storage is unavailable', () => {
    const spy = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    try {
      expect(loadHistory()).toEqual([]);
      expect(() => addToHistory(A)).not.toThrow();
      expect(() => clearHistory()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', spy);
    }
  });
});

describe('toApiError', () => {
  const axiosErr = (status: number | null, data?: unknown, code?: string) => {
    const e = new AxiosError('boom', code);
    if (status !== null) e.response = { status, data, headers: {}, statusText: '', config: {} as never };
    return e;
  };

  it('uses the API error envelope when present', () => {
    const e = toApiError(axiosErr(422, { error: { code: 'HOST_NOT_ALLOWED', message: 'Private address.', requestId: 'r1' } }));
    expect(e).toMatchObject({ message: 'Private address.', code: 'HOST_NOT_ALLOWED', status: 422, requestId: 'r1' });
    expect(e.retryable).toBe(false);
  });

  it('carries validation details', () => {
    const e = toApiError(axiosErr(400, { error: { code: 'BAD_REQUEST', message: 'Request validation failed', details: [{ path: 'body.url', message: 'Required' }] } }));
    expect(e.details).toEqual([{ path: 'body.url', message: 'Required' }]);
  });

  it('maps network failures, timeouts and garbage responses to friendly, retryable messages', () => {
    const net = toApiError(axiosErr(null));
    expect(net).toMatchObject({ code: 'NETWORK', status: null });
    expect(net.retryable).toBe(true);
    expect(toApiError(axiosErr(null, undefined, 'ECONNABORTED')).code).toBe('TIMEOUT');
    const html = toApiError(axiosErr(502, '<html>Bad gateway</html>'));
    expect(html.code).toBe('BAD_RESPONSE');
    expect(html.message).not.toMatch(/html|gateway/i);
    expect(html.retryable).toBe(true);
  });

  it('treats 429 as retryable and unknown throwables as network errors', () => {
    expect(toApiError(axiosErr(429, { error: { code: 'RATE_LIMITED', message: 'Slow down' } })).retryable).toBe(true);
    expect(toApiError(new Error('x')).code).toBe('NETWORK');
    const own = new ApiRequestError('m', 'C', 404);
    expect(toApiError(own)).toBe(own);
  });
});
