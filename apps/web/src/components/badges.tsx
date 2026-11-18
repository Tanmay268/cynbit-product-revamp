import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { FindingStatus, Severity } from '@wi/shared';
import { FINDING_STATUS_META, SEVERITY_META } from '../utils/meta';

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${m.classes}`}>{m.label}</span>;
}

export function StatusBadge({ status }: { status: FindingStatus }) {
  const m = FINDING_STATUS_META[status];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${m.classes}`}>{m.label}</span>;
}

/** Score change between two audits. null = not comparable (unavailable on either side), never "0". */
export function DeltaBadge({ delta, suffix = '' }: { delta: number | null; suffix?: string }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant" title="Not comparable: no score in one of the audits">
        n/a
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-bold text-on-surface-variant">
        <Minus className="size-3" aria-hidden /> No change{suffix}
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${up ? 'bg-good-container text-good' : 'bg-poor-container text-on-error-container'}`}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      <span className="sr-only">{up ? 'Improved by' : 'Regressed by'}</span>
      {up ? '+' : '−'}
      {Math.abs(delta)}
      {suffix}
    </span>
  );
}
