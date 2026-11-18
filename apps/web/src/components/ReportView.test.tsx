import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { category, finding, makeReport } from '../test/fixtures';
import { ReportView } from './ReportView';

const renderReport = (report = makeReport()) => render(<MemoryRouter><ReportView report={report} /></MemoryRouter>);
const stat = (name: string) => screen.getByTestId(`stat-${name}`);

describe('ReportView: dashboard', () => {
  it('shows the analyzed URL, timestamp, overall score and per-category scores', () => {
    renderReport();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('example.com');
    expect(screen.getByRole('link', { name: /example\.com/ })).toHaveAttribute('href', 'https://example.com/');
    expect(screen.getByRole('link', { name: /example\.com/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('img', { name: /Overall health: score 70 out of 100/ })).toBeInTheDocument();
    expect(screen.getByText(/based on 5 of 5 categories/)).toBeInTheDocument();
    for (const [label, score] of [['Performance', 72], ['SEO', 91], ['Accessibility', 64], ['Security', 48], ['Best Practices', 85]] as const) {
      expect(screen.getAllByRole('img', { name: new RegExp(`${label}: score ${score} out of 100`) }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('time')).toHaveAttribute('datetime', '2026-11-17T10:01:30.000Z');
  });

  it('counts issues, critical issues, warnings and passed checks (info findings are not issues)', () => {
    renderReport();
    // failed: lcp(high), image-alt(critical), csp(medium) = 3; warnings: meta-description = 1
    expect(stat('total-issues')).toHaveTextContent('4');
    expect(stat('critical-issues')).toHaveTextContent('1');
    expect(stat('warnings')).toHaveTextContent('1');
    // passed: cls, h1, scope-note, doctype
    expect(stat('passed-checks')).toHaveTextContent('4');
  });

  it('renders UNAVAILABLE categories as "N/A", never as 0, and excludes them from the overall basis', () => {
    const report = makeReport({
      status: 'partial',
      overallScore: 80,
      categories: makeReport().categories.map((c) =>
        c.category === 'performance' ? category('performance', { status: 'unavailable', score: null, reason: 'The PageSpeed Insights API key is not configured on the server.', findings: [] }) : c,
      ),
    });
    renderReport(report);

    expect(screen.getByText(/based on 4 of 5 categories/)).toBeInTheDocument();
    expect(screen.getByText('Partial report.').parentElement).toHaveTextContent(/Performance could not be scored/);
    expect(screen.getAllByRole('img', { name: /Performance: score not available/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: /Performance: score 0/ })).not.toBeInTheDocument();
    const section = document.getElementById('category-performance')!;
    expect(within(section).getByRole('note')).toHaveTextContent(/Not available.*API key is not configured.*excluded from the overall score/);
  });

  it('shows "no score" for the overall result when nothing could be scored', () => {
    renderReport(makeReport({ overallScore: null, status: 'partial', categories: makeReport().categories.map((c) => category(c.category, { status: 'failed', score: null, reason: 'x' })) }));
    expect(screen.getByText('No category could be scored.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Overall health: score not available/ })).toBeInTheDocument();
  });

  it('only links the URL when it is http(s) (stored data is not trusted)', () => {
    renderReport(makeReport({ targetUrl: 'javascript:alert(1)', normalizedUrl: 'javascript:alert(1)' }));
    expect(screen.getByRole('heading', { level: 1 }).querySelector('a')).toBeNull();
  });
});

describe('ReportView: prioritised fixes', () => {
  it('lists the highest-impact issues first, with category links', () => {
    renderReport();
    const list = screen.getByRole('heading', { name: /Fix these first/ }).closest('section')!;
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Images must have alternative text'); // critical
    expect(items.length).toBe(4); // 3 failed + 1 warning, no passed/info
    expect(within(items[0]!).getByRole('link', { name: 'Accessibility' })).toHaveAttribute('href', '#category-accessibility');
  });

  it('shows an affirmative empty state when there is nothing to fix', () => {
    renderReport(makeReport({ categories: makeReport().categories.map((c) => category(c.category, { findings: [finding({ status: 'passed', ruleId: `${c.category}.ok` })] })) }));
    expect(screen.getByText(/No outstanding issues/)).toBeInTheDocument();
  });
});

describe('ReportView: findings and filters', () => {
  const visibleRules = () => screen.queryAllByTestId('finding').map((el) => el.getAttribute('data-rule'));

  it('has a section per category with its summary counts', () => {
    renderReport();
    for (const c of ['performance', 'seo', 'accessibility', 'security', 'best-practices']) expect(document.getElementById(`category-${c}`)).toBeInTheDocument();
    expect(screen.getByTestId('summary-security')).toHaveTextContent('1 failed · 0 warnings · 0 passed');
  });

  it('defaults to showing issues only (failed + warning), most severe first within a category', () => {
    renderReport();
    expect(visibleRules()).toEqual(['performance.lcp', 'seo.meta-description', 'accessibility.image-alt', 'security.csp']);
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 4 of 8 findings');
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('radio', { name: 'Passed' }));
    expect(visibleRules()).toEqual(['performance.cls', 'seo.h1', 'security.scope-note', 'best-practices.doctype']);
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(visibleRules()).toHaveLength(8);
  });

  it('filters by severity (multi-select) and by category, and can be reset', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: 'Critical' }));
    expect(visibleRules()).toEqual(['accessibility.image-alt']);

    await user.click(screen.getByRole('button', { name: 'Medium' }));
    expect(visibleRules()).toEqual(['seo.meta-description', 'accessibility.image-alt', 'security.csp']);

    await user.click(screen.getByRole('button', { name: 'Security' }));
    expect(visibleRules()).toEqual(['security.csp']);
    expect(document.getElementById('category-performance')).not.toBeInTheDocument(); // other sections hidden

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(visibleRules()).toHaveLength(4);
  });

  it('shows an empty state when filters match nothing', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: 'Low' }));
    expect(screen.getAllByText('No findings match these filters').length).toBeGreaterThan(0);
  });

  it('exposes filter state to assistive technology', async () => {
    const user = userEvent.setup();
    renderReport();
    const critical = screen.getByRole('button', { name: 'Critical' });
    expect(critical).toHaveAttribute('aria-pressed', 'false');
    await user.click(critical);
    expect(critical).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: 'Issues' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows full detail for a finding: description, evidence, impact and recommended fix', () => {
    renderReport();
    const card = document.querySelector('[data-rule="accessibility.image-alt"]') as HTMLElement;
    expect(within(card).getByText('What we checked')).toBeInTheDocument();
    expect(within(card).getByText('Evidence')).toBeInTheDocument();
    expect(within(card).getByText('Why it matters')).toBeInTheDocument();
    expect(within(card).getByText('Recommended fix')).toBeInTheDocument();
    expect(within(card).getByText('accessibility.image-alt')).toBeInTheDocument();
    expect(within(card).getByText('Critical')).toBeInTheDocument();
  });

  it('expand all / collapse all toggles every finding', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(document.querySelectorAll('details[open]').length).toBe(4);
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(document.querySelectorAll('details[open]').length).toBe(0);
  });
});

