import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Footer } from '../components/Footer';
import { Navbar } from '../components/Navbar';

/** React Router does not scroll to #fragments by itself. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      // wait a frame so lazily-rendered sections exist
      const t = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' }));
      return () => cancelAnimationFrame(t);
    }
    window.scrollTo?.(0, 0);
  }, [pathname, hash]);
  return null;
}

export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="no-print sr-only z-50 rounded-full bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to main content
      </a>
      <ScrollManager />
      <Navbar />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
