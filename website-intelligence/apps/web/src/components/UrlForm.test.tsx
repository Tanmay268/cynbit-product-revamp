import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../services/api';
import { UrlForm, validateUrlInput } from './UrlForm';

const setup = (onSubmit = vi.fn().mockResolvedValue(undefined), props = {}) => {
  render(<UrlForm onSubmit={onSubmit} {...props} />);
  return { onSubmit, user: userEvent.setup(), input: screen.getByLabelText('Website URL') as HTMLInputElement, button: screen.getByRole('button', { name: /analyze website/i }) };
};

describe('UrlForm', () => {
  it('submits the trimmed URL', async () => {
    const { onSubmit, user, input, button } = setup();
    await user.type(input, '  example.com  ');
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('example.com');
  });

  it('submits with the Enter key', async () => {
    const { onSubmit, user, input } = setup();
    await user.type(input, 'example.com{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('example.com');
  });

  it.each([
    ['', /enter a website url/i],
    ['   ', /enter a website url/i],
    ['exa mple.com', /cannot contain spaces/i],
    ['a'.repeat(2100), /too long/i],
  ])('shows a validation error for %j and does not call the API', async (value, message) => {
    const { onSubmit, user, input, button } = setup();
    if (value) await user.type(input, value.length > 100 ? value.slice(0, 1) : value);
    if (value.length > 100) {
      await user.clear(input);
      // paste a very long value quickly instead of typing 2k chars
      await user.click(input);
      await user.paste(value);
    }
    await user.click(button);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the server error message (e.g. a blocked private address) and re-enables the form', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiRequestError('That address is private or reserved, so it cannot be analyzed.', 'HOST_NOT_ALLOWED', 422));
    const { user, input, button } = setup(onSubmit);
    await user.type(input, 'http://localhost');
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('private or reserved');
    expect(input).toBeEnabled();
    expect(button).toBeEnabled();
  });

  it('falls back to a generic message for unexpected errors (no internals shown)', async () => {
    const { user, input, button } = setup(vi.fn().mockRejectedValue(new Error('ECONNREFUSED 10.0.0.1')));
    await user.type(input, 'example.com');
    await user.click(button);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not start the analysis/i);
    expect(alert).not.toHaveTextContent('10.0.0.1');
  });

  it('clears the error as soon as the user edits the field', async () => {
    const { user, input, button } = setup();
    await user.click(button);
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a website url/i);
    await user.type(input, 'a');
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('disables the form while submitting and ignores double submits', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { user, input, button } = setup(onSubmit);
    await user.type(input, 'example.com');
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(input).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
  });

  it('pre-fills from initialValue', () => {
    setup(undefined, { initialValue: 'prefilled.com' });
    expect(screen.getByLabelText('Website URL')).toHaveValue('prefilled.com');
  });
});

describe('validateUrlInput', () => {
  it('accepts plausible input and leaves real validation to the server', () => {
    for (const v of ['example.com', 'http://example.com', 'https://a.b.co/path?x=1', 'localhost']) expect(validateUrlInput(v)).toBeNull();
  });
});
