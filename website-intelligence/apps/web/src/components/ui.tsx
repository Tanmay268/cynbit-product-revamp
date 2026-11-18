import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

/** Shared by <Button> and by links styled as buttons (<Link className={buttonClasses(...)}>). */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 select-none';
  const sizes = { md: 'min-h-11 px-5 text-sm', lg: 'min-h-14 px-7 text-base' }[size];
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-container active:bg-primary',
    secondary: 'bg-surface-lowest text-primary ring-1 ring-inset ring-outline-variant hover:bg-surface-low',
    ghost: 'text-primary hover:bg-surface-container',
    danger: 'bg-poor-container text-on-error-container hover:bg-error-container',
  }[variant];
  return `${base} ${sizes} ${variants} ${extra}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({ variant, size, loading, icon: Icon, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClasses(variant, size, className)}>
      {loading ? <Loader2 className="spin size-4" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return <Loader2 className={`spin ${className}`} aria-hidden />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`pulse-soft rounded-md bg-surface-highest ${className}`} />;
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' | 'article' } & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>) {
  return (
    <Tag {...rest} className={`rounded-xl bg-surface-lowest shadow-card ring-1 ring-outline-variant/50 ${className}`}>
      {children}
    </Tag>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-outline-variant bg-surface-lowest px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary-fixed/50 text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <p className="text-sm text-on-surface-variant">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl bg-poor-container/60 px-6 py-10 text-center ring-1 ring-error/20">
      <AlertTriangle className="size-8 text-poor" aria-hidden />
      <h2 className="text-lg font-bold text-on-error-container">{title}</h2>
      {children && <p className="text-sm text-on-surface-variant">{children}</p>}
      {action}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children, center }: { eyebrow?: string; title: string; children?: ReactNode; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">{eyebrow}</p>}
      <h2 className="text-3xl font-extrabold sm:text-4xl">{title}</h2>
      {children && <p className="mt-3 text-base text-on-surface-variant">{children}</p>}
    </div>
  );
}
