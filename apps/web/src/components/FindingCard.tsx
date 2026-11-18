import { ChevronDown } from 'lucide-react';
import type { Finding } from '@wi/shared';
import { CATEGORY_META } from '../utils/meta';
import type { CategorizedFinding } from '../utils/findings';
import { SeverityBadge, StatusBadge } from './badges';

/**
 * One finding. Native <details> gives keyboard + screen-reader support for free and lets the print
 * stylesheet expand everything for the PDF.
 *
 * SECURITY: title, description, evidence and recommendation can contain text taken from the audited
 * website (an attacker-controlled source). They are only ever rendered as React text nodes, never as HTML.
 */
export function FindingCard({ finding, showCategory }: { finding: Finding | CategorizedFinding; showCategory?: boolean }) {
  const category = 'category' in finding ? CATEGORY_META[finding.category].label : null;
  return (
    <details className="group rounded-lg bg-surface-lowest ring-1 ring-outline-variant/60 open:shadow-card" data-testid="finding" data-rule={finding.ruleId}>
      <summary className="flex min-h-14 items-start gap-3 rounded-lg px-4 py-3 hover:bg-surface-low">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <StatusBadge status={finding.status} />
          </div>
          <span className="min-w-0 break-words font-semibold">{finding.title}</span>
          {showCategory && category && <span className="text-xs font-semibold text-on-surface-variant sm:ml-auto">{category}</span>}
        </div>
        <ChevronDown className="mt-1 size-5 shrink-0 text-outline transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="space-y-4 border-t border-outline-variant/50 px-4 py-4 text-sm">
        <Block title="What we checked">{finding.description}</Block>

        {finding.evidence && (
          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-on-surface-variant">Evidence</h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inverse-surface p-3 font-mono text-xs leading-relaxed text-inverse-on-surface">{finding.evidence}</pre>
          </div>
        )}

        {finding.impact && <Block title="Why it matters">{finding.impact}</Block>}
        {finding.status !== 'passed' && <Block title="Recommended fix" accent>{finding.recommendation}</Block>}

        <p className="text-xs text-outline">
          Rule: <code className="font-mono">{finding.ruleId}</code>
        </p>
      </div>
    </details>
  );
}

function Block({ title, children, accent }: { title: string; children: string; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-md bg-primary-fixed/30 p-3' : ''}>
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-on-surface-variant">{title}</h4>
      <p className="whitespace-pre-line break-words">{children}</p>
    </div>
  );
}
