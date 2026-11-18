import type { AnalyzerResult, AuditCategoryId, AuditStatus, CategoryStatus } from '@wi/shared';

export interface StoredAudit {
  id: string;
  targetUrl: string;
  normalizedUrl: string;
  status: AuditStatus;
  categories: { category: AuditCategoryId; status: CategoryStatus; score: number | null }[];
}

/**
 * Persistence port for the orchestrator. Every method is idempotent so a
 * retried job can safely replay it. Implemented with Prisma in production and
 * in memory in tests.
 */
export interface AuditStore {
  getAudit(id: string): Promise<StoredAudit | null>;
  markAuditRunning(id: string): Promise<void>;
  markCategoryRunning(id: string, category: AuditCategoryId): Promise<void>;
  /** Persists the category row and replaces its findings atomically. */
  saveCategoryResult(id: string, result: AnalyzerResult): Promise<void>;
  completeAudit(
    id: string,
    outcome: { status: Extract<AuditStatus, 'completed' | 'partial' | 'failed'>; overallScore: number | null; errorMessage?: string },
  ): Promise<void>;
  failAudit(id: string, message: string): Promise<void>;
}
