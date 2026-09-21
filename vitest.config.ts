import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'threads',
    isolate: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
