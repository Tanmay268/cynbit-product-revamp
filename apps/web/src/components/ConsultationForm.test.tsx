import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/api';
import { ConsultationCta } from './ConsultationCta';
import { ConsultationForm, validateLead } from './ConsultationForm';
import { category, finding, makeReport } from '../test/fixtures';

const good = { name: 'Asha Verma', email: 'asha@example.com', company: 'Example Ltd', website: 'example.com', message: 'We need help with accessibility.' };

async function fill(user: ReturnType<typeof userEvent.setup>, v: Partial<typeof good> = {}) {
  const values = { ...good, ...v };
  await user.type(screen.getByLabelText('Full name'), values.name);
  await user.type(screen.getByLabelText('Work email'), values.email);
  await user.type(screen.getByLabelText('Company'), values.company);
  await user.type(screen.getByLabelText('Website'), values.website);
  await user.type(screen.getByLabelText('How can we help?'), values.message);
}

const setup = (onSubmit = vi.fn().mockResolvedValue(undefined), initial = {}) => {
  render(<ConsultationForm onSubmit={onSubmit} initial={initial} />);
  return { onSubmit, user: userEvent.setup(), submit: () => screen.getByRole('button', { name: /request consultation|sending/i }) };
};

describe('validateLead', () => {
  it('accepts valid input and normalises it', () => {
    const { data, errors } = validateLead({ ...good, email: ' Asha@Example.COM ', name: ' Asha Verma ' });
    expect(errors).toEqual({});
    expect(data).toMatchObject({ email: 'asha@example.com', name: 'Asha Verma' });
  });

  it.each([
    ['name', { name: 'A' }],
    ['email', { email: 'nope' }],
    ['company', { company: '' }],
    ['website', { website: 'not a url' }],
    ['message', { message: 'short' }],
  ])('flags %s', (field, patch) => {
    const { data, errors } = validateLead({ ...good, ...patch });
    expect(data).toBeNull();
    expect(Object.keys(errors)).toEqual([field]);
  });
});

describe('ConsultationForm', () => {
  it('submits trimmed, normalised values', async () => {
    const { onSubmit, user, submit } = setup();
    await fill(user, { name: '  Asha Verma ', email: 'Asha@Example.com' });
    await user.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: 'Asha Verma', email: 'asha@example.com', company: 'Example Ltd', website: 'example.com', hp: '' });
  });

  it('shows an error for every invalid field, focuses the first, and does not call the API', async () => {
    const { onSubmit, user, submit } = setup();
    await user.click(submit());
    expect(screen.getAllByRole('alert')).toHaveLength(5);
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Full name')).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a specific message for a bad email and clears it when the user edits the field', async () => {
    const { user, submit } = setup();
    await fill(user, { email: 'not-an-email' });
    await user.click(submit());
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
    await user.type(screen.getByLabelText('Work email'), '!');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prefills the website from the audit', () => {
    setup(undefined, { website: 'https://example.com' });
    expect(screen.getByLabelText('Website')).toHaveValue('https://example.com');
  });

  it('disables the form while sending to prevent double submits', async () => {
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { user, submit } = setup(onSubmit);
    await fill(user);
    await user.click(submit());
    expect(submit()).toBeDisabled();
    expect(screen.getByLabelText('Full name')).toBeDisabled();
    release();
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps what the user typed and shows the server message when the request fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiRequestError('Too many requests, please slow down', 'RATE_LIMITED', 429));
    const { user, submit } = setup(onSubmit);
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
    expect(screen.getByLabelText('Company')).toHaveValue('Example Ltd');
    expect(submit()).toBeEnabled();
  });

  it('places server-side field errors next to their inputs', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiRequestError('Request validation failed', 'BAD_REQUEST', 400, [{ path: 'body.email', message: 'Enter a valid email address' }]));
    const { user, submit } = setup(onSubmit);
    await fill(user);
    await user.click(submit());
    await waitFor(() => expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Please fix the highlighted fields.')).toBeInTheDocument();
  });

  it('never exposes internals for unexpected errors', async () => {
    const { user, submit } = setup(vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5')));
    await fill(user);
    await user.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not send/i);
    expect(alert).not.toHaveTextContent('10.0.0.5');
  });

  it('sends the honeypot value only if something filled it, and hides it from assistive tech', async () => {
    const { onSubmit, user, submit } = setup();
    const hp = screen.getByTestId('hp');
    expect(hp.closest('[aria-hidden]')).not.toBeNull();
    expect(hp).toHaveAttribute('tabindex', '-1');
    await fill(user);
    await user.type(hp, 'bot');
    await user.click(submit());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].hp).toBe('bot');
  });
});

describe('ConsultationCta', () => {
  const view = (report: ReturnType<typeof makeReport>) =>
    render(<MemoryRouter><ConsultationCta report={report} /></MemoryRouter>);

  it('uses the real number of high-impact issues and prefills the audited site', () => {
    const report = makeReport();
    view(report);
    const link = screen.getByRole('link', { name: /book a consultation/i });
    expect(link.getAttribute('href')).toBe(`/consultation?website=${encodeURIComponent(report.normalizedUrl)}`);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/highest-impact issue/);
  });

  it('does not claim urgent issues when there are none', () => {
    const report = makeReport();
    report.categories = [category('seo', { findings: [finding({ severity: 'low', status: 'warning' })] })];
    view(report);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Want help with the remaining issues?');
  });
});
