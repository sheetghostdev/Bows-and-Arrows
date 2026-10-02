import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // During `npm run dev`, online play talks to `wrangler dev` on :8787.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    // `npm test` = fast unit tests. `npm run e2e` = online tests against a running `npm run preview`.
    include: process.env.E2E ? ['e2e/**/*.test.ts'] : ['tests/**/*.test.ts'],
    testTimeout: 90_000,
  },
});
