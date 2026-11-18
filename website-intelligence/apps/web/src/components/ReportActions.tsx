import { Check, Link2, Printer, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { copyText } from '../utils/clipboard';
import { Button, buttonClasses } from './ui';

/** Opens every finding before printing so the PDF contains the full detail, then lets the browser save as PDF. */
export function printReport() {
  document.querySelectorAll('details').forEach((d) => (d.open = true));
  window.print();
}

export function ReportActions({ url }: { url: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return;
    const t = setTimeout(() => setCopied('idle'), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <Button variant="secondary" icon={copied === 'ok' ? Check : Link2} onClick={async () => setCopied((await copyText(window.location.href)) ? 'ok' : 'failed')}>
        {copied === 'ok' ? 'Link copied' : 'Copy report link'}
      </Button>
      <Button variant="secondary" icon={Printer} onClick={printReport}>Download PDF</Button>
      <Link to={`/?url=${encodeURIComponent(url)}#analyze`} className={buttonClasses('ghost')}>
        <RotateCw className="size-4" aria-hidden /> Run again
      </Link>
      <span role="status" aria-live="polite" className="text-sm font-medium text-fair">
        {copied === 'failed' ? 'Could not copy. Copy the address from your browser instead.' : ''}
      </span>
    </div>
  );
}
