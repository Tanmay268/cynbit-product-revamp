import { Mail, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from './Navbar';

/** Contact details are the ones published on cynbit.in. */
export const CONTACT = {
  email: 'opportunities@cynbit.in',
  phone: '+91 78912 09777',
  phoneHref: 'tel:+917891209777',
  address: ['32/115 Pratap Nagar, Jaipur', 'Rajasthan, 302033, India'],
  site: 'https://www.cynbit.in',
};

export function Footer() {
  return (
    <footer className="no-print mt-24 bg-inverse-surface text-inverse-on-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo inverted />
          <p className="max-w-sm text-sm text-inverse-on-surface/75">
            Independent, transparent website audits across performance, SEO, accessibility, security and best practices from Cynbit Technologies.
          </p>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-primary-fixed-dim">Product</h2>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:underline" to="/#analyze">Analyze a website</Link></li>
            <li><Link className="hover:underline" to="/history">My audits</Link></li>
            <li><Link className="hover:underline" to="/#how">How scoring works</Link></li>
            <li><Link className="hover:underline" to="/#faq">FAQ</Link></li>
            <li><Link className="hover:underline" to="/consultation">Book a consultation</Link></li>
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-primary-fixed-dim">Contact Cynbit</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0" aria-hidden /><a className="hover:underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
            <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0" aria-hidden /><a className="hover:underline" href={CONTACT.phoneHref}>{CONTACT.phone}</a></li>
            <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /><address className="not-italic">{CONTACT.address.map((l) => <span key={l} className="block">{l}</span>)}</address></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-inverse-on-surface/60">
        © {new Date().getFullYear()} Cynbit Technologies. Automated audits highlight common issues and are not a substitute for a professional review.
      </div>
    </footer>
  );
}
