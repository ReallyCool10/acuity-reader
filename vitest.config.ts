import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
