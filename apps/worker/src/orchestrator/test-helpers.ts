import {
  AUDIT_CATEGORIES,
  type AnalyzerResult,
  type AuditCategoryId,
  type AuditStatus,
  type CategoryStatus,
  type Finding,
} from '@wi/shared';
import type { Analyzer } from '../analyzers/types.js';
import type { AuditStore, StoredAudit } from './audit-store.js';

export class InMemoryAuditStore implements AuditStore {
  audit: StoredAudit & { errorMessage?: string; overallScore?: number | null };
  results = new Map<AuditCategoryId, AnalyzerResult>();
  /** Chronological log of persistence calls, to assert on incremental progress. */
  log: string[] = [];

  constructor(init: { targetUrl?: string; status?: AuditStatus; categories?: Partial<Record<AuditCategoryId, { status: CategoryStatus; score: number | null }>> } = {}) {
    this.audit = {
      id: 'audit-1',
      targetUrl: init.targetUrl ?? 'https://example.com',
      normalizedUrl: 'https://example.com',
      status: init.status ?? 'queued',
      categories: AUDIT_CATEGORIES.map((category) => ({
        category,
        status: init.categories?.[category]?.status ?? 'pending',
        score: init.categories?.[category]?.score ?? null,
      })),
    };
  }

  async getAudit(id: string) {
    return id === this.audit.id ? structuredClone(this.audit) : null;
  }
  async markAuditRunning() {
    this.audit.status = 'running';
    this.log.push('audit:running');
  }
  async markCategoryRunning(_id: string, category: AuditCategoryId) {
    this.log.push(`running:${category}`);
  }
  async saveCategoryResult(_id: string, result: AnalyzerResult) {
    this.results.set(result.category, result);
    this.log.push(`saved:${result.category}:${result.status}`);
  }
  async completeAudit(_id: string, o: Parameters<AuditStore['completeAudit']>[1]) {
    this.audit.status = o.status;
    this.audit.overallScore = o.overallScore;
    this.audit.errorMessage = o.errorMessage;
    this.log.push(`complete:${o.status}`);
  }
  async failAudit(_id: string, message: string) {
    this.audit.status = 'failed';
    this.audit.errorMessage = message;
    this.log.push('fail');
  }
}

export const finding = (over: Partial<Finding> = {}): Finding => ({
  ruleId: 'test.rule',
  title: 'Test',
  description: 'd',
  severity: 'medium',
  status: 'passed',
  evidence: null,
  recommendation: 'r',
  impact: null,
  ...over,
});

/** Analyzer returning a fixed result after an optional delay. */
export const fakeAnalyzer = (
  category: AuditCategoryId,
  behaviour: Partial<AnalyzerResult> | (() => Promise<AnalyzerResult>) = {},
): Analyzer => ({
  category,
  run: async () =>
    typeof behaviour === 'function'
      ? behaviour()
      : {
          category,
          status: 'completed',
          score: 80,
          findings: [finding()],
          summary: { passed: 1, failed: 0, warnings: 0 },
          executionTimeMs: 5,
          ...behaviour,
        },
});

export const silentLogger = { error: () => undefined, warn: () => undefined, info: () => undefined };

export const baseDeps = (store: InMemoryAuditStore, analyzers: Analyzer[]) => ({
  store,
  analyzers,
  fetch: (async () => {
    throw new Error('fetch must not be called in orchestrator tests');
  }) as never,
  analyzerTimeoutMs: 1000,
  resolveHost: async () => ['93.184.216.34'],
  logger: silentLogger,
});
