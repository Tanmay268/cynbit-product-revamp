import { AlertOctagon, AlertTriangle, CheckCircle2, ExternalLink, ListChecks } from 'lucide-react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { AUDIT_CATEGORIES, type AuditReportResponse } from '@wi/shared';
import { computeStats, flattenFindings } from '../utils/findings';
import { displayUrl, formatDateTime, safeHref } from '../utils/format';
import { CATEGORY_META } from '../utils/meta';
import { TONE_LABEL, TONE_STROKE, TONE_TEXT, scoreTone } from '../utils/score';
import { ScoreRing } from './ScoreRing';
import { Card } from './ui';

function Stat({ icon: Icon, label, value, tone }: { icon: typeof ListChecks; label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-low p-4">
      <Icon className={`mb-2 size-5 ${tone ?? 'text-primary'}`} aria-hidden />
      <p className={`font-headline text-3xl font-extrabold ${tone ?? ''}`} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
      <p className="text-sm text-on-surface-variant">{label}</p>
    </div>
  );
}

export function ReportDashboard({ report }: { report: AuditReportResponse }) {
  const stats = computeStats(flattenFindings(report));
  const href = safeHref(report.targetUrl);
  const completed = report.categories.filter((c) => c.status === 'completed');
  const excluded = report.categories.filter((c) => c.status !== 'completed');
  const tone = scoreTone(report.overallScore);

  const chartData = AUDIT_CATEGORIES.map((c) => report.categories.find((x) => x.category === c)).filter((c) => c?.status === 'completed' && c.score !== null).map((c) => ({
    name: CATEGORY_META[c!.category].label,
    score: c!.score as number,
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Audit report</p>
        <h1 className="mt-1 break-all text-2xl font-extrabold sm:text-3xl">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:underline">
              {displayUrl(report.normalizedUrl)} <ExternalLink className="size-5 shrink-0 text-outline" aria-label="opens in a new tab" />
            </a>
          ) : (
            displayUrl(report.normalizedUrl)
          )}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Analyzed <time dateTime={report.completedAt ?? report.createdAt}>{formatDateTime(report.completedAt ?? report.createdAt)}</time>
        </p>
      </header>

      {report.status === 'partial' && (
        <div role="note" className="flex gap-3 rounded-lg bg-fair-container px-4 py-3 text-sm text-fair">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><strong>Partial report.</strong> {excluded.map((c) => CATEGORY_META[c.category].label).join(', ')} could not be scored and {excluded.length === 1 ? 'is' : 'are'} not included in the overall score.</p>
        </div>
      )}

      <Card as="section" className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2 text-center">
          <ScoreRing score={report.overallScore} size={168} strokeWidth={14} label="Overall health" />
          <p className={`text-sm font-bold ${TONE_TEXT[tone]}`}>{TONE_LABEL[tone]}</p>
          <p className="max-w-44 text-xs text-on-surface-variant">
            {report.overallScore === null ? 'No category could be scored.' : `Overall health · based on ${completed.length} of ${AUDIT_CATEGORIES.length} categories`}
          </p>
        </div>
        <div className="grid grid-cols-2 content-center gap-3 sm:grid-cols-4">
          <Stat icon={ListChecks} label="Total issues" value={stats.totalIssues} />
          <Stat icon={AlertOctagon} label="Critical issues" value={stats.critical} tone={stats.critical > 0 ? 'text-poor' : undefined} />
          <Stat icon={AlertTriangle} label="Warnings" value={stats.warnings} tone={stats.warnings > 0 ? 'text-fair' : undefined} />
          <Stat icon={CheckCircle2} label="Passed checks" value={stats.passed} tone="text-good" />
        </div>
      </Card>

      <section aria-labelledby="scores-h" className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 id="scores-h" className="mb-3 text-xl font-extrabold">Scores by category</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {report.categories.map((c) => {
              const m = CATEGORY_META[c.category];
              const Icon = m.icon;
              return (
                <li key={c.category}>
                  <a href={`#category-${c.category}`} className="flex items-center gap-3 rounded-xl bg-surface-lowest p-3 shadow-card ring-1 ring-outline-variant/50 transition-colors hover:bg-surface-low">
                    <ScoreRing score={c.status === 'completed' ? c.score : null} size={56} strokeWidth={6} label={m.label} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-bold"><Icon className="size-4 text-primary" aria-hidden />{m.label}</span>
                      <span className="block text-xs text-on-surface-variant">
                        {c.status === 'completed' ? `${c.summary.failed} failed · ${c.summary.warnings} warnings` : c.status === 'unavailable' ? 'Not available' : 'Could not complete'}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        <Card className="p-4 sm:p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-on-surface-variant">Score comparison</h2>
          {chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-on-surface-variant">No scored categories to chart.</p>
          ) : (
            <div role="img" aria-label={`Bar chart of category scores: ${chartData.map((d) => `${d.name} ${d.score}`).join(', ')}`} style={{ width: '100%', height: chartData.length * 52 + 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 13, fontWeight: 600 }} />
                  <Bar dataKey="score" radius={[0, 8, 8, 0]} barSize={22} background={{ fill: '#ebeeee', radius: 8 }} isAnimationActive={false}>
                    {chartData.map((d) => <Cell key={d.name} fill={TONE_STROKE[scoreTone(d.score)]} />)}
                    <LabelList dataKey="score" position="right" style={{ fontWeight: 700, fontSize: 13 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
