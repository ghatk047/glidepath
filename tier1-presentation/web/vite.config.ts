import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm --filter @glidepath/web build` writes dist/ (static bundle for the web image, ADR-009).
// The manifest lists every chunk; the build test and tier-check read it.
export default defineConfig({
  plugins: [react()],
  build: { manifest: true, outDir: 'dist' },
  server: { host: true },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
});
