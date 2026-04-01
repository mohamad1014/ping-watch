import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const envAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const allowedHosts = [
  'localhost',
  '127.0.0.1',
  '.ngrok-free.dev',
  '.ngrok.io',
  ...envAllowedHosts,
]

const normalizeBasePath = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${withLeadingSlash.replace(/\/+$/, '')}/`
}

// https://vite.dev/config/
export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
  server: {
    allowedHosts,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
