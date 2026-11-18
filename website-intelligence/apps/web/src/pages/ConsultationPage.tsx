import { CheckCircle2, Mail, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConsultationForm } from '../components/ConsultationForm';
import { CONTACT } from '../components/Footer';
import { Card, buttonClasses } from '../components/ui';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../services/api';

export default function ConsultationPage() {
  usePageTitle('Request a consultation');
  const [params] = useSearchParams();
  const [sent, setSent] = useState(false);
  const website = (params.get('website') ?? '').slice(0, 2048);

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Consultation</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Turn your audit into a plan</h1>
        <p className="mt-3 text-on-surface-variant">
          Tell us about your site and what you want to improve. A Cynbit engineer will review your audit findings with you and suggest where to start.
        </p>
        <ul className="mt-6 space-y-3 text-sm">
          <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><a className="hover:underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
          <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /><a className="hover:underline" href={CONTACT.phoneHref}>{CONTACT.phone}</a></li>
        </ul>
      </div>

      <Card className="p-5 sm:p-7">
        {sent ? (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-12 text-good" aria-hidden />
            <h2 className="text-2xl font-extrabold">Request received</h2>
            <p className="max-w-sm text-on-surface-variant">Thanks! We have your details and will get back to you by email.</p>
            <Link to="/" className={buttonClasses('secondary', 'md', 'mt-2')}>Back to home</Link>
          </div>
        ) : (
          <ConsultationForm
            initial={{ website }}
            onSubmit={async (lead) => {
              await api.createLead(lead);
              setSent(true);
            }}
          />
        )}
      </Card>
    </div>
  );
}
