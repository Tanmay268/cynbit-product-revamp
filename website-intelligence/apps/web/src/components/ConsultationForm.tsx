import { Send } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { createLeadSchema, type CreateLeadInput } from '@wi/shared';
import { ApiRequestError } from '../services/api';
import { Button } from './ui';

const FIELDS = ['name', 'email', 'company', 'website', 'message'] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

/** Same schema the API uses, so the form and server can never disagree. Returns per-field messages. */
export function validateLead(values: Values): { data: CreateLeadInput | null; errors: Errors } {
  const parsed = createLeadSchema.safeParse(values);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as Field;
    if (FIELDS.includes(key) && !errors[key]) errors[key] = issue.message;
  }
  return { data: null, errors };
}

interface Props {
  onSubmit: (lead: CreateLeadInput) => Promise<void>;
  initial?: Partial<Values>;
}

const INPUT =
  'min-h-12 w-full rounded-lg bg-surface-lowest px-4 text-base ring-1 ring-outline-variant outline-none placeholder:text-outline focus:ring-2 focus:ring-primary aria-[invalid=true]:ring-error';

export function ConsultationForm({ onSubmit, initial = {} }: Props) {
  const uid = useId();
  const [values, setValues] = useState<Values>({ name: '', email: '', company: '', website: '', message: '', ...initial });
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (f: Field) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [f]: e.target.value }));
    if (errors[f]) setErrors((x) => ({ ...x, [f]: undefined }));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const { data, errors: found } = validateLead(values);
    if (!data) {
      setErrors(found);
      setFormError(null);
      const first = FIELDS.find((f) => found[f]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await onSubmit({ ...data, hp });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Surface server-side field errors next to their inputs when the API sends them.
        const fieldErrors: Errors = {};
        for (const d of err.details) {
          const f = d.path.replace(/^body\./, '') as Field;
          if (FIELDS.includes(f)) fieldErrors[f] = d.message;
        }
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length ? 'Please fix the highlighted fields.' : err.message);
      } else {
        setFormError('We could not send your request. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  const field = (
    f: Exclude<Field, 'message'>,
    label: string,
    props: { type?: string; autoComplete?: string; placeholder?: string; inputMode?: 'email' | 'url' } = {},
  ) => {
    const id = `${uid}-${f}`;
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
        <input
          id={id}
          name={f}
          value={values[f]}
          onChange={set(f)}
          disabled={pending}
          aria-invalid={errors[f] ? true : undefined}
          aria-describedby={errors[f] ? `${id}-err` : undefined}
          autoCapitalize="none"
          className={INPUT}
          {...props}
        />
        {errors[f] && <p id={`${id}-err`} role="alert" className="mt-1.5 text-sm font-medium text-poor">{errors[f]}</p>}
      </div>
    );
  };

  const messageId = `${uid}-message`;
  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Request a consultation" className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {field('name', 'Full name', { autoComplete: 'name' })}
        {field('email', 'Work email', { type: 'email', autoComplete: 'email', inputMode: 'email', placeholder: 'you@company.com' })}
        {field('company', 'Company', { autoComplete: 'organization' })}
        {field('website', 'Website', { autoComplete: 'url', inputMode: 'url', placeholder: 'example.com' })}
      </div>
      <div>
        <label htmlFor={messageId} className="mb-1.5 block text-sm font-semibold">How can we help?</label>
        <textarea
          id={messageId}
          name="message"
          rows={5}
          value={values.message}
          onChange={set('message')}
          disabled={pending}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? `${messageId}-err` : undefined}
          className={`${INPUT} min-h-32 py-3`}
        />
        {errors.message && <p id={`${messageId}-err`} role="alert" className="mt-1.5 text-sm font-medium text-poor">{errors.message}</p>}
      </div>

      {/* Honeypot: invisible and unfocusable for people; bots that fill every input reveal themselves. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Leave this empty
          <input tabIndex={-1} autoComplete="off" name="hp" data-testid="hp" value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
      </div>

      {formError && <p role="alert" className="rounded-lg bg-poor-container px-4 py-3 text-sm font-medium text-on-error-container">{formError}</p>}

      <Button type="submit" size="lg" loading={pending} icon={pending ? undefined : Send} className="w-full sm:w-auto">
        {pending ? 'Sending…' : 'Request consultation'}
      </Button>
      <p className="text-xs text-on-surface-variant">We use these details only to reply to your request.</p>
    </form>
  );
}
