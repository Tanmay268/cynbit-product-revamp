import { AlertCircle, CheckCircle2, CircleDashed, Clock, WifiOff, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuditStatusResponse, CategoryStatusView } from '@wi/shared';
import { formatElapsed, displayUrl } from '../utils/format';
import { CATEGORY_META } from '../utils/meta';
import { TONE_TEXT, scoreTone } from '../utils/score';
import { Card, Spinner } from './ui';

function CategoryRow({ c }: { c: CategoryStatusView }) {
  const meta = CATEGORY_META[c.category];
  const Icon = meta.icon;

  const state = {
    pending: { icon: <CircleDashed className="size-5 text-outline" aria-hidden />, label: 'Waiting to start', cls: 'text-on-surface-variant' },
    running: { icon: <Spinner className="size-5 text-primary" />, label: 'Analyzing…', cls: 'text-primary' },
    completed: { icon: <CheckCircle2 className="size-5 text-good" aria-hidden />, label: c.score === null ? 'Done' : `Done · score ${c.score}`, cls: TONE_TEXT[scoreTone(c.score)] },
    unavailable: { icon: <AlertCircle className="size-5 text-fair" aria-hidden />, label: 'Unavailable', cls: 'text-fair' },
    failed: { icon: <XCircle className="size-5 text-poor" aria-hidden />, label: 'Could not complete', cls: 'text-poor' },
  }[c.status];

  return (
    <li className="flex items-start gap-4 px-4 py-4 sm:px-5" data-status={c.status} data-testid={`category-${c.category}`}>
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary-fixed/40 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{meta.label}</p>
        <p className={`text-sm font-semibold ${state.cls}`}>{state.label}</p>
        {(c.status === 'unavailable' || c.status === 'failed') && c.reason && <p className="mt-1 text-sm text-on-surface-variant">{c.reason}</p>}
      </div>
      <span className="mt-1 shrink-0" aria-hidden>{state.icon}</span>
    </li>
  );
}

interface Props {
  status: AuditStatusResponse;
  /** The status endpoint has failed several times in a row; we are still retrying. */
  connectionIssue?: boolean;
  now?: () => number;
}

export function ProcessingPanel({ status, connectionIssue, now = Date.now }: Props) {
  const [elapsed, setElapsed] = useState(() => now() - new Date(status.createdAt).getTime());
  useEffect(() => {
    const t = setInterval(() => setElapsed(now() - new Date(status.createdAt).getTime()), 1000);
    return () => clearInterval(t);
  }, [status.createdAt, now]);

  const { finished, total } = status.progress;
  const waitingForWorker = status.status === 'queued' && finished === 0 && !status.categories.some((c) => c.status === 'running');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Audit in progress</p>
        <h1 className="mt-2 break-words text-2xl font-extrabold sm:text-3xl">Analyzing {displayUrl(status.normalizedUrl)}</h1>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
          <Clock className="size-4" aria-hidden /> Elapsed {formatElapsed(elapsed)}
          {waitingForWorker && <span> · waiting for an available worker</span>}
        </p>
      </div>

      <Card className="p-5">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-semibold">{finished} of {total} checks finished</span>
          <span className="text-on-surface-variant">{Math.round((finished / Math.max(total, 1)) * 100)}%</span>
        </div>
        {/* Width is exactly the share of categories the backend has finished: no easing, no guessing. */}
        <div
          role="progressbar"
          aria-label="Checks finished"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={finished}
          aria-valuetext={`${finished} of ${total} checks finished`}
          className="h-2.5 overflow-hidden rounded-full bg-surface-highest"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(finished / Math.max(total, 1)) * 100}%` }} />
        </div>
      </Card>

      {connectionIssue && (
        <div role="status" className="flex items-center gap-3 rounded-lg bg-fair-container px-4 py-3 text-sm font-medium text-fair">
          <WifiOff className="size-4 shrink-0" aria-hidden /> We are having trouble reaching the server. Still trying, and your audit keeps running in the background.
        </div>
      )}

      <Card as="section" className="divide-y divide-outline-variant/50 overflow-hidden">
        <h2 className="sr-only">Progress by category</h2>
        <ul className="divide-y divide-outline-variant/50" aria-live="polite">
          {status.categories.map((c) => <CategoryRow key={c.category} c={c} />)}
        </ul>
      </Card>

      <p className="text-center text-sm text-on-surface-variant">
        You can leave this page. The audit keeps running and this link will show the report when it is ready.
      </p>
    </div>
  );
}
