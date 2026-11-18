import type { AuditCategoryId, AuditReportResponse, AuditStatusResponse, CategoryReport, Finding } from '@wi/shared';
import { AUDIT_CATEGORIES } from '@wi/shared';

export const ID_A = '3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10';
export const ID_B = '8a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

export const finding = (over: Partial<Finding> = {}): Finding => ({
  ruleId: 'seo.title',
  title: 'Page has a descriptive <title>',
  description: 'The title is the main clickable headline.',
  severity: 'high',
  status: 'failed',
  evidence: 'No <title> element found.',
  recommendation: 'Add a unique <title>.',
  impact: 'Missing titles reduce rankings.',
  ...over,
});

export function category(c: AuditCategoryId, over: Partial<CategoryReport> = {}): CategoryReport {
  return {
    category: c,
    status: 'completed',
    score: 80,
    reason: null,
    executionTimeMs: 100,
    summary: { passed: 0, failed: 0, warnings: 0 },
    findings: [],
    ...over,
  };
}

/** A full, realistic report: all five categories with a mix of findings. */
export function makeReport(over: Partial<AuditReportResponse> = {}): AuditReportResponse {
  const categories: CategoryReport[] = [
    category('performance', { score: 72, summary: { passed: 1, failed: 1, warnings: 0 }, findings: [finding({ ruleId: 'performance.lcp', title: 'Largest Contentful Paint', severity: 'high', status: 'failed' }), finding({ ruleId: 'performance.cls', title: 'Cumulative Layout Shift', severity: 'high', status: 'passed', evidence: '0.01, good' })] }),
    category('seo', { score: 91, summary: { passed: 1, failed: 0, warnings: 1 }, findings: [finding({ ruleId: 'seo.meta-description', title: 'Page has a meta description', severity: 'medium', status: 'warning' }), finding({ ruleId: 'seo.h1', title: 'Page has exactly one <h1>', severity: 'medium', status: 'passed' })] }),
    category('accessibility', { score: 64, summary: { passed: 0, failed: 1, warnings: 0 }, findings: [finding({ ruleId: 'accessibility.image-alt', title: 'Images must have alternative text', severity: 'critical', status: 'failed' })] }),
    category('security', { score: 48, summary: { passed: 0, failed: 1, warnings: 0 }, findings: [finding({ ruleId: 'security.csp', title: 'Content-Security-Policy is defined', severity: 'medium', status: 'failed' }), finding({ ruleId: 'security.scope-note', title: 'Scope of this analysis', severity: 'info', status: 'passed', evidence: null, impact: null })] }),
    category('best-practices', { score: 85, summary: { passed: 1, failed: 0, warnings: 0 }, findings: [finding({ ruleId: 'best-practices.doctype', title: 'Page declares an HTML5 doctype', severity: 'medium', status: 'passed' })] }),
  ];
  return {
    id: ID_A,
    status: 'completed',
    targetUrl: 'example.com',
    normalizedUrl: 'https://example.com',
    overallScore: 70,
    scoredCategories: [...AUDIT_CATEGORIES],
    createdAt: '2026-11-17T10:00:00.000Z',
    completedAt: '2026-11-17T10:01:30.000Z',
    errorMessage: null,
    categories,
    ...over,
  };
}

export function makeStatus(over: Partial<AuditStatusResponse> = {}): AuditStatusResponse {
  return {
    id: ID_A,
    targetUrl: 'example.com',
    normalizedUrl: 'https://example.com',
    status: 'running',
    overallScore: null,
    progress: { finished: 1, total: 5 },
    categories: AUDIT_CATEGORIES.map((c) => ({ category: c, status: 'pending' as const, score: null, reason: null, executionTimeMs: null })),
    createdAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    ...over,
  };
}
