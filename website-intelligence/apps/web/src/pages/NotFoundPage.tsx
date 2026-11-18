import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses, EmptyState } from '../components/ui';
import { usePageTitle } from '../hooks/usePageTitle';

export default function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <EmptyState icon={Compass} title="Page not found" action={<Link to="/" className={buttonClasses()}>Back to home</Link>}>
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}
