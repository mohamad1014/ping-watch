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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
