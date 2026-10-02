import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type Props = {
  trigger: ReactNode;
  /** Accessible name for the trigger when its content is not descriptive. */
  triggerLabel?: string;
  title?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  className?: string;
  triggerClassName?: string;
};

/**
 * A disclosure popover: the trigger reports its expanded state, Escape and an
 * outside click close it, and focus returns to the trigger.
 */
export default function Popover({
  trigger,
  triggerLabel,
  title,
  children,
  align = 'end',
  className = '',
  triggerClassName = 'button ghost small',
}: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`popover-root ${className}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={id}
        aria-label={triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      <div
        id={id}
        className={`popover ${align}`}
        hidden={!open}
        role={title ? 'region' : undefined}
        aria-label={title}
      >
        {title && <p className="popover-title">{title}</p>}
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  );
}
