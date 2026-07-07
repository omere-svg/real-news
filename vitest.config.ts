import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.types.ts', 'src/main.ts'],
      // Measured 2026-07-07: 95.29% lines, 84.99% branches, 96.53% functions.
      // Thresholds set ~5pts below to gate regressions without flaking.
      thresholds: {
        lines: 90,
        branches: 80,
      },
    },
  },
});
