import { ArrowRight, Compass } from 'lucide-react';
import type { Page } from '../app/router';
import PortalMark from '../components/PortalMark';

export default function NotFoundPage({
  path,
  onNavigate,
}: {
  path: string | null;
  onNavigate: (page: Page) => void;
}) {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <span className="not-found-mark" aria-hidden="true">
        <PortalMark size={72} />
      </span>
      <p className="eyebrow">
        <Compass size={13} aria-hidden="true" /> ROUTE NOT FOUND
      </p>
      <h1 id="not-found-title" className="page-title">
        This page slipped through the rift.
      </h1>
      <p className="page-lede">
        Nothing lives at <code>#{path ?? ''}</code>. It may have moved, or the
        link may be incomplete.
      </p>
      <div className="page-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => onNavigate('borrow')}
        >
          Go to Borrow <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => onNavigate('marketplace')}
        >
          Browse the marketplace
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={() => onNavigate('faq')}
        >
          Read the FAQ
        </button>
      </div>
    </section>
  );
}
