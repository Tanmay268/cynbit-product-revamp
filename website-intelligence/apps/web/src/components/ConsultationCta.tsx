import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AuditReportResponse } from '@wi/shared';
import { flattenFindings, isIssue } from '../utils/findings';
import { buttonClasses } from './ui';

/** Report-end call to action. The pitch uses the real counts from this audit, nothing invented. */
export function ConsultationCta({ report }: { report: AuditReportResponse }) {
  const open = flattenFindings(report).filter(isIssue);
  const urgent = open.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
  const headline =
    open.length === 0
      ? 'Keep your site in shape'
      : urgent > 0
        ? `Fix the ${urgent} highest-impact ${urgent === 1 ? 'issue' : 'issues'} with an expert`
        : 'Want help with the remaining issues?';

  return (
    <section aria-labelledby="cta-h" className="no-print rounded-xl bg-primary px-6 py-8 text-on-primary sm:px-10">
      <h2 id="cta-h" className="text-2xl font-extrabold sm:text-3xl">{headline}</h2>
      <p className="mt-2 max-w-2xl text-on-primary/85">
        Book a free consultation and a Cynbit engineer will walk through this report with you and help you prioritise.
      </p>
      <Link to={`/consultation?website=${encodeURIComponent(report.normalizedUrl)}`} className={buttonClasses('secondary', 'lg', 'mt-5')}>
        Book a consultation <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}
