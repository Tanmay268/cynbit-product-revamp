import { truncate } from '../common.js';
import type { AxeImpact, AxeRule, AxeRunResult, KeyboardProbe } from './types.js';

interface RawAxeResult {
  violations?: RawRule[];
  incomplete?: RawRule[];
  passes?: RawRule[];
}
interface RawRule {
  id: string;
  impact?: string | null;
  help?: string;
  description?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: { html?: string; target?: unknown[]; failureSummary?: string }[];
}

const IMPACTS = new Set(['minor', 'moderate', 'serious', 'critical']);

/**
 * Converts raw `axe.run()` output into our compact, size-bounded shape. Page content is
 * untrusted: every string is length-capped and only expected fields are copied.
 */
export function normalizeAxeResults(raw: RawAxeResult, keyboard: KeyboardProbe): AxeRunResult {
  const rule = (r: RawRule): AxeRule => ({
    id: String(r.id).slice(0, 80),
    impact: IMPACTS.has(r.impact ?? '') ? (r.impact as AxeImpact) : null,
    help: truncate(String(r.help ?? r.id), 200),
    description: truncate(String(r.description ?? ''), 400),
    helpUrl: /^https:\/\/dequeuniversity\.com\//.test(r.helpUrl ?? '') ? (r.helpUrl as string) : '',
    tags: (r.tags ?? []).map(String).slice(0, 12),
    nodeCount: r.nodes?.length ?? 0,
    nodes: (r.nodes ?? []).slice(0, 5).map((n) => ({
      html: truncate(String(n.html ?? ''), 200),
      target: (n.target ?? []).map(String).slice(0, 4),
      failureSummary: n.failureSummary ? truncate(String(n.failureSummary), 300) : undefined,
    })),
  });
  return {
    violations: (raw.violations ?? []).map(rule),
    incomplete: (raw.incomplete ?? []).map(rule),
    passes: (raw.passes ?? []).map((p) => ({ id: String(p.id).slice(0, 80), help: truncate(String(p.help ?? p.id), 200) })),
    keyboard,
  };
}
