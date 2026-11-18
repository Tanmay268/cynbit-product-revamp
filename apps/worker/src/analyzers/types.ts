import type { SafeFetch, SafeFetchResponse } from '@wi/net-guard';
import type { AnalyzerResult, AuditCategoryId } from '@wi/shared';

/** The main page fetched once per audit and shared by every analyzer that needs it. */
export type PageSnapshot = SafeFetchResponse;

/** Subset of the Lighthouse result JSON returned by PageSpeed Insights that we consume. */
export interface LighthouseAudit {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  displayValue?: string;
  details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number };
}

export interface PageSpeedData {
  lighthouseResult: {
    categories: Record<string, { score: number | null } | undefined>;
    audits: Record<string, LighthouseAudit | undefined>;
  };
  /** Real-user (CrUX) data when Google has enough traffic for the URL. */
  loadingExperience?: { metrics?: Record<string, { percentile: number; category: string } | undefined> };
}

export type PageSpeedFailure =
  | 'missing-key'
  | 'invalid-key'
  | 'rate-limited'
  | 'timeout'
  | 'unavailable'
  | 'target-failed'
  | 'bad-response';

export type PageSpeedOutcome =
  | { ok: true; data: PageSpeedData }
  /** `message` is safe to show to end users and never contains the API key or request URL. */
  | { ok: false; reason: PageSpeedFailure; message: string };

export interface AnalyzerContext {
  /** Normalised, SSRF-validated URL (re-validated by the orchestrator before any analyzer runs). */
  url: string;
  /** Aborted when this analyzer exceeds its time budget. Analyzers must stop work promptly. */
  signal: AbortSignal;
  /**
   * The ONLY sanctioned way to request the target site. It enforces the SSRF policy,
   * size caps and timeouts. Analyzers must not use global fetch/http directly.
   */
  fetch: SafeFetch;
  /** Main page, fetched once per audit (memoised). Rejects with a SafeFetchError if the site cannot be fetched. */
  page(): Promise<PageSnapshot>;
  /** PageSpeed Insights result, requested once per audit (memoised) and shared by Performance + Best Practices. */
  pagespeed(): Promise<PageSpeedOutcome>;
}

/**
 * Every audit module implements this. The orchestrator runs analyzers
 * independently so one failure never fails the whole audit. New categories
 * are added by registering another Analyzer; nothing else changes.
 *
 * Contract: return findings (and optionally a score). The orchestrator
 * recomputes the summary from the findings and, when no score is given,
 * derives it with the shared scoring formula, so analyzers cannot report
 * counts that disagree with their own findings.
 */
export interface Analyzer {
  readonly category: AuditCategoryId;
  run(ctx: AnalyzerContext): Promise<AnalyzerResult>;
}
