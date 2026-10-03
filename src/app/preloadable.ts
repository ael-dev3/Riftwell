import {
  createElement,
  lazy,
  type ComponentProps,
  type ComponentType,
  type ReactElement,
} from 'react';

// Any component type; props are recovered with ComponentProps below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

export type Preloadable<C extends AnyComponent> = ((
  props: ComponentProps<C>,
) => ReactElement) & { preload: () => Promise<unknown> };

/**
 * A code-split component that renders synchronously once preloaded, so a
 * warmed dialog or page never flashes a fallback or waits on Suspense.
 */
export function preloadable<C extends AnyComponent>(
  load: () => Promise<{ default: C }>,
): Preloadable<C> {
  let loaded: C | null = null;
  let pending: Promise<{ default: C }> | null = null;
  const preload = () =>
    (pending ??= load().then((module) => {
      loaded = module.default;
      return module;
    }));
  const Lazy = lazy(preload) as unknown as C;
  const Component = (props: ComponentProps<C>) =>
    createElement(loaded ?? Lazy, props);
  return Object.assign(Component, { preload });
}

/** Warm code-split chunks after the first view has painted. */
export function preloadWhenIdle(items: readonly { preload: () => unknown }[]) {
  const run = () => items.forEach((item) => void item.preload());
  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(run, { timeout: 2000 });
  else globalThis.setTimeout(run, 800);
}
