import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/live-flow.spec.ts'],
  timeout: 60_000,
  use: {
    trace: 'on-first-retry',
  },
})
