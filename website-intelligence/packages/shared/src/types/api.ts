import type {
  AuditCategoryId,
  AuditStatus,
  CategoryStatus,
  CategorySummary,
  Finding,
} from './index.js';

export interface CategoryStatusView {
  category: AuditCategoryId;
  status: CategoryStatus;
  /** null unless status === "completed". Unavailable is never shown as 0. */
  score: number | null;
  reason: string | null;
  executionTimeMs: number | null;
}

/** Real progress: derived from persisted category states, never estimated. */
export interface AuditStatusResponse {
  id: string;
  targetUrl: string;
  normalizedUrl: string;
  status: AuditStatus;
  overallScore: number | null;
  progress: { finished: number; total: number };
  categories: CategoryStatusView[];
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CategoryReport extends CategoryStatusView {
  summary: CategorySummary;
  findings: Finding[];
}

export interface AuditReportResponse {
  id: string;
  status: AuditStatus;
  targetUrl: string;
  normalizedUrl: string;
  overallScore: number | null;
  /** Categories that contributed to overallScore. */
  scoredCategories: AuditCategoryId[];
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  categories: CategoryReport[];
}

export interface AuditListItem {
  id: string;
  targetUrl: string;
  normalizedUrl: string;
  status: AuditStatus;
  overallScore: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AuditListResponse {
  items: AuditListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CategoryComparison {
  category: AuditCategoryId;
  first: number | null;
  second: number | null;
  /** second - first; null when either side has no score (unavailable is never treated as 0). */
  delta: number | null;
}

export interface AuditComparisonResponse {
  first: AuditStatusResponse;
  second: AuditStatusResponse;
  /** Both audits analysed the same normalised URL. */
  sameSite: boolean;
  overallDelta: number | null;
  categories: CategoryComparison[];
}

export interface CreateAuditResponse {
  id: string;
  status: AuditStatus;
}

/** Deliberately minimal: no id or echo of submitted data. */
export interface CreateLeadResponse {
  received: true;
}
