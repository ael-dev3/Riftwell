import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  count?: number;
};

type Props<T extends string> = {
  items: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
  variant?: 'band' | 'pill';
};

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** WAI-ARIA tabs with roving focus and a sliding indicator. */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
  idBase,
  variant = 'band',
}: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const update = () => {
      const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!list || !tab) return;
      list.style.setProperty('--indicator-x', `${tab.offsetLeft}px`);
      list.style.setProperty('--indicator-w', `${tab.offsetWidth}px`);
    };
    update();
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, items]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === active);
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    onChange(items[target].id);
    requestAnimationFrame(() =>
      document.getElementById(tabId(idBase, items[target].id))?.focus(),
    );
  }

  return (
    <div
      ref={listRef}
      className={`tablist ${variant}`}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          id={tabId(idBase, item.id)}
          className="tab"
          role="tab"
          type="button"
          aria-selected={item.id === active}
          aria-controls={
            item.id === active ? panelId(idBase, item.id) : undefined
          }
          tabIndex={item.id === active ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {/* The space keeps the accessible name readable, e.g. "Positions 2". */}
          {item.count !== undefined && item.count > 0 && (
            <>
              {' '}
              <span className="tab-count">{item.count}</span>
            </>
          )}
        </button>
      ))}
      <span className="tab-indicator" aria-hidden="true" />
    </div>
  );
}

export function TabPanel({
  idBase,
  id,
  children,
  className = '',
}: {
  idBase: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`tabpanel ${className}`}
      role="tabpanel"
      id={panelId(idBase, id)}
      aria-labelledby={tabId(idBase, id)}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
