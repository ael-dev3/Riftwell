import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../app/motion';

type Props = {
  value: number;
  format: (value: number) => string;
  /** Exact text shown at rest and announced to assistive technology. */
  exact?: string;
  fromZero?: boolean;
  duration?: number;
};

const ease = (progress: number) => 1 - Math.pow(1 - progress, 3);

/**
 * Animates between values for sighted users while assistive technology and
 * the settled display always read the exact value.
 */
export default function CountUp({
  value,
  format,
  exact,
  fromZero = false,
  duration = 700,
}: Props) {
  const [display, setDisplay] = useState(() =>
    fromZero && !prefersReducedMotion() ? 0 : value,
  );
  const current = useRef(display);

  useEffect(() => {
    const start = current.current;
    if (start === value || prefersReducedMotion()) {
      current.current = value;
      setDisplay(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - began) / duration);
      const next =
        progress === 1 ? value : start + (value - start) * ease(progress);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  const settled = display === value;
  const finalText = exact ?? format(value);
  return (
    <span className="count-up" data-settled={settled}>
      <span aria-hidden="true">{settled ? finalText : format(display)}</span>
      <span className="sr-only">{finalText}</span>
    </span>
  );
}
