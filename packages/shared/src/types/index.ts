import type {
  AUDIT_CATEGORIES,
  AUDIT_STATUSES,
  CATEGORY_STATUSES,
  FINDING_STATUSES,
  SEVERITIES,
} from '../constants/index.js';

export type AuditCategoryId = (typeof AUDIT_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export interface Finding {
  /** Stable rule id, e.g. "seo.meta-description.missing". */
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  status: FindingStatus;
  evidence: string | null;
  recommendation: string;
  impact: string | null;
}

export interface CategorySummary {
  passed: number;
  failed: number;
  warnings: number;
}

/** Contract every analyzer returns. `score` is null when status !== "completed". */
export interface AnalyzerResult {
  category: AuditCategoryId;
  status: Extract<CategoryStatus, 'completed' | 'unavailable' | 'failed'>;
  score: number | null;
  findings: Finding[];
  summary: CategorySummary;
  executionTimeMs: number;
  /** Safe, user-presentable reason when status is unavailable/failed. */
  reason?: string;
}
