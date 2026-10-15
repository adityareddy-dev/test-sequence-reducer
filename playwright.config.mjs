import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './fixtures',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  timeout: 10_000,
  reporter: 'line',
  outputDir: './artifacts/playwright',
});
