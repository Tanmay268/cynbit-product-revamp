import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditComparisonResponse } from '@wi/shared';
import { ApiRequestError, api } from '../services/api';
import { ID_A, ID_B, makeReport, makeStatus } from '../test/fixtures';
import { loadHistory } from '../utils/history';
import AuditPage from './AuditPage';
import ComparePage from './ComparePage';
import HistoryPage from './HistoryPage';
import LandingPage from './LandingPage';

vi.mock('../services/api', async (orig) => {
  const actual = await orig<typeof import('../services/api')>();
  return { ...actual, api: { createAudit: vi.fn(), getStatus: vi.fn(), getReport: vi.fn(), listAudits: vi.fn(), compare: vi.fn() } };
});
const mocked = vi.mocked(api);

beforeEach(() => vi.resetAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/audits/:id" element={<AuditPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/compare/:a/:b" element={<ComparePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('landing page: submitting a URL', () => {
  it('starts an audit, remembers it in history, and navigates to its page', async () => {
    mocked.createAudit.mockResolvedValue({ id: ID_A, status: 'queued' });
    mocked.getStatus.mockResolvedValue(makeStatus({ status: 'queued', progress: { finished: 0, total: 5 } }));
    const user = userEvent.setup();
    renderAt('/');

    await user.type(screen.getByLabelText('Website URL'), 'example.com');
    await user.click(screen.getByRole('button', { name: /analyze website/i }));

    expect(mocked.createAudit).toHaveBeenCalledWith('example.com');
    expect(await screen.findByRole('heading', { level: 1, name: /Analyzing example\.com/ })).toBeInTheDocument();
    expect(loadHistory()).toEqual([ID_A]);
  });

  it('shows the API rejection (e.g. blocked address) and stays on the page', async () => {
    mocked.createAudit.mockRejectedValue(new ApiRequestError('That address is private or reserved, so it cannot be analyzed.', 'HOST_NOT_ALLOWED', 422));
    const user = userEvent.setup();
    renderAt('/');
    await user.type(screen.getByLabelText('Website URL'), '127.0.0.1');
    await user.click(screen.getByRole('button', { name: /analyze website/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('private or reserved');
    expect(loadHistory()).toEqual([]);
  });

  it('pre-fills the form from ?url= (the "Run again" link)', () => {
    renderAt('/?url=shop.example.com');
    expect(screen.getByLabelText('Website URL')).toHaveValue('shop.example.com');
  });

  it('contains the required sections: categories, how it works, sample report, FAQ', () => {
    renderAt('/');
    for (const name of [/Five areas, one clear picture/, /From URL to action plan/, /A report you can act on/, /Questions, answered/]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Sample · illustrative data/)).toBeInTheDocument(); // sample is clearly labelled
  });
});

describe('audit page', () => {
  it('shows the processing view while running, driven by the status endpoint', async () => {
    mocked.getStatus.mockResolvedValue(makeStatus({ status: 'running', progress: { finished: 1, total: 5 } }));
    renderAt(`/audits/${ID_A}`);
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(mocked.getReport).not.toHaveBeenCalled(); // no report is requested before completion
    expect(loadHistory()).toEqual([ID_A]); // opening a link adds it to my audits
  });

  it('loads and renders the report once the audit completes', async () => {
    mocked.getStatus.mockResolvedValue(makeStatus({ status: 'completed', progress: { finished: 5, total: 5 } }));
    mocked.getReport.mockResolvedValue(makeReport());
    renderAt(`/audits/${ID_A}`);
    expect(await screen.findByRole('heading', { name: /Fix these first/ })).toBeInTheDocument();
    expect(screen.getByTestId('stat-total-issues')).toHaveTextContent('4');
  });

  it('shows the safe failure message for a failed audit, with a retry link', async () => {
    mocked.getStatus.mockResolvedValue(makeStatus({ status: 'failed', errorMessage: 'That address is private or reserved, so it cannot be analyzed.', targetUrl: 'http://10.0.0.1' }));
    renderAt(`/audits/${ID_A}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('private or reserved');
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/?url=http%3A%2F%2F10.0.0.1#analyze');
  });

  it('shows a not-found state for unknown audits and for malformed ids (without calling the API)', async () => {
    mocked.getStatus.mockRejectedValue(new ApiRequestError('Audit not found', 'NOT_FOUND', 404));
    renderAt(`/audits/${ID_A}`);
    expect(await screen.findByText("We can't find that audit")).toBeInTheDocument();

    mocked.getStatus.mockClear();
    renderAt('/audits/not-a-uuid');
    expect(screen.getAllByText("We can't find that audit").length).toBeGreaterThan(0);
    expect(mocked.getStatus).not.toHaveBeenCalled();
  });

  it('offers a retry when the report fails to load', async () => {
    mocked.getStatus.mockResolvedValue(makeStatus({ status: 'completed' }));
    mocked.getReport.mockRejectedValueOnce(new ApiRequestError('We could not reach the server.', 'NETWORK', null)).mockResolvedValue(makeReport());
    const user = userEvent.setup();
    renderAt(`/audits/${ID_A}`);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: /Fix these first/ })).toBeInTheDocument();
  });
});

describe('history page', () => {
  const item = (id: string, created: string, score: number | null, status = 'completed') => ({ id, targetUrl: 'example.com', normalizedUrl: 'https://example.com', status: status as never, overallScore: score, createdAt: created, completedAt: created });

  it('shows an empty state without calling the API when there is no history', () => {
    renderAt('/history');
    expect(screen.getByText('No audits yet')).toBeInTheDocument();
    expect(mocked.listAudits).not.toHaveBeenCalled();
  });

  it('lists my audits by site, shows improvement vs the previous run, and compares two selected audits (older first)', async () => {
    localStorage.setItem('wi.audit-history.v1', JSON.stringify([ID_B, ID_A]));
    mocked.listAudits.mockResolvedValue({ items: [item(ID_B, '2026-11-18T10:00:00Z', 80), item(ID_A, '2026-11-17T10:00:00Z', 65)], page: 1, pageSize: 50, total: 2 });
    const user = userEvent.setup();
    renderAt('/history');

    const site = await screen.findByRole('region', { name: 'example.com' });
    expect(within(site).getByText(/since previous run/)).toBeInTheDocument();
    expect(within(site).getByText(/Improved by/)).toBeInTheDocument();
    expect(mocked.listAudits).toHaveBeenCalledWith([ID_B, ID_A], { pageSize: 50 }, expect.anything());

    const boxes = within(site).getAllByRole('checkbox');
    await user.click(boxes[0]!);
    expect(screen.getByRole('button', { name: /compare/i })).toBeDisabled(); // needs two
    await user.click(boxes[1]!);
    mocked.compare.mockResolvedValue({ first: makeStatus({ id: ID_A }), second: makeStatus({ id: ID_B }), sameSite: true, overallDelta: 15, categories: [] } as unknown as AuditComparisonResponse);
    mocked.getReport.mockResolvedValue(makeReport());
    await user.click(screen.getByRole('button', { name: /compare/i }));
    await waitFor(() => expect(mocked.compare).toHaveBeenCalledWith(ID_A, ID_B, expect.anything())); // older -> newer
  });

  it('does not let unfinished audits be selected for comparison', async () => {
    localStorage.setItem('wi.audit-history.v1', JSON.stringify([ID_A]));
    mocked.listAudits.mockResolvedValue({ items: [item(ID_A, '2026-11-17T10:00:00Z', null, 'running')], page: 1, pageSize: 50, total: 1 });
    renderAt('/history');
    expect(await screen.findByRole('checkbox')).toBeDisabled();
  });

  it('clears the local list after confirmation', async () => {
    localStorage.setItem('wi.audit-history.v1', JSON.stringify([ID_A]));
    mocked.listAudits.mockResolvedValue({ items: [item(ID_A, '2026-11-17T10:00:00Z', 70)], page: 1, pageSize: 50, total: 1 });
    const user = userEvent.setup();
    renderAt('/history');
    await user.click(await screen.findByRole('button', { name: /clear list/i }));
    await user.click(screen.getByRole('button', { name: /yes, clear/i }));
    expect(screen.getByText('No audits yet')).toBeInTheDocument();
    expect(loadHistory()).toEqual([]);
  });
});

describe('compare page', () => {
  const comparison = (over: Partial<AuditComparisonResponse> = {}): AuditComparisonResponse => ({
    first: makeStatus({ id: ID_A, status: 'completed', overallScore: 60, createdAt: '2026-11-17T10:00:00Z' }),
    second: makeStatus({ id: ID_B, status: 'completed', overallScore: 75, createdAt: '2026-11-18T10:00:00Z' }),
    sameSite: true,
    overallDelta: 15,
    categories: [
      { category: 'performance', first: 60, second: 75, delta: 15 },
      { category: 'seo', first: 80, second: 80, delta: 0 },
      { category: 'accessibility', first: 70, second: 50, delta: -20 },
      { category: 'security', first: null, second: 40, delta: null },
      { category: 'best-practices', first: 90, second: null, delta: null },
    ],
    ...over,
  });

  it('shows improvements, regressions, no-change and non-comparable categories distinctly', async () => {
    mocked.compare.mockResolvedValue(comparison());
    mocked.getReport.mockResolvedValue(makeReport());
    renderAt(`/compare/${ID_A}/${ID_B}`);
    await screen.findByRole('heading', { name: 'Category scores' });
    expect(within(screen.getByTestId('compare-performance')).getByText(/Improved by/)).toBeInTheDocument();
    expect(within(screen.getByTestId('compare-seo')).getByText(/No change/)).toBeInTheDocument();
    expect(within(screen.getByTestId('compare-accessibility')).getByText(/Regressed by/)).toBeInTheDocument();
    expect(within(screen.getByTestId('compare-security')).getByText('n/a', { selector: 'span.rounded-full' })).toBeInTheDocument();
    expect(within(screen.getByTestId('compare-best-practices')).getAllByText('n/a').length).toBeGreaterThan(0);
    expect(screen.queryByText(/different websites/)).not.toBeInTheDocument();
  });

  it('warns when the two audits are for different sites', async () => {
    mocked.compare.mockResolvedValue(comparison({ sameSite: false }));
    mocked.getReport.mockResolvedValue(makeReport());
    renderAt(`/compare/${ID_A}/${ID_B}`);
    expect(await screen.findByText(/different websites/)).toBeInTheDocument();
  });

  it('explains when an audit has not finished and offers to retry', async () => {
    mocked.compare.mockRejectedValue(new ApiRequestError('Both audits must have finished before they can be compared.', 'AUDIT_NOT_FINISHED', 409));
    mocked.getReport.mockResolvedValue(makeReport());
    renderAt(`/compare/${ID_A}/${ID_B}`);
    expect(await screen.findByText('One of these audits is still running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
