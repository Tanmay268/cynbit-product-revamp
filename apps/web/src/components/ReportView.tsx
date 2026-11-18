import type { AuditReportResponse } from '@wi/shared';
import { ConsultationCta } from './ConsultationCta';
import { FindingsExplorer } from './FindingsExplorer';
import { PriorityFixes } from './PriorityFixes';
import { ReportActions } from './ReportActions';
import { ReportDashboard } from './ReportDashboard';

/** The finished audit: dashboard, prioritised fixes, then a section per category with filterable findings. */
export function ReportView({ report }: { report: AuditReportResponse }) {
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1"><ReportDashboard report={report} /></div>
      </div>
      <ReportActions url={report.targetUrl} />
      <PriorityFixes report={report} />
      <FindingsExplorer report={report} />
      <ConsultationCta report={report} />
      <p className="text-xs text-on-surface-variant">
        Automated checks cover common, detectable issues only. Passing every check does not guarantee the site is accessible, secure or fully optimised.
      </p>
    </div>
  );
}
