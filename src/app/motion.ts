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

// A newer navigation or a viewport change can skip a running transition, and a
// page that is not rendering (say, a background tab) times it out. The DOM
// update still applies, so only those expected rejections are ignored.
function ignoreSkipped(error: unknown) {
  if (
    error instanceof DOMException &&
    ['AbortError', 'InvalidStateError', 'TimeoutError'].includes(error.name)
  )
    return;
  throw error;
}

let latest = 0;

/**
 * Run a synchronous DOM update as a view transition when supported. "route"
 * cross-fades the page; "local" keeps the page still so only named elements
 * (dialogs, moving positions) animate. The kind is exposed to CSS as
 * data-transition on the root element while the transition runs.
 */
function transition(kind: 'route' | 'local', update: () => void) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion() || doc.hidden) {
    update();
    return;
  }
  const root = document.documentElement;
  const id = ++latest;
  root.dataset.transition = kind;
  const done = () => {
    if (latest === id) delete root.dataset.transition;
  };
  try {
    const handle = doc.startViewTransition(update);
    handle.ready.catch(ignoreSkipped);
    handle.finished.catch(ignoreSkipped).finally(done);
  } catch {
    done();
    update();
  }
}

/** Animate a page change: the page cross-fades beneath a still shell. */
export const withViewTransition = (update: () => void) =>
  transition('route', update);

/** Animate an in-page change such as a dialog closing or a position moving. */
export const withLocalTransition = (update: () => void) =>
  transition('local', update);

export const scrollBehavior = (): ScrollBehavior =>
  prefersReducedMotion() ? 'instant' : 'smooth';
