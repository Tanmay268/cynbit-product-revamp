import { ChevronDown, FileSearch, ListChecks, Scale, ShieldCheck, TextCursorInput, Eye, Workflow } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AUDIT_CATEGORIES } from '@wi/shared';
import { SampleReport } from '../components/SampleReport';
import { Card, SectionHeading } from '../components/ui';
import { UrlForm } from '../components/UrlForm';
import { usePageTitle } from '../hooks/usePageTitle';
import { useStartAudit } from '../hooks/useStartAudit';
import { CATEGORY_META } from '../utils/meta';

const STEPS = [
  { icon: TextCursorInput, title: 'Enter a URL', body: 'Paste any public website address. No account or signup is needed.' },
  { icon: Workflow, title: 'Five checks run independently', body: 'Performance, SEO, accessibility, security and best practices run side by side, and you see each one finish.' },
  { icon: ListChecks, title: 'Get a prioritized report', body: 'Scores, evidence for every finding, why it matters, and the fixes ranked by impact.' },
];

const BENEFITS = [
  { icon: Scale, title: 'Transparent scoring', body: 'Every score comes from a published formula: severity-weighted checks, with the weights shown in the report.' },
  { icon: Eye, title: 'Honest about gaps', body: 'If a check cannot run, it says so. An unavailable category is never shown as a zero or quietly averaged in.' },
  { icon: FileSearch, title: 'Evidence, not opinions', body: 'Each finding shows what was seen on your page, why it matters and exactly how to fix it.' },
  { icon: ShieldCheck, title: 'Safe by design', body: 'Private, internal and reserved addresses are blocked, and every request is validated and size-limited.' },
];

const FAQ = [
  { q: 'What does the audit check?', a: 'Five areas: performance (Google PageSpeed Insights), SEO, accessibility (axe-core in a real browser), security headers and HTTPS, and general web best practices.' },
  { q: 'Is it free? Do I need an account?', a: 'It is free and needs no account. Your recent audits are remembered in this browser so you can reopen and compare them.' },
  { q: 'Will it affect my website?', a: 'The analysis makes a small number of ordinary page requests (a sample of links and assets, not a crawl) and loads the page once in a browser. It does not log in, submit forms or change anything.' },
  { q: 'Why is a category sometimes unavailable?', a: 'Some checks depend on outside services or a browser. If one cannot run, we mark it unavailable and leave it out of the overall score instead of guessing.' },
  { q: 'Can I audit a staging, localhost or intranet site?', a: 'No. Only public websites on standard web ports can be analyzed. Private and internal addresses are blocked on purpose to protect everyone.' },
  { q: 'How reliable is an automated audit?', a: 'It reliably catches common, detectable problems, but it cannot find everything. For example, automated tools detect only part of all accessibility issues. Treat it as a strong starting point, not a certification.' },
];

export default function LandingPage() {
  usePageTitle('Audit any website');
  const start = useStartAudit();
  const [params] = useSearchParams();

  return (
    <>
      <section id="analyze" className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-primary-fixed/40 via-surface to-surface" />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-surface-lowest px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary ring-1 ring-outline-variant">
              Website Intelligence by Cynbit
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.1] sm:text-5xl lg:text-6xl">
              See exactly how healthy your website is.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-on-surface-variant">
              Get a complete technical audit covering performance, SEO, accessibility, security and best practices, with evidence and a prioritized fix list.
            </p>
            <div className="mt-8 max-w-2xl">
              <UrlForm onSubmit={start} initialValue={params.get('url') ?? ''} autoFocus={params.has('url')} />
              <p className="mt-3 px-4 text-sm text-on-surface-variant">Free, no signup. Results appear as each check finishes.</p>
            </div>
          </div>

          <Card className="p-6" aria-label="What is checked">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-on-surface-variant">Every audit covers</h2>
            <ul className="space-y-4">
              {AUDIT_CATEGORIES.map((c) => {
                const m = CATEGORY_META[c];
                return (
                  <li key={c} className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-fixed/40 text-primary"><m.icon className="size-5" aria-hidden /></span>
                    <span>
                      <span className="block font-bold">{m.label}</span>
                      <span className="block text-sm text-on-surface-variant">{m.blurb}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </section>

      <section id="categories" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="What we check" title="Five areas, one clear picture">
          Each area is analyzed on its own, so a problem in one never hides the results of the others.
        </SectionHeading>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIT_CATEGORIES.map((c) => {
            const m = CATEGORY_META[c];
            return (
              <Card key={c} as="article" className="p-6">
                <span className="mb-4 grid size-12 place-items-center rounded-xl bg-primary text-on-primary"><m.icon className="size-6" aria-hidden /></span>
                <h3 className="text-lg font-extrabold">{m.label}</h3>
                <p className="mt-1 text-sm text-on-surface-variant">{m.blurb}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {m.measures.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />{x}</li>)}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="how" className="bg-surface-low py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From URL to action plan in three steps" center />
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl bg-surface-lowest p-6 shadow-card ring-1 ring-outline-variant/50">
                <span className="absolute right-5 top-4 font-headline text-5xl font-extrabold text-surface-highest" aria-hidden>{i + 1}</span>
                <s.icon className="mb-4 size-7 text-primary" aria-hidden />
                <h3 className="text-lg font-extrabold">{s.title}</h3>
                <p className="mt-2 text-sm text-on-surface-variant">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="sample" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <SectionHeading eyebrow="Sample report" title="A report you can act on">
            Scores at a glance, then every finding with its evidence, why it matters and the recommended fix. Share the link or save it as a PDF.
          </SectionHeading>
          <SampleReport />
        </div>
      </section>

      <section id="why" className="bg-surface-low py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Why trust it" title="Built to be straight with you" center />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b) => (
              <Card key={b.title} as="article" className="p-6">
                <b.icon className="mb-3 size-6 text-primary" aria-hidden />
                <h3 className="font-extrabold">{b.title}</h3>
                <p className="mt-2 text-sm text-on-surface-variant">{b.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" center />
        <div className="mt-8 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-xl bg-surface-lowest shadow-card ring-1 ring-outline-variant/50">
              <summary className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-5 py-3 font-bold hover:bg-surface-low">
                {f.q}
                <ChevronDown className="size-5 shrink-0 text-outline transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 text-on-surface-variant">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
