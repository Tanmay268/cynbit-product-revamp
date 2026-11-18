import { normalizeUrl, resolvePublicAddresses, SafeFetchError, UrlValidationError, type NormalizeOptions, type SafeFetch } from '@wi/net-guard';
import {
  AUDIT_CATEGORIES,
  computeCategoryScore,
  computeOverallScore,
  summarizeFindings,
  type AnalyzerResult,
  type AuditCategoryId,
  type AuditStatus,
  type ScoredCategory,
} from '@wi/shared';
import type { Analyzer, AnalyzerContext, PageSpeedOutcome } from '../analyzers/types.js';
import type { AuditStore } from './audit-store.js';

export interface RunAuditDeps {
  store: AuditStore;
  analyzers: readonly Analyzer[];
  fetch: SafeFetch;
  /** Per-analyzer wall-clock budget. */
  analyzerTimeoutMs: number;
  /** PageSpeed Insights loader. Omitted => analyzers see "missing-key" (never fabricated data). */
  pagespeed?: (url: string, signal: AbortSignal) => Promise<PageSpeedOutcome>;
  /** URL-policy overrides. Test seam only (e.g. allow an ephemeral port); production never sets this. */
  normalizeOptions?: NormalizeOptions;
  /** DNS validation hook; injected in tests. */
  resolveHost?: (hostname: string) => Promise<unknown>;
  logger?: Pick<Console, 'error' | 'warn' | 'info'>;
  now?: () => number;
}

export interface RunAuditOutcome {
  status: Extract<AuditStatus, 'completed' | 'partial' | 'failed'>;
  overallScore: number | null;
}

class AnalyzerTimeout extends Error {}

/**
 * Runs one audit end to end.
 *
 * - Analyzers run concurrently and independently; each result is persisted the
 *   moment it finishes, so the status endpoint reflects real progress.
 * - A throwing/timing-out/unavailable analyzer only affects its own category.
 * - Overall status: all categories completed -> completed; some -> partial; none -> failed.
 * - Idempotent: categories already completed (from an earlier attempt of the same
 *   job) are kept and not re-run. Only infrastructure errors (e.g. the database) throw,
 *   which lets BullMQ retry the job.
 */
export async function runAudit(auditId: string, deps: RunAuditDeps): Promise<RunAuditOutcome | null> {
  const { store, analyzers, fetch, analyzerTimeoutMs } = deps;
  const logger = deps.logger ?? console;
  const now = deps.now ?? Date.now;
  const resolveHost = deps.resolveHost ?? ((h: string) => resolvePublicAddresses(h));

  const audit = await store.getAudit(auditId);
  if (!audit) {
    logger.warn(`[worker] audit ${auditId} not found; dropping job`);
    return null;
  }
  if (audit.status === 'completed' || audit.status === 'partial' || audit.status === 'failed') {
    return null; // duplicate delivery of a finished audit
  }

  // Never trust the queue: the URL is validated again here, right before any request is made.
  let url: string;
  try {
    const n = normalizeUrl(audit.targetUrl, deps.normalizeOptions);
    await resolveHost(n.hostname);
    url = n.href;
  } catch (err) {
    if (err instanceof UrlValidationError) {
      await store.failAudit(auditId, err.message); // permanent: retrying cannot help
      return { status: 'failed', overallScore: null };
    }
    throw err;
  }

  await store.markAuditRunning(auditId);

  const results: ScoredCategory[] = audit.categories
    .filter((c) => c.status === 'completed')
    .map(({ category, status, score }) => ({ category, status, score }));
  const alreadyDone = new Set(results.map((r) => r.category));
  const byCategory = new Map(analyzers.map((a) => [a.category, a] as const));

  // Shared, lazily-created, memoised inputs: the page is fetched at most once and PageSpeed
  // is called at most once per audit, no matter how many analyzers ask for them.
  const shared = createSharedInputs(url, fetch, deps.pagespeed);

  await Promise.all(
    AUDIT_CATEGORIES.filter((c) => !alreadyDone.has(c)).map(async (category) => {
      const analyzer = byCategory.get(category);
      let result: AnalyzerResult;
      if (!analyzer) {
        result = emptyResult(category, 'unavailable', 0, 'This check is not available yet.');
      } else {
        await store.markCategoryRunning(auditId, category);
        result = await execute(analyzer, { url, fetch, shared, timeoutMs: analyzerTimeoutMs, logger, now });
      }
      await store.saveCategoryResult(auditId, result);
      results.push({ category, status: result.status, score: result.score });
    }),
  );

  const overall = computeOverallScore(results);
  const completedCount = results.filter((r) => r.status === 'completed').length;
  const status: RunAuditOutcome['status'] =
    completedCount === AUDIT_CATEGORIES.length ? 'completed' : completedCount > 0 ? 'partial' : 'failed';

  await store.completeAudit(auditId, {
    status,
    overallScore: overall.score,
    errorMessage: status === 'failed' ? 'None of the checks could be completed for this website.' : undefined,
  });
  return { status, overallScore: overall.score };
}

