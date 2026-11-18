import { GitCompareArrows, History, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AuditListItem } from '@wi/shared';
import { DeltaBadge } from '../components/badges';
import { ScoreRing } from '../components/ScoreRing';
import { Button, buttonClasses, Card, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { usePageTitle } from '../hooks/usePageTitle';
import { useRemote } from '../hooks/useRemote';
import { api } from '../services/api';
import { formatDate, formatDateTime, displayUrl, plural } from '../utils/format';
import { canCompare, groupBySite, type SiteGroup } from '../utils/groups';
import { clearHistory, loadHistory } from '../utils/history';

const STATUS_LABEL: Record<AuditListItem['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
};

export default function HistoryPage() {
  usePageTitle('My audits');
  const navigate = useNavigate();
  const [ids, setIds] = useState(loadHistory);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const list = useRemote(ids.length > 0 ? (signal) => api.listAudits(ids, { pageSize: 50 }, signal) : null, [ids.join(',')]);
  const groups = useMemo(() => groupBySite(list.data?.items ?? []), [list.data]);
  const byId = useMemo(() => new Map((list.data?.items ?? []).map((a) => [a.id, a])), [list.data]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1]!, id] : [...s, id]));
  const compare = () => {
    const [a, b] = selected.map((id) => byId.get(id)!).sort((x, y) => x.createdAt.localeCompare(y.createdAt)); // older -> newer
    if (a && b) navigate(`/compare/${a.id}/${b.id}`);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">History</p>
          <h1 className="text-3xl font-extrabold">My audits</h1>
          <p className="mt-1 max-w-xl text-sm text-on-surface-variant">Audits started or opened in this browser. Pick two to see what improved or regressed.</p>
        </div>
        {ids.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">Clear this list? Reports stay available at their links.</span>
              <Button variant="danger" onClick={() => { clearHistory(); setIds([]); setSelected([]); setConfirmClear(false); }}>Yes, clear</Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="ghost" icon={Trash2} onClick={() => setConfirmClear(true)}>Clear list</Button>
          )
        )}
      </div>

      {ids.length === 0 ? (
        <EmptyState icon={History} title="No audits yet" action={<Link to="/#analyze" className={buttonClasses()}>Analyze a website</Link>}>
          Audits you run appear here so you can reopen them and track improvements over time. This list is stored only in this browser.
        </EmptyState>
      ) : list.loading && !list.data ? (
        <div className="space-y-4" role="status" aria-label="Loading your audits">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : list.error ? (
        <ErrorState title="We couldn't load your audits" action={<Button onClick={list.reload}>Retry</Button>}>{list.error.message}</ErrorState>
      ) : groups.length === 0 ? (
        <EmptyState icon={History} title="Those audits are no longer available" action={<Button onClick={() => { clearHistory(); setIds([]); }}>Clear list</Button>}>
          They may have been removed from the server.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => <SiteCard key={g.normalizedUrl} group={g} selected={selected} onToggle={toggle} />)}
        </div>
      )}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full bg-inverse-surface px-5 py-2.5 text-inverse-on-surface shadow-xl ring-1 ring-white/25" role="region" aria-label="Comparison">
          <span className="text-sm font-semibold">{selected.length} of 2 selected</span>
          <Button size="md" icon={GitCompareArrows} disabled={selected.length !== 2} onClick={compare}>Compare</Button>
          <Button variant="ghost" className="text-inverse-on-surface! hover:bg-white/10!" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}
    </div>
  );
}

function SiteCard({ group, selected, onToggle }: { group: SiteGroup; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <Card as="section" className="overflow-hidden" aria-label={displayUrl(group.normalizedUrl)}>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <ScoreRing score={group.latestScore} size={72} strokeWidth={8} label={`Latest score for ${displayUrl(group.normalizedUrl)}`} />
        <div className="min-w-0 flex-1">
          <h2 className="break-all text-lg font-extrabold">{displayUrl(group.normalizedUrl)}</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            {plural(group.audits.length, 'audit')}
            {group.delta !== null && <><span aria-hidden>·</span> since previous run <DeltaBadge delta={group.delta} /></>}
          </p>
        </div>
        {group.trend.length >= 2 && <Trend trend={group.trend} name={displayUrl(group.normalizedUrl)} />}
      </div>

      <ul className="divide-y divide-outline-variant/50 border-t border-outline-variant/50">
        {group.audits.map((a) => {
          const checked = selected.includes(a.id);
          const selectable = canCompare(a);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={checked}
                disabled={!selectable}
                onChange={() => onToggle(a.id)}
                aria-label={`Select the ${formatDateTime(a.createdAt)} audit of ${displayUrl(a.normalizedUrl)} for comparison`}
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{formatDateTime(a.createdAt)}</p>
                <p className="text-on-surface-variant">{STATUS_LABEL[a.status]}{a.status === 'partial' ? ' (some checks unavailable)' : ''}</p>
              </div>
              <span className="w-24 text-right text-sm">
                {a.overallScore !== null ? <><strong className="font-headline text-lg">{a.overallScore}</strong><span className="text-on-surface-variant"> / 100</span></> : <span className="text-on-surface-variant">No score</span>}
              </span>
              <Link to={`/audits/${a.id}`} className={buttonClasses('secondary')}>Open</Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Trend({ trend, name }: { trend: SiteGroup['trend']; name: string }) {
  const data = trend.map((t) => ({ date: formatDate(t.date), score: t.score }));
  return (
    <div role="img" aria-label={`Overall score trend for ${name}: ${data.map((d) => `${d.date} ${d.score}`).join(', ')}`} className="h-20 w-full sm:w-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="#ebeeee" />
          <XAxis dataKey="date" hide />
          <YAxis domain={[0, 100]} hide />
          <Tooltip formatter={(v: number) => [`${v}`, 'Score']} />
          <Line type="monotone" dataKey="score" stroke="#006067" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
