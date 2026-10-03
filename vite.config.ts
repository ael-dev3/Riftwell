import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** A separate API origin, as bearer sessions use; a relative base is the page's own. */
function apiOrigin(base: string | undefined): string | null {
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * The policy the connected service and firebase.json also send as headers.
 * Static hosts such as GitHub Pages cannot set response headers, so production
 * builds carry it in a meta tag too. frame-ancestors and
 * upgrade-insecure-requests stay with the headers: a meta tag cannot carry the
 * first, and the second would break local HTTP previews.
 */
export function contentSecurityPolicy(apiBase?: string) {
  const api = apiOrigin(apiBase);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
  ].join('; ');
}

/** Build-only, so Vite's inline development scripts keep working. */
function securityMeta(policy: string): Plugin {
  return {
    name: 'riftwell-security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
      {
        tag: 'meta',
        attrs: { name: 'referrer', content: 'same-origin' },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  // loadEnv also picks up inline VITE_* variables such as VITE_APP_MODE.
  const env = loadEnv(mode, '.', 'VITE_');
  const connected = env.VITE_APP_MODE === 'connected';
  return {
    plugins: [
      react(),
      securityMeta(
        contentSecurityPolicy(connected ? env.VITE_API_BASE : undefined),
      ),
    ],
    resolve: {
      alias: {
        '@app-root': connected
          ? '/src/connected/ConnectedApp.tsx'
          : '/src/App.tsx',
      },
    },
    build: { target: 'es2022' },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
