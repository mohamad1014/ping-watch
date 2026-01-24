import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 0.0.0.0 --port 5173',
      cwd: '../frontend',
      port: 5173,
      reuseExistingServer: true,
      env: {
        VITE_POLL_INTERVAL_MS: '1000',
      },
    },
    {
      command: '../backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000',
      cwd: '../backend',
      port: 8000,
      reuseExistingServer: true,
    },
  ],
})
