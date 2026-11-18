import { ArrowRight, AlertTriangle, CheckCircle2, CircleAlert, PlusCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AUDIT_CATEGORIES, type AuditComparisonResponse } from '@wi/shared';
import { DeltaBadge } from '../components/badges';
import { FindingCard } from '../components/FindingCard';
import { ScoreRing } from '../components/ScoreRing';
import { Button, buttonClasses, Card, ErrorState, Skeleton } from '../components/ui';
import { usePageTitle } from '../hooks/usePageTitle';
import { useRemote } from '../hooks/useRemote';
import { api } from '../services/api';
import { diffFindings, type CategorizedFinding } from '../utils/findings';
import { displayUrl, formatDateTime } from '../utils/format';
import { CATEGORY_META } from '../utils/meta';
import { TONE_BG, TONE_TEXT, scoreTone } from '../utils/score';

export default function ComparePage() {
  usePageTitle('Compare audits');
  const { a = '', b = '' } = useParams();

  const data = useRemote(
    (signal) => Promise.all([api.compare(a, b, signal), api.getReport(a, signal), api.getReport(b, signal)]).then(([cmp, ra, rb]) => ({ cmp, diff: diffFindings(ra, rb) })),
    [a, b],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link to="/history" className="text-sm font-semibold text-primary hover:underline">← My audits</Link>
      <h1 className="mb-8 mt-2 text-3xl font-extrabold">Compare audits</h1>

      {data.loading && !data.data ? (
        <div className="space-y-4" role="status" aria-label="Loading comparison"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
      ) : data.error ? (
        <ErrorState
          title={data.error.code === 'AUDIT_NOT_FINISHED' ? 'One of these audits is still running' : "We couldn't compare these audits"}
          action={data.error.retryable || data.error.code === 'AUDIT_NOT_FINISHED' ? <Button onClick={data.reload}>Try again</Button> : <Link to="/history" className={buttonClasses()}>Back to my audits</Link>}
        >
          {data.error.message}
        </ErrorState>
      ) : data.data ? (
        <Comparison cmp={data.data.cmp} diff={data.data.diff} />
      ) : null}
    </div>
  );
}

function Comparison({ cmp, diff }: { cmp: AuditComparisonResponse; diff: ReturnType<typeof diffFindings> }) {
  const { first, second } = cmp;
  return (
    <div className="space-y-8">
      {!cmp.sameSite && (
        <div role="note" className="flex gap-3 rounded-lg bg-fair-container px-4 py-3 text-sm text-fair">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><strong>These audits are of different websites</strong> ({displayUrl(first.normalizedUrl)} and {displayUrl(second.normalizedUrl)}), so changes may not reflect improvements.</p>
        </div>
      )}

      <Card as="section" className="grid items-center gap-6 p-6 sm:grid-cols-[1fr_auto_1fr]" aria-label="Overall score change">
        <AuditSide label="Earlier" audit={first} />
        <div className="flex flex-col items-center gap-2">
          <ArrowRight className="hidden size-6 text-outline sm:block" aria-hidden />
          <DeltaBadge delta={cmp.overallDelta} />
          <span className="text-xs text-on-surface-variant">overall</span>
        </div>
        <AuditSide label="Later" audit={second} />
      </Card>

      <section aria-labelledby="cat-h">
        <h2 id="cat-h" className="mb-3 text-xl font-extrabold">Category scores</h2>
        <Card className="divide-y divide-outline-variant/50">
          {AUDIT_CATEGORIES.map((c) => {
            const row = cmp.categories.find((x) => x.category === c) ?? { category: c, first: null, second: null, delta: null };
            const m = CATEGORY_META[c];
            return (
              <div key={c} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5" data-testid={`compare-${c}`}>
                <span className="flex w-40 items-center gap-2 font-bold"><m.icon className="size-4 text-primary" aria-hidden />{m.label}</span>
                <Bar score={row.first} label={`${m.label} earlier`} />
                <Bar score={row.second} label={`${m.label} later`} />
                <span className="w-28 text-right"><DeltaBadge delta={row.delta} /></span>
              </div>
            );
          })}
        </Card>
        <p className="mt-2 text-xs text-on-surface-variant">“n/a” means a category had no score in one of the audits, so it cannot be compared. It is never treated as 0.</p>
      </section>

      <section aria-labelledby="diff-h" className="space-y-6">
        <h2 id="diff-h" className="text-xl font-extrabold">What changed</h2>
        <DiffList icon={CheckCircle2} tone="text-good" title="Fixed" empty="No issues were resolved." items={diff.fixed} />
        <DiffList icon={PlusCircle} tone="text-poor" title="New issues" empty="No new issues appeared." items={diff.introduced} />
        <DiffList icon={CircleAlert} tone="text-fair" title="Still open" empty="No issues carried over." items={diff.persisting} />
        <p className="text-xs text-on-surface-variant">Only categories that were scored in both audits are included in this list.</p>
      </section>
    </div>
  );
}

function AuditSide({ label, audit }: { label: string; audit: AuditComparisonResponse['first'] }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">{label}</p>
      <ScoreRing score={audit.overallScore} size={104} strokeWidth={10} label={`${label} overall score`} />
      <p className="text-sm font-semibold">{formatDateTime(audit.createdAt)}</p>
      <Link to={`/audits/${audit.id}`} className="text-sm font-semibold text-primary hover:underline">Open report</Link>
    </div>
  );
}

function Bar({ score, label }: { score: number | null; label: string }) {
  const tone = scoreTone(score);
  return (
    <div className="flex min-w-24 flex-1 items-center gap-2" role="img" aria-label={`${label}: ${score === null ? 'not available' : score}`}>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-highest" aria-hidden>
        {score !== null && <span className={`block h-full rounded-full ${TONE_BG[tone]}`} style={{ width: `${score}%` }} />}
      </span>
      <span className={`w-8 text-right text-sm font-bold ${TONE_TEXT[tone]}`} aria-hidden>{score ?? 'n/a'}</span>
    </div>
  );
}

function DiffList({ icon: Icon, tone, title, items, empty }: { icon: typeof CheckCircle2; tone: string; title: string; items: CategorizedFinding[]; empty: string }) {
  return (
    <div>
      <h3 className={`mb-2 flex items-center gap-2 font-bold ${tone}`}><Icon className="size-5" aria-hidden />{title} <span className="text-on-surface-variant">({items.length})</span></h3>
      {items.length === 0 ? <p className="text-sm text-on-surface-variant">{empty}</p> : <div className="space-y-2">{items.map((f) => <FindingCard key={`${f.category}:${f.ruleId}`} finding={f} showCategory />)}</div>}
    </div>
  );
}
