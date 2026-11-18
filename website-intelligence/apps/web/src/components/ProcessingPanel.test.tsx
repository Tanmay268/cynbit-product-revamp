import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeStatus } from '../test/fixtures';
import { ProcessingPanel } from './ProcessingPanel';

const withCategories = (map: Record<string, Partial<{ status: string; score: number | null; reason: string | null }>>) =>
  makeStatus().categories.map((c) => ({ ...c, ...(map[c.category] ?? {}) })) as never;

const row = (cat: string) => screen.getByTestId(`category-${cat}`);

describe('ProcessingPanel shows only what the backend reported', () => {
  it('a fresh audit shows every category as waiting and 0 of 5 finished', () => {
    render(<ProcessingPanel status={makeStatus({ status: 'queued', progress: { finished: 0, total: 5 } })} />);
    for (const c of ['performance', 'seo', 'accessibility', 'security', 'best-practices']) {
      expect(row(c)).toHaveAttribute('data-status', 'pending');
      expect(within(row(c)).getByText('Waiting to start')).toBeInTheDocument();
    }
    expect(screen.getByText('0 of 5 checks finished')).toBeInTheDocument();
    expect(screen.getByText(/waiting for an available worker/i)).toBeInTheDocument();
  });

  it('never shows a category as done before the backend says completed', () => {
    render(<ProcessingPanel status={makeStatus({ categories: withCategories({ seo: { status: 'running' } }), progress: { finished: 0, total: 5 } })} />);
    expect(within(row('seo')).getByText('Analyzing…')).toBeInTheDocument();
    expect(screen.queryByText(/^Done/)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting for an available worker/i)).not.toBeInTheDocument(); // something is running
  });

  it('progress bar equals the share of finished categories (no invented percentage)', () => {
    render(
      <ProcessingPanel
        status={makeStatus({
          progress: { finished: 2, total: 5 },
          categories: withCategories({ seo: { status: 'completed', score: 90 }, security: { status: 'unavailable', reason: 'Not configured' }, performance: { status: 'running' } }),
        })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 5 checks finished');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('shows completed scores, and unavailable/failed categories with their reasons and no score', () => {
    render(
      <ProcessingPanel
        status={makeStatus({
          progress: { finished: 3, total: 5 },
          categories: withCategories({
            seo: { status: 'completed', score: 90 },
            performance: { status: 'unavailable', reason: 'The PageSpeed Insights API key is not configured on the server.' },
            accessibility: { status: 'failed', reason: 'The page could not be loaded in the browser.' },
          }),
        })}
      />,
    );
    expect(within(row('seo')).getByText('Done · score 90')).toBeInTheDocument();
    expect(within(row('performance')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row('performance')).getByText(/API key is not configured/)).toBeInTheDocument();
    expect(within(row('accessibility')).getByText('Could not complete')).toBeInTheDocument();
    expect(within(row('performance')).queryByText(/score/i)).not.toBeInTheDocument();
  });

  it('tells the user when the connection is flaky, without claiming the audit stopped', () => {
    render(<ProcessingPanel status={makeStatus()} connectionIssue />);
    expect(screen.getByRole('status')).toHaveTextContent(/trouble reaching the server/i);
    expect(screen.getByRole('status')).toHaveTextContent(/keeps running/i);
  });

  it('shows the elapsed time since the audit was created', () => {
    const created = new Date('2026-11-17T10:00:00Z').getTime();
    render(<ProcessingPanel status={makeStatus({ createdAt: new Date(created).toISOString() })} now={() => created + 75_000} />);
    expect(screen.getByText(/Elapsed 1m 15s/)).toBeInTheDocument();
  });

  it('displays the analysed URL without the scheme', () => {
    render(<ProcessingPanel status={makeStatus({ normalizedUrl: 'https://shop.example.com/path' })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Analyzing shop.example.com/path');
  });
});
