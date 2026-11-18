import { AlertCircle, ChevronsDownUp, ChevronsUpDown, FilterX, SearchX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { SEVERITIES, type AuditCategoryId, type AuditReportResponse, type Severity } from '@wi/shared';
import { applyFilters, compareFindings, DEFAULT_FILTERS, flattenFindings, type Filters, type StatusFilter } from '../utils/findings';
import { CATEGORY_META, SEVERITY_META } from '../utils/meta';
import { TONE_TEXT, scoreTone } from '../utils/score';
import { FindingCard } from './FindingCard';
import { ScoreRing } from './ScoreRing';
import { Button, Card } from './ui';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'issues', label: 'Issues' },
  { value: 'passed', label: 'Passed' },
  { value: 'all', label: 'All' },
];

export function FindingsExplorer({ report }: { report: AuditReportResponse }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const container = useRef<HTMLDivElement>(null);
  const all = useMemo(() => flattenFindings(report), [report]);
  const visible = useMemo(() => applyFilters(all, filters), [all, filters]);

  const setAll = (open: boolean) => container.current?.querySelectorAll('details').forEach((d) => (d.open = open));
  const toggleSeverity = (s: Severity) =>
    setFilters((f) => {
      const next = new Set(f.severities);
      if (!next.delete(s)) next.add(s);
      return { ...f, severities: next };
    });
  const isDefault = filters.category === 'all' && filters.severities.size === 0 && filters.status === 'issues';

  const sections = report.categories.filter((c) => filters.category === 'all' || c.category === filters.category);

  const chip = (active: boolean) =>
    `min-h-10 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors ${active ? 'bg-primary text-on-primary ring-primary' : 'bg-surface-lowest text-on-surface-variant ring-outline-variant hover:bg-surface-low'}`;

  return (
    <div ref={container} className="space-y-8">
      <Card as="section" className="no-print space-y-4 p-4 sm:p-5">
        <h2 className="text-lg font-extrabold">Findings</h2>

        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Category</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={filters.category === 'all'} className={chip(filters.category === 'all')} onClick={() => setFilters((f) => ({ ...f, category: 'all' }))}>
              All categories
            </button>
            {report.categories.map((c) => (
              <button key={c.category} type="button" aria-pressed={filters.category === c.category} className={chip(filters.category === c.category)} onClick={() => setFilters((f) => ({ ...f, category: c.category }))}>
                {CATEGORY_META[c.category].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Severity</legend>
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <button key={s} type="button" aria-pressed={filters.severities.has(s)} className={chip(filters.severities.has(s))} onClick={() => toggleSeverity(s)}>
                {SEVERITY_META[s].label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Status</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Issue status">
              {STATUS_OPTIONS.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={filters.status === o.value} className={chip(filters.status === o.value)} onClick={() => setFilters((f) => ({ ...f, status: o.value }))}>
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2 text-sm text-on-surface-variant" role="status" aria-live="polite">
              Showing <strong>{visible.length}</strong> of {all.length} findings
            </p>
            {!isDefault && <Button variant="ghost" icon={FilterX} onClick={() => setFilters(DEFAULT_FILTERS)}>Reset</Button>}
            <Button variant="secondary" icon={ChevronsUpDown} onClick={() => setAll(true)}>Expand all</Button>
            <Button variant="secondary" icon={ChevronsDownUp} onClick={() => setAll(false)}>Collapse all</Button>
          </div>
        </div>
      </Card>

      {sections.map((cat) => {
        const meta = CATEGORY_META[cat.category as AuditCategoryId];
        const Icon = meta.icon;
        const findings = visible.filter((f) => f.category === cat.category).sort(compareFindings);
        const tone = scoreTone(cat.score);
        return (
          <section key={cat.category} id={`category-${cat.category}`} aria-labelledby={`h-${cat.category}`} className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={cat.score} size={64} strokeWidth={7} label={meta.label} />
              <div className="min-w-0 flex-1">
                <h2 id={`h-${cat.category}`} className="flex items-center gap-2 text-xl font-extrabold">
                  <Icon className="size-5 text-primary" aria-hidden /> {meta.label}
                </h2>
                <p className="text-sm text-on-surface-variant">{meta.blurb}</p>
              </div>
              {cat.status === 'completed' && (
                <p className="text-sm text-on-surface-variant" data-testid={`summary-${cat.category}`}>
                  <strong className={TONE_TEXT[tone]}>{cat.summary.failed}</strong> failed · <strong>{cat.summary.warnings}</strong> warnings · <strong>{cat.summary.passed}</strong> passed
                </p>
              )}
            </div>

            {(cat.status === 'unavailable' || cat.status === 'failed') && (
              <div role="note" className="flex gap-3 rounded-lg bg-fair-container px-4 py-3 text-sm text-fair">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  <strong>{cat.status === 'unavailable' ? 'Not available' : 'Could not be completed'}.</strong> {cat.reason ?? 'This check did not produce a result.'}{' '}
                  This category has no score and is excluded from the overall score.
                </p>
              </div>
            )}

            {findings.length > 0 ? (
              <div className="space-y-2">
                {findings.map((f) => <FindingCard key={f.ruleId} finding={f} />)}
              </div>
            ) : (
              cat.status === 'completed' && (
                <p className="flex items-center gap-2 rounded-lg border border-dashed border-outline-variant bg-surface-lowest px-4 py-3 text-sm text-on-surface-variant">
                  <SearchX className="size-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="font-semibold">No findings match these filters</strong>
                    {all.some((f) => f.category === cat.category) ? '. Try changing the severity or status filter.' : '. Nothing to show for this category.'}
                  </span>
                </p>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