describe('ReportView: untrusted content is never interpreted as HTML', () => {
  it('renders attacker-controlled text from the audited site as plain text', () => {
    const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const report = makeReport({
      categories: [
        category('seo', {
          findings: [finding({ ruleId: 'seo.xss', title: `Title ${payload}`, description: payload, evidence: payload, recommendation: payload, impact: payload })],
        }),
      ],
    });
    const { container } = renderReport(report);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // the literal characters are shown to the user instead
    expect(screen.getAllByText(/<img src=x onerror=/).length).toBeGreaterThan(0);
  });
});

describe('ReportView: actions', () => {
  it('copies the report link and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderReport();
    await user.click(screen.getByRole('button', { name: /copy report link/i }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole('button', { name: /link copied/i })).toBeInTheDocument();
  });

  it('tells the user when copying is not possible', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderReport();
    await user.click(screen.getByRole('button', { name: /copy report link/i }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  it('Download PDF expands every finding and opens the print dialog', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(window.print).toHaveBeenCalled();
    expect(document.querySelectorAll('details:not([open])').length).toBe(0);
  });

  it('"Run again" links back to the form with the URL pre-filled', () => {
    renderReport();
    expect(screen.getByRole('link', { name: /run again/i })).toHaveAttribute('href', '/?url=example.com#analyze');
  });
});
