import { Menu, Radar, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { buttonClasses } from './ui';

const LINKS = [
  { to: '/#categories', label: 'What we check' },
  { to: '/#how', label: 'How it works' },
  { to: '/#sample', label: 'Sample report' },
  { to: '/#faq', label: 'FAQ' },
];

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${inverted ? 'text-inverse-on-surface' : ''}`} aria-label="Cynbit Website Intelligence, home">
      <span className={`grid size-9 place-items-center rounded-xl ${inverted ? 'bg-primary-fixed-dim text-primary' : 'bg-primary text-on-primary'}`}>
        <Radar className="size-5" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block font-headline text-lg font-extrabold tracking-tight">Cynbit</span>
        <span className={`block text-[0.65rem] font-semibold uppercase tracking-widest ${inverted ? 'text-inverse-on-surface/70' : 'text-on-surface-variant'}`}>Website Intelligence</span>
      </span>
    </Link>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const linkCls = 'rounded-full px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface';

  return (
    <header className="no-print sticky top-0 z-40 border-b border-outline-variant/50 bg-surface/85 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6" aria-label="Main">
        <Logo />

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className={linkCls}>{l.label}</Link>
          ))}
          <NavLink to="/history" className={({ isActive }) => `${linkCls} ${isActive ? 'bg-surface-container text-on-surface' : ''}`}>
            My audits
          </NavLink>
          <Link to="/#analyze" className={buttonClasses('secondary', 'md', 'ml-2')}>Analyze a website</Link>
          <Link to="/consultation" className={buttonClasses('primary', 'md')}>Book a consultation</Link>
        </div>

        <button
          type="button"
          className="grid size-11 place-items-center rounded-full hover:bg-surface-container md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-t border-outline-variant/50 bg-surface px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col">
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} onClick={close} className="rounded-lg px-3 py-3 font-semibold">{l.label}</Link>
            ))}
            <Link to="/history" onClick={close} className="rounded-lg px-3 py-3 font-semibold">My audits</Link>
            <Link to="/#analyze" onClick={close} className={buttonClasses('secondary', 'lg', 'mt-2')}>Analyze a website</Link>
            <Link to="/consultation" onClick={close} className={buttonClasses('primary', 'lg', 'mt-2')}>Book a consultation</Link>
          </div>
        </div>
      )}
    </header>
  );
}
