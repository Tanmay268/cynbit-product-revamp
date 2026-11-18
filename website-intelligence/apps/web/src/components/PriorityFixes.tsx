import { ListOrdered } from 'lucide-react';
import type { AuditReportResponse } from '@wi/shared';
import { flattenFindings, prioritize } from '../utils/findings';
import { CATEGORY_META } from '../utils/meta';
import { SeverityBadge } from './badges';
import { Card } from './ui';

/** The few issues where a fix would raise the score the most (same weights as the scoring formula). */
export function PriorityFixes({ report }: { report: AuditReportResponse }) {
  const top = prioritize(flattenFindings(report), 5);

  return (
    <Card as="section" className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-extrabold">
        <ListOrdered className="size-5 text-primary" aria-hidden /> Fix these first
      </h2>
      <p className="mt-1 text-sm text-on-surface-variant">Ranked by how much each fix would improve your scores.</p>

      {top.length === 0 ? (
        <p className="mt-4 rounded-lg bg-good-container px-4 py-3 text-sm font-medium text-good">
          No outstanding issues were found in the categories that could be analyzed.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {top.map((f, i) => (
            <li key={`${f.category}:${f.ruleId}`} className="flex gap-3 rounded-lg bg-surface-low p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-on-primary" aria-hidden>{i + 1}</span>
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-semibold">{f.title}</span>
                  <a href={`#category-${f.category}`} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">{CATEGORY_META[f.category].label}</a>
                </p>
                <p className="break-words text-sm text-on-surface-variant">{f.recommendation}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
