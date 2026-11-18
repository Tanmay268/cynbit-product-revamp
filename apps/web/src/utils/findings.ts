import {
  SEVERITY_WEIGHTS,
  type AuditCategoryId,
  type AuditReportResponse,
  type Finding,
  type FindingStatus,
  type Severity,
} from '@wi/shared';
import { SEVERITY_META } from './meta';

export interface CategorizedFinding extends Finding {
  category: AuditCategoryId;
}

export const flattenFindings = (report: Pick<AuditReportResponse, 'categories'>): CategorizedFinding[] =>
  report.categories.flatMap((c) => c.findings.map((f) => ({ ...f, category: c.category })));

/**
 * An "issue" is a failed or warning finding that is not purely informational.
 * Info-severity findings (scope notes, "metric not measured") are shown but never counted as issues.
 */
export const isIssue = (f: Pick<Finding, 'status' | 'severity'>) => f.status !== 'passed' && f.severity !== 'info';

export interface ReportStats {
  totalIssues: number;
  critical: number;
  warnings: number;
  failed: number;
  passed: number;
}

export function computeStats(findings: readonly Pick<Finding, 'status' | 'severity'>[]): ReportStats {
  const s: ReportStats = { totalIssues: 0, critical: 0, warnings: 0, failed: 0, passed: 0 };
  for (const f of findings) {
    if (f.status === 'passed') s.passed++;
    if (!isIssue(f)) continue;
    s.totalIssues++;
    if (f.status === 'warning') s.warnings++;
    else s.failed++;
    if (f.severity === 'critical' && f.status === 'failed') s.critical++;
  }
  return s;
}

export type StatusFilter = 'issues' | 'passed' | 'all';

export interface Filters {
  severities: ReadonlySet<Severity>;
  category: AuditCategoryId | 'all';
  status: StatusFilter;
}

export const DEFAULT_FILTERS: Filters = { severities: new Set(), category: 'all', status: 'issues' };

export function applyFilters<T extends CategorizedFinding>(findings: readonly T[], f: Filters): T[] {
  return findings.filter((x) => {
    if (f.category !== 'all' && x.category !== f.category) return false;
    if (f.severities.size > 0 && !f.severities.has(x.severity)) return false;
    if (f.status === 'issues') return x.status !== 'passed';
    if (f.status === 'passed') return x.status === 'passed';
    return true;
  });
}

/** Most severe first; within a severity, failed before warning, then title for stable order. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank ||
    statusRank(a.status) - statusRank(b.status) ||
    a.title.localeCompare(b.title)
  );
}
const statusRank = (s: FindingStatus) => (s === 'failed' ? 0 : s === 'warning' ? 1 : 2);

/**
 * "Prioritised fixes": the issues where fixing gives the biggest score gain, using the same weights as the
 * scoring formula (a failed check forfeits its whole weight; a warning forfeits half).
 */
export function prioritize(findings: readonly CategorizedFinding[], limit = 5): CategorizedFinding[] {
  const lost = (f: Finding) => SEVERITY_WEIGHTS[f.severity] * (f.status === 'failed' ? 1 : 0.5);
  return findings
    .filter(isIssue)
    .sort((a, b) => lost(b) - lost(a) || compareFindings(a, b))
    .slice(0, limit);
}

export interface FindingDiff {
  fixed: CategorizedFinding[];
  introduced: CategorizedFinding[];
  persisting: CategorizedFinding[];
}

const key = (f: CategorizedFinding) => `${f.category}:${f.ruleId}`;

/**
 * Compares the issue sets of two audits by rule id.
 * fixed = issue before, no longer an issue; introduced = new issue; persisting = issue in both.
 * Only categories that completed in BOTH audits are compared, so an unavailable category is never reported as "all fixed".
 */
export function diffFindings(before: AuditReportResponse, after: AuditReportResponse): FindingDiff {
  const comparable = new Set(
    before.categories.filter((c) => c.status === 'completed' && after.categories.find((x) => x.category === c.category)?.status === 'completed').map((c) => c.category),
  );
  const a = flattenFindings(before).filter((f) => comparable.has(f.category));
  const b = flattenFindings(after).filter((f) => comparable.has(f.category));
  const issuesA = new Map(a.filter(isIssue).map((f) => [key(f), f]));
  const issuesB = new Map(b.filter(isIssue).map((f) => [key(f), f]));
  const out: FindingDiff = { fixed: [], introduced: [], persisting: [] };
  for (const [k, f] of issuesA) (issuesB.has(k) ? out.persisting : out.fixed).push(issuesB.get(k) ?? f);
  for (const [k, f] of issuesB) if (!issuesA.has(k)) out.introduced.push(f);
  for (const list of Object.values(out)) list.sort(compareFindings);
  return out;
}
