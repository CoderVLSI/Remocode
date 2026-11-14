import { defineConfig } from 'vitest/config';

// Backend tests (convex-test) run in Vitest; app tests run in Jest (see package.json).
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex-tests/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
});
