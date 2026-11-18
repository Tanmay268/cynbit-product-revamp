import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/api';
import ConsultationPage from './ConsultationPage';

const createLead = vi.hoisted(() => vi.fn());
vi.mock('../services/api', async (orig) => ({ ...(await orig<typeof import('../services/api')>()), api: { createLead } }));

const renderPage = (url = '/consultation') =>
  render(<MemoryRouter initialEntries={[url]}><ConsultationPage /></MemoryRouter>);

async function fillAndSend(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), 'Asha Verma');
  await user.type(screen.getByLabelText('Work email'), 'asha@example.com');
  await user.type(screen.getByLabelText('Company'), 'Example Ltd');
  await user.type(screen.getByLabelText('How can we help?'), 'We need help with accessibility.');
  await user.click(screen.getByRole('button', { name: /request consultation/i }));
}

describe('consultation page', () => {
  beforeEach(() => createLead.mockReset());

  it('prefills the website from the report link', () => {
    renderPage('/consultation?website=https%3A%2F%2Fexample.com');
    expect(screen.getByLabelText('Website')).toHaveValue('https://example.com');
  });

  it('shows a clear confirmation after a successful submission', async () => {
    createLead.mockResolvedValue({ received: true });
    const user = userEvent.setup();
    renderPage('/consultation?website=example.com');
    await fillAndSend(user);
    expect(await screen.findByRole('heading', { name: /request received/i })).toBeInTheDocument();
    expect(createLead).toHaveBeenCalledWith(expect.objectContaining({ email: 'asha@example.com', website: 'example.com' }));
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });

  it('stays on the form with the error when the server rejects the request', async () => {
    createLead.mockRejectedValueOnce(new ApiRequestError('Too many requests, please slow down', 'RATE_LIMITED', 429));
    const user = userEvent.setup();
    renderPage('/consultation?website=example.com');
    await fillAndSend(user);
    expect(await screen.findByText('Too many requests, please slow down')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /request received/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Company')).toHaveValue('Example Ltd');
    expect(createLead).toHaveBeenCalledTimes(1);
  });
});
