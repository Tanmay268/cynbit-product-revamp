export const AUDIT_CATEGORIES = [
  'performance',
  'seo',
  'accessibility',
  'security',
  'best-practices',
] as const;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export const AUDIT_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed'] as const;

/** Per-category result states. "unavailable" is NOT a zero score. */
export const CATEGORY_STATUSES = [
  'pending',
  'running',
  'completed',
  'unavailable',
  'failed',
] as const;

export const FINDING_STATUSES = ['failed', 'warning', 'passed'] as const;

/** Overall score weights (sum = 1). Re-normalised over available categories. */
export const CATEGORY_WEIGHTS = {
  performance: 0.25,
  seo: 0.2,
  accessibility: 0.2,
  security: 0.2,
  'best-practices': 0.15,
} as const;
