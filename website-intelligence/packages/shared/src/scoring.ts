import { CATEGORY_WEIGHTS } from './constants/index.js';
import type {
  AuditCategoryId,
  CategoryStatus,
  CategorySummary,
  Finding,
  FindingStatus,
  Severity,
} from './types/index.js';

/**
 * SCORING MODEL (documented in docs/scoring.md)
 *
 * Category score = 100 * (sum of earned weight) / (sum of possible weight)
 *   - every finding is one *check* with a weight determined by its severity
 *   - a passed check earns its full weight, a warning earns half, a failed check earns none
 *   - "info" checks have weight 0: they are reported but never move the score
 *
 * Overall score = weighted mean of category scores using CATEGORY_WEIGHTS,
 * computed ONLY over categories that completed with a score. Weights are
 * re-normalised over the available categories, so an unavailable category
 * never counts as zero (and never silently inflates the result either: the
 * report shows which categories were included).
 */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
  info: 0,
};

export const STATUS_CREDIT: Record<FindingStatus, number> = {
  passed: 1,
  warning: 0.5,
  failed: 0,
};

export function summarizeFindings(findings: readonly Pick<Finding, 'status'>[]): CategorySummary {
  const summary: CategorySummary = { passed: 0, failed: 0, warnings: 0 };
  for (const f of findings) {
    if (f.status === 'passed') summary.passed++;
    else if (f.status === 'failed') summary.failed++;
    else summary.warnings++;
  }
  return summary;
}

/** Returns null when there is nothing scorable (no findings, or only informational ones). */
export function computeCategoryScore(findings: readonly Pick<Finding, 'severity' | 'status'>[]): number | null {
  let possible = 0;
  let earned = 0;
  for (const f of findings) {
    const weight = SEVERITY_WEIGHTS[f.severity];
    possible += weight;
    earned += weight * STATUS_CREDIT[f.status];
  }
  if (possible === 0) return null;
  return Math.round((100 * earned) / possible);
}

export interface ScoredCategory {
  category: AuditCategoryId;
  status: CategoryStatus;
  score: number | null;
}

export interface OverallScore {
  score: number | null;
  /** Categories that contributed, so the UI can say "based on 4 of 5 categories". */
  includedCategories: AuditCategoryId[];
}

export function computeOverallScore(categories: readonly ScoredCategory[]): OverallScore {
  let weighted = 0;
  let totalWeight = 0;
  const included: AuditCategoryId[] = [];
  for (const c of categories) {
    if (c.status !== 'completed' || c.score === null) continue;
    const w = CATEGORY_WEIGHTS[c.category];
    weighted += w * c.score;
    totalWeight += w;
    included.push(c.category);
  }
  if (totalWeight === 0) return { score: null, includedCategories: [] };
  return { score: Math.round(weighted / totalWeight), includedCategories: included };
}
