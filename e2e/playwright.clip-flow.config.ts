import { defineConfig } from '@playwright/test'
import { tmpdir } from 'os'
import path from 'path'

const frontendPort = 5180
const backendPort = 8001
const backendUrl = `http://127.0.0.1:${backendPort}`
const e2eDbPath = path.join(tmpdir(), `ping-watch-clip-flow-${process.pid}.db`)
const e2eDbUrl = `sqlite:///${e2eDbPath.replace(/\\/g, '/')}`
const localUploadDir = path.join(tmpdir(), `ping-watch-clip-flow-uploads-${process.pid}`)

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  testMatch: ['**/app.spec.ts'],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      cwd: '../frontend',
      port: frontendPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_URL: backendUrl,
        VITE_POLL_INTERVAL_MS: '1000',
        VITE_DISABLE_MEDIA: 'true',
      },
    },
    {
      command: `../backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: '../backend',
      port: backendPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL: e2eDbUrl,
        LOCAL_UPLOAD_DIR: localUploadDir,
        AZURITE_BLOB_ENDPOINT: '',
        AZURITE_ACCOUNT_NAME: '',
        AZURITE_ACCOUNT_KEY: '',
        AZURITE_AUTO_CREATE_CONTAINER: 'false',
      },
    },
  ],
})
