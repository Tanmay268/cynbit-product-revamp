import type { Finding, Severity } from '@wi/shared';
import type { Analyzer, LighthouseAudit, PageSpeedData } from '../types.js';
import { buildResult, failedResult, outcome, unavailable, type Rule } from '../common.js';

/**
 * Thresholds are the published Core Web Vitals / Lighthouse "good" and "poor" boundaries.
 * good <= goodMax, poor > poorMin, in between = needs improvement.
 */
interface Metric {
  key: string;
  label: string;
  /** Lighthouse audit id (lab data). */
  auditId?: string;
  /** CrUX field metric id (real users). */
  fieldId?: string;
  unit: 'ms' | 'score';
  good: number;
  poor: number;
  /** Severity when the metric is rated poor. */
  poorSeverity: Severity;
  why: string;
  fix: string;
}

const METRICS: Metric[] = [
  { key: 'fcp', label: 'First Contentful Paint', auditId: 'first-contentful-paint', unit: 'ms', good: 1800, poor: 3000, poorSeverity: 'medium', why: 'How long users stare at a blank screen.', fix: 'Reduce server response time, inline critical CSS, defer render-blocking scripts and preload key resources.' },
  { key: 'lcp', label: 'Largest Contentful Paint', auditId: 'largest-contentful-paint', unit: 'ms', good: 2500, poor: 4000, poorSeverity: 'high', why: 'When the main content becomes visible; a Core Web Vital that affects search ranking.', fix: 'Optimise and preload the hero image/text, use a CDN, compress images and cut render-blocking resources.' },
  { key: 'cls', label: 'Cumulative Layout Shift', auditId: 'cumulative-layout-shift', unit: 'score', good: 0.1, poor: 0.25, poorSeverity: 'high', why: 'Unexpected layout movement that causes mis-clicks; a Core Web Vital.', fix: 'Set width/height on images and embeds, reserve space for ads and late content, avoid inserting content above existing content.' },
  { key: 'inp', label: 'Interaction to Next Paint', fieldId: 'INTERACTION_TO_NEXT_PAINT', unit: 'ms', good: 200, poor: 500, poorSeverity: 'high', why: 'How quickly the page responds to clicks and taps; a Core Web Vital based on real-user data.', fix: 'Break up long JavaScript tasks, reduce main-thread work and defer non-critical scripts.' },
  { key: 'si', label: 'Speed Index', auditId: 'speed-index', unit: 'ms', good: 3400, poor: 5800, poorSeverity: 'medium', why: 'How quickly the visible page fills in.', fix: 'Prioritise above-the-fold content, minimise main-thread work and optimise fonts and images.' },
  { key: 'tbt', label: 'Total Blocking Time', auditId: 'total-blocking-time', unit: 'ms', good: 200, poor: 600, poorSeverity: 'high', why: 'How long the page is unresponsive while loading (lab proxy for interactivity).', fix: 'Split and defer JavaScript, remove unused code and move work off the main thread.' },
];

const fmt = (m: Metric, v: number) => (m.unit === 'ms' ? (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) : v.toFixed(3));

export const performanceAnalyzer: Analyzer = {
  category: 'performance',
  async run(ctx) {
    const started = Date.now();
    const ps = await ctx.pagespeed();

    // Missing key / quota / outage are "unavailable": a score is never invented.
    if (!ps.ok) {
      if (ps.reason === 'bad-response') return failedResult('performance', ps.message, started);
      return unavailable('performance', ps.message, started);
    }

    const { lighthouseResult: lh, loadingExperience } = ps.data;
    const perfScore = lh.categories['performance']?.score;
    if (typeof perfScore !== 'number') return unavailable('performance', 'PageSpeed Insights did not return a performance score.', started);

    const findings: Finding[] = [];
    const missing: string[] = [];

    for (const m of METRICS) {
      const value = readMetric(m, lh.audits[m.auditId ?? ''], loadingExperience);
      if (value === null) {
        missing.push(m.label);
        continue;
      }
      const rule: Rule = {
        ruleId: `performance.${m.key}`,
        title: m.label,
        description: `${m.why} Good: ${m.unit === 'ms' ? `≤ ${m.good} ms` : `≤ ${m.good}`}; poor: > ${m.poor}.`,
        severity: m.poorSeverity,
        recommendation: m.fix,
        impact: m.why,
      };
      const source = m.fieldId ? 'real-user data (CrUX, 75th percentile)' : 'lab data (Lighthouse, simulated mobile)';
      if (value <= m.good) findings.push(outcome(rule, 'passed', `${fmt(m, value)}, good (${source})`));
      else if (value <= m.poor) findings.push(outcome({ ...rule, severity: 'medium' }, 'warning', `${fmt(m, value)}, needs improvement (${source})`));
      else findings.push(outcome(rule, 'failed', `${fmt(m, value)}, poor (${source})`));
    }

    // Biggest Lighthouse opportunities, reported as actionable findings.
    const opportunities = Object.values(lh.audits)
      .filter((a): a is LighthouseAudit => Boolean(a) && a!.details?.type === 'opportunity' && (a!.details?.overallSavingsMs ?? 0) >= 300 && (a!.score ?? 1) < 0.9)
      .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
      .slice(0, 5);
    for (const a of opportunities) {
      findings.push(
        outcome(
          {
            ruleId: `performance.opportunity.${a.id}`,
            title: a.title,
            description: stripMarkdown(a.description ?? a.title),
            severity: (a.details?.overallSavingsMs ?? 0) >= 1000 ? 'high' : 'medium',
            recommendation: `Address this Lighthouse opportunity: ${a.title}.`,
            impact: `Potential savings of about ${Math.round(a.details?.overallSavingsMs ?? 0)} ms.`,
          },
          'failed',
          a.displayValue ?? `Estimated savings: ${Math.round(a.details?.overallSavingsMs ?? 0)} ms`,
        ),
      );
    }

    if (missing.length > 0) {
      findings.push(
        outcome(
          {
            ruleId: 'performance.metrics-unavailable',
            title: 'Some metrics could not be measured',
            description: 'These metrics were not returned for this page (INP needs enough real-user traffic in Chrome UX Report data).',
            severity: 'info',
            recommendation: 'No action needed; they appear once the data is available.',
          },
          'warning',
          `Not available: ${missing.join(', ')}`,
        ),
      );
    }

    // The score is Lighthouse's own weighted performance score, passed through unchanged (not recomputed).
    return buildResult('performance', findings, started, Math.round(perfScore * 100));
  },
};

function readMetric(m: Metric, audit: LighthouseAudit | undefined, field: PageSpeedData['loadingExperience']): number | null {
  if (m.fieldId) {
    const v = field?.metrics?.[m.fieldId]?.percentile;
    // CrUX reports CLS multiplied by 100; INP is already in ms.
    return typeof v === 'number' ? v : null;
  }
  return typeof audit?.numericValue === 'number' ? audit.numericValue : null;
}

const stripMarkdown = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');
