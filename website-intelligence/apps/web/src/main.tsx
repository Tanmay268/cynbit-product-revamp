import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Skeleton } from './components/ui';
import { AppLayout } from './layouts/AppLayout';
import LandingPage from './pages/LandingPage';
import './index.css';

// Report-heavy pages (charts) are split out so the landing page stays light.
const AuditPage = lazy(() => import('./pages/AuditPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const ConsultationPage = lazy(() => import('./pages/ConsultationPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const fallback = (
  <div className="mx-auto max-w-6xl space-y-4 px-4 py-10 sm:px-6" role="status" aria-label="Loading">
    <Skeleton className="h-10 w-1/2" />
    <Skeleton className="h-56 w-full" />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={fallback}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<LandingPage />} />
            <Route path="audits/:id" element={<AuditPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="compare/:a/:b" element={<ComparePage />} />
            <Route path="consultation" element={<ConsultationPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
