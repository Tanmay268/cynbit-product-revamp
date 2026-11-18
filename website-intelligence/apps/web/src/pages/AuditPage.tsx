import { FileQuestion } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ProcessingPanel } from '../components/ProcessingPanel';
import { ReportView } from '../components/ReportView';
import { Button, buttonClasses, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { useAuditStatus } from '../hooks/useAuditStatus';
import { usePageTitle } from '../hooks/usePageTitle';
import { useRemote } from '../hooks/useRemote';
import { api } from '../services/api';
import { displayUrl } from '../utils/format';
import { addToHistory } from '../utils/history';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AuditPage() {
  const { id = '' } = useParams();
  if (!UUID.test(id)) return <NotFound />;
  return <AuditPageInner id={id} />;
}

function NotFound() {
  usePageTitle('Audit not found');
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <EmptyState icon={FileQuestion} title="We can't find that audit" action={<Link to="/#analyze" className={buttonClasses()}>Start a new audit</Link>}>
        The link may be incomplete or mistyped.
      </EmptyState>
    </div>
  );
}

function AuditPageInner({ id }: { id: string }) {
  const { status, error, connectionIssue } = useAuditStatus(id);
  const finished = status?.status === 'completed' || status?.status === 'partial';
  const report = useRemote(finished ? (signal) => api.getReport(id, signal) : null, [id, finished]);

  usePageTitle(status ? `Audit of ${displayUrl(status.normalizedUrl)}` : 'Audit');
  // Opening an audit (including a shared link) adds it to this browser's "My audits".
  useEffect(() => {
    if (status) addToHistory(id);
  }, [id, status]);

  let body;
  if (error) {
    body =
      error.status === 404 ? (
        <EmptyState icon={FileQuestion} title="We can't find that audit" action={<Link to="/#analyze" className={buttonClasses()}>Start a new audit</Link>}>
          It may have been mistyped or removed.
        </EmptyState>
      ) : (
        <ErrorState title="We couldn't load this audit">{error.message}</ErrorState>
      );
  } else if (!status) {
    body = <LoadingSkeleton />;
  } else if (status.status === 'failed') {
    body = (
      <ErrorState title="This audit could not be completed" action={<Link to={`/?url=${encodeURIComponent(status.targetUrl)}#analyze`} className={buttonClasses('primary')}>Try again</Link>}>
        {status.errorMessage ?? 'Something went wrong while analyzing this website.'}
      </ErrorState>
    );
  } else if (finished) {
    body = report.error ? (
      <ErrorState title="We couldn't load the report" action={<Button onClick={report.reload}>Retry</Button>}>{report.error.message}</ErrorState>
    ) : report.data ? (
      <ReportView report={report.data} />
    ) : (
      <LoadingSkeleton />
    );
  } else {
    body = <ProcessingPanel status={status} connectionIssue={connectionIssue} />;
  }

  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">{body}</div>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading audit">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-56 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
