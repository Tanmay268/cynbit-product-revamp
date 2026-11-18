import { ArrowRight, Globe } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { ApiRequestError } from '../services/api';
import { Button } from './ui';

/** Instant, friendly pre-checks. The server remains the authority (SSRF rules, DNS, ports…). */
export function validateUrlInput(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter a website URL, like example.com.';
  if (/\s/.test(v)) return 'A URL cannot contain spaces.';
  if (v.length > 2048) return 'That URL is too long.';
  return null;
}

interface Props {
  /** Starts the audit. Throw (ideally ApiRequestError) to show an error under the field. */
  onSubmit: (url: string) => Promise<void>;
  initialValue?: string;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}

export function UrlForm({ onSubmit, initialValue = '', size = 'lg', autoFocus }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const errorId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = validateUrlInput(value);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    try {
      await onSubmit(value.trim());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'We could not start the analysis. Please try again.');
      setPending(false);
    }
    // On success the parent navigates away, so `pending` intentionally stays true.
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full" aria-label="Analyze a website">
      <div className={`flex flex-col gap-3 rounded-[1.75rem] bg-surface-lowest p-2 shadow-card ring-1 sm:flex-row sm:items-center sm:rounded-full ${error ? 'ring-error' : 'ring-outline-variant focus-within:ring-2 focus-within:ring-primary'}`}>
        <label htmlFor="url-input" className="sr-only">Website URL</label>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
          <Globe className="size-5 shrink-0 text-outline" aria-hidden />
          <input
            id="url-input"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder="example.com"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            disabled={pending}
            className="min-h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-outline"
          />
        </div>
        <Button type="submit" size={size} loading={pending} className="sm:min-w-52">
          {pending ? 'Starting…' : <>Analyze Website <ArrowRight className="size-4" aria-hidden /></>}
        </Button>
      </div>
      <p id={errorId} role="alert" className={`mt-3 min-h-5 px-4 text-sm font-medium text-poor ${error ? '' : 'sr-only'}`}>
        {error}
      </p>
    </form>
  );
}