type SharedInputs = Pick<AnalyzerContext, 'page' | 'pagespeed'>;

function createSharedInputs(url: string, fetch: SafeFetch, pagespeed: RunAuditDeps['pagespeed']): SharedInputs {
  let page: ReturnType<AnalyzerContext['page']> | undefined;
  let speed: ReturnType<AnalyzerContext['pagespeed']> | undefined;
  return {
    // The shared fetch has its own deadline and is deliberately NOT tied to any single analyzer's
    // abort signal: one slow analyzer timing out must not cancel the page for the others.
    page: () => (page ??= fetch(url, { timeoutMs: 20_000, maxRedirects: 5 })),
    pagespeed: () =>
      (speed ??= pagespeed
        ? pagespeed(url, AbortSignal.timeout(90_000))
        : Promise.resolve({ ok: false as const, reason: 'missing-key' as const, message: 'PageSpeed Insights is not configured.' })),
  };
}

async function execute(
  analyzer: Analyzer,
  o: { url: string; fetch: SafeFetch; shared: SharedInputs; timeoutMs: number; logger: Pick<Console, 'error' | 'warn'>; now: () => number },
): Promise<AnalyzerResult> {
  const started = o.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject BEFORE aborting: aborting makes the analyzer reject with its own error, and
      // Promise.race must see the timeout first so the category is reported as "timed out".
      reject(new AnalyzerTimeout());
      controller.abort();
    }, o.timeoutMs);
  });

  try {
    const run = analyzer.run({ url: o.url, signal: controller.signal, fetch: o.fetch, ...o.shared });
    run.catch(() => undefined); // a late rejection after a timeout must not become an unhandled rejection
    return sanitize(analyzer.category, await Promise.race([run, timeout]), o.now() - started);
  } catch (err) {
    const elapsed = o.now() - started;
    if (err instanceof AnalyzerTimeout) return emptyResult(analyzer.category, 'failed', elapsed, 'The analysis timed out.');
    // SafeFetchError messages are written for end users (e.g. "The website took too long to respond.").
    if (err instanceof SafeFetchError) return emptyResult(analyzer.category, 'failed', elapsed, err.message);
    o.logger.error(`[worker] analyzer ${analyzer.category} crashed`, err);
    return emptyResult(analyzer.category, 'failed', elapsed, 'The analysis failed unexpectedly.');
  } finally {
    clearTimeout(timer);
  }
}

/** Trust but verify: enforce the invariants the rest of the system relies on, whatever an analyzer returned. */
function sanitize(category: AuditCategoryId, raw: AnalyzerResult, elapsed: number): AnalyzerResult {
  const findings = Array.isArray(raw.findings) ? raw.findings : [];
  const executionTimeMs = Number.isFinite(raw.executionTimeMs) ? Math.round(raw.executionTimeMs) : elapsed;
  const base = { category, findings, summary: summarizeFindings(findings), executionTimeMs };

  if (raw.status !== 'completed') {
    return {
      ...base,
      status: raw.status === 'failed' ? 'failed' : 'unavailable',
      score: null,
      reason: raw.reason ?? 'This check could not be completed.',
    };
  }

  const provided = typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.min(100, Math.max(0, Math.round(raw.score))) : null;
  const score = provided ?? computeCategoryScore(findings);
  if (score === null) {
    return { ...base, status: 'unavailable', score: null, reason: 'There was nothing to score for this website.' };
  }
  return { ...base, status: 'completed', score };
}

function emptyResult(
  category: AuditCategoryId,
  status: 'failed' | 'unavailable',
  executionTimeMs: number,
  reason: string,
): AnalyzerResult {
  return { category, status, score: null, findings: [], summary: { passed: 0, failed: 0, warnings: 0 }, executionTimeMs, reason };
}
