import { CATEGORY_META } from '../utils/meta';
import { TONE_BG, TONE_TEXT, scoreTone } from '../utils/score';
import { SeverityBadge, StatusBadge } from './badges';
import { ScoreRing } from './ScoreRing';
import { Card } from './ui';
import type { AuditCategoryId, Severity } from '@wi/shared';

/**
 * A static, clearly-labelled illustration of the report layout. The numbers are NOT from a real
 * audit and are never presented as statistics about Cynbit or its customers.
 */
const SAMPLE: { category: AuditCategoryId; score: number }[] = [
  { category: 'performance', score: 72 },
  { category: 'seo', score: 91 },
  { category: 'accessibility', score: 64 },
  { category: 'security', score: 48 },
  { category: 'best-practices', score: 85 },
];
const SAMPLE_FINDINGS: { severity: Severity; title: string; fix: string }[] = [
  { severity: 'high', title: 'Content-Security-Policy is defined', fix: 'Define a Content-Security-Policy. Start in report-only mode, then enforce.' },
  { severity: 'high', title: 'Images have alt attributes', fix: 'Add concise, meaningful alt text to informative images.' },
  { severity: 'medium', title: 'Static assets use long-lived caching', fix: 'Send Cache-Control: public, max-age=31536000, immutable for fingerprinted assets.' },
];

export function SampleReport() {
  return (
    <Card className="overflow-hidden" aria-label="Sample audit report (illustrative)">
      <div className="flex items-center justify-between gap-3 bg-surface-low px-5 py-3 text-sm">
        <span className="font-semibold">example.com</span>
        <span className="rounded-full bg-tertiary-fixed px-3 py-1 text-xs font-bold text-tertiary">Sample · illustrative data</span>
      </div>
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={68} size={140} strokeWidth={12} label="Sample overall health" />
          <p className="text-xs font-semibold text-on-surface-variant">Overall health</p>
        </div>
        <ul className="space-y-3">
          {SAMPLE.map((s) => {
            const m = CATEGORY_META[s.category];
            const tone = scoreTone(s.score);
            return (
              <li key={s.category} className="flex items-center gap-3 text-sm">
                <m.icon className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="w-32 shrink-0 font-semibold">{m.label}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-highest" aria-hidden>
                  <span className={`block h-full rounded-full ${TONE_BG[tone]}`} style={{ width: `${s.score}%` }} />
                </span>
                <span className={`w-8 text-right font-bold ${TONE_TEXT[tone]}`}>{s.score}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="space-y-2 border-t border-outline-variant/50 bg-surface px-5 py-5">
        <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Example findings</p>
        {SAMPLE_FINDINGS.map((f) => (
          <div key={f.title} className="rounded-lg bg-surface-lowest p-3 ring-1 ring-outline-variant/60">
            <p className="flex flex-wrap items-center gap-2"><SeverityBadge severity={f.severity} /><StatusBadge status="failed" /><span className="font-semibold">{f.title}</span></p>
            <p className="mt-1 text-sm text-on-surface-variant">{f.fix}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
