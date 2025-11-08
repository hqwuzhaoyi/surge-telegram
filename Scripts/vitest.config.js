import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.js'],
      exclude: ['vitest.config.js', '*.test.js', '*.spec.js']
    }
  }
});
