import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'info' | 'warning';
type Toast = { id: number; message: string; tone: ToastTone };
type ToastApi = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastApi>(() => {});
const DURATION_MS = 5200;
const icons = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
} as const;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION_MS);
  const started = useRef(0);

  useEffect(() => {
    if (paused) return;
    started.current = Date.now();
    const timer = window.setTimeout(
      () => onDismiss(toast.id),
      remaining.current,
    );
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started.current;
    };
  }, [paused, toast.id, onDismiss]);

  const Icon = icons[toast.tone];
  return (
    <div
      className={`toast ${toast.tone}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon size={18} aria-hidden="true" />
      <p>{toast.message}</p>
      <button
        className="icon-button ghost small"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={15} aria-hidden="true" />
      </button>
      <span
        className="toast-timer"
        aria-hidden="true"
        style={{
          animationDuration: `${DURATION_MS}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback(
    (id: number) =>
      setToasts((items) => items.filter((item) => item.id !== id)),
    [],
  );
  const push = useCallback<ToastApi>((message, tone = 'success') => {
    const id = nextId.current++;
    setToasts((items) => [...items.slice(-2), { id, message, tone }]);
  }, []);
  const api = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
