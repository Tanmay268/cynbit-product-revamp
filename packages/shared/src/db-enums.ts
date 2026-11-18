import type {
  AuditCategoryId,
  AuditStatus,
  CategoryStatus,
  FindingStatus,
  Severity,
} from './types/index.js';

/**
 * Prisma enums are SCREAMING_SNAKE; the shared contract (and the JSON API) uses
 * lowercase-kebab. These total mappings (enforced by `satisfies`) are the only
 * place that conversion happens. apps/api has a test proving they match the
 * generated Prisma enums, so schema drift fails CI.
 */
export const categoryToDb = {
  performance: 'PERFORMANCE',
  seo: 'SEO',
  accessibility: 'ACCESSIBILITY',
  security: 'SECURITY',
  'best-practices': 'BEST_PRACTICES',
} as const satisfies Record<AuditCategoryId, string>;

export const auditStatusToDb = {
  queued: 'QUEUED',
  running: 'RUNNING',
  completed: 'COMPLETED',
  partial: 'PARTIAL',
  failed: 'FAILED',
} as const satisfies Record<AuditStatus, string>;

export const categoryStatusToDb = {
  pending: 'PENDING',
  running: 'RUNNING',
  completed: 'COMPLETED',
  unavailable: 'UNAVAILABLE',
  failed: 'FAILED',
} as const satisfies Record<CategoryStatus, string>;

export const severityToDb = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
} as const satisfies Record<Severity, string>;

export const findingStatusToDb = {
  failed: 'FAILED',
  warning: 'WARNING',
  passed: 'PASSED',
} as const satisfies Record<FindingStatus, string>;

/** DB value -> shared value. Throws on unknown values rather than guessing. */
export function fromDb<T extends Record<string, string>>(map: T, dbValue: string): keyof T {
  for (const [shared, db] of Object.entries(map)) if (db === dbValue) return shared as keyof T;
  throw new Error(`Unknown database enum value: ${dbValue}`);
}
