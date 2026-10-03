import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  title: string;
  kicker?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Slide in from the side as a navigation sheet. */
  sheet?: boolean;
  className?: string;
};
const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export default function Dialog({
  title,
  kicker,
  children,
  onClose,
  wide = false,
  sheet = false,
  className = '',
}: Props) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const oldOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert ?? false;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !panel) return;
      const elements = Array.from(
        panel.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (
        panel &&
        event.target instanceof Node &&
        !panel.contains(event.target)
      )
        panel.querySelector<HTMLElement>(focusableSelector)?.focus();
    };
    document.addEventListener('keydown', handleKeys);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.body.style.overflow = oldOverflow;
      if (appRoot) appRoot.inert = wasInert;
      document.removeEventListener('keydown', handleKeys);
      document.removeEventListener('focusin', containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div
      className={`dialog-backdrop${sheet ? ' sheet' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`dialog-panel${wide ? ' wide' : ''}${sheet ? ' sheet' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="dialog-header">
          <div>
            {kicker && <p className="dialog-kicker">{kicker}</p>}
            <h2 className="dialog-title" id={headingId}>
              {title}
            </h2>
          </div>
          <button
            className="button icon-button ghost"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
