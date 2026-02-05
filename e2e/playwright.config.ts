import { defineConfig } from '@playwright/test'
import { tmpdir } from 'os'
import path from 'path'

const e2eDbPath = path.join(tmpdir(), `ping-watch-e2e-${process.pid}.db`)
const e2eDbUrl = `sqlite:///${e2eDbPath.replace(/\\/g, '/')}`

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      cwd: '../frontend',
      port: 5173,
      reuseExistingServer: true,
      env: {
        VITE_POLL_INTERVAL_MS: '1000',
        VITE_DISABLE_MEDIA: 'true',
      },
    },
    {
      command:
        '../backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '../backend',
      port: 8000,
      reuseExistingServer: true,
      env: {
        DATABASE_URL: e2eDbUrl,
      },
    },
  ],
})
