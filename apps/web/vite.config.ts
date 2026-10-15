import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { devSecurityHeaders, previewSecurityHeaders } from './security-headers.ts';

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001';
const proxy = { '/api': { target: apiTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep the development proxy local; the API it reaches may expose session routes.
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, headers: devSecurityHeaders, cors: false },
  // Container deployments opt in to all interfaces with PREVIEW_HOST=0.0.0.0.
  preview: { host: process.env.PREVIEW_HOST ?? '127.0.0.1', port: 5173, strictPort: true, proxy, headers: previewSecurityHeaders, cors: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: true,
  },
});
