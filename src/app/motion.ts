export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type ViewTransitionHandle = {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

// A newer navigation or a viewport change can skip a running transition. The
// DOM update still applies, so only those expected rejections are ignored.
function ignoreSkipped(error: unknown) {
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'InvalidStateError')
  )
    return;
  throw error;
}

/** Animate a synchronous DOM update when the browser supports view transitions. */
export function withViewTransition(update: () => void) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion() || doc.hidden) {
    update();
    return;
  }
  try {
    const transition = doc.startViewTransition(update);
    transition.ready.catch(ignoreSkipped);
    transition.finished.catch(ignoreSkipped);
  } catch {
    update();
  }
}

export const scrollBehavior = (): ScrollBehavior =>
  prefersReducedMotion() ? 'instant' : 'smooth';
