import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // loadEnv also picks up inline VITE_* variables such as VITE_APP_MODE.
  const connected = loadEnv(mode, '.', 'VITE_').VITE_APP_MODE === 'connected';
  return {
    plugins: [react()],
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
