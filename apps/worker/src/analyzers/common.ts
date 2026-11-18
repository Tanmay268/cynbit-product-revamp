import { computeCategoryScore, summarizeFindings } from '@wi/shared';
import type { AnalyzerResult, AuditCategoryId, Finding, FindingStatus, Severity } from '@wi/shared';

/** Static description of one check. A Rule + an outcome produces a Finding. */
export interface Rule {
  ruleId: string;
  title: string;
  /** What the check looks at and what failing it means. */
  description: string;
  severity: Severity;
  /** What to do when the check does not pass. */
  recommendation: string;
  /** Why it matters / expected benefit of fixing it. */
  impact?: string;
}

export function outcome(rule: Rule, status: FindingStatus, evidence?: string | null): Finding {
  return {
    ruleId: rule.ruleId,
    title: rule.title,
    description: rule.description,
    severity: rule.severity,
    status,
    evidence: evidence ? truncate(evidence, 1000) : null,
    recommendation: status === 'passed' ? 'No action needed.' : rule.recommendation,
    impact: status === 'passed' ? null : (rule.impact ?? null),
  };
}

export const passed = (rule: Rule, evidence?: string | null) => outcome(rule, 'passed', evidence);
export const failed = (rule: Rule, evidence?: string | null) => outcome(rule, 'failed', evidence);
export const warning = (rule: Rule, evidence?: string | null) => outcome(rule, 'warning', evidence);
export const check = (rule: Rule, ok: boolean, evidence?: string | null) => outcome(rule, ok ? 'passed' : 'failed', evidence);

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Builds a completed result. Score derives from the shared, documented formula. */
export function buildResult(category: AuditCategoryId, findings: Finding[], startedAt: number, score?: number | null): AnalyzerResult {
  return {
    category,
    status: 'completed',
    score: score === undefined ? computeCategoryScore(findings) : score,
    findings,
    summary: summarizeFindings(findings),
    executionTimeMs: Date.now() - startedAt,
  };
}

export function unavailable(category: AuditCategoryId, reason: string, startedAt: number): AnalyzerResult {
  return {
    category,
    status: 'unavailable',
    score: null,
    findings: [],
    summary: { passed: 0, failed: 0, warnings: 0 },
    executionTimeMs: Date.now() - startedAt,
    reason,
  };
}

export const failedResult = (category: AuditCategoryId, reason: string, startedAt: number): AnalyzerResult => ({
  ...unavailable(category, reason, startedAt),
  status: 'failed',
});

/** Runs `fn` over `items` with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

export const header = (headers: Record<string, string | string[]>, name: string): string | undefined => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : v;
};

export const isHtml = (headers: Record<string, string | string[]>) => /html|xml/i.test(header(headers, 'content-type') ?? 'text/html');
