import { normalizeBasePath } from './pwaPaths'

export const SERVICE_WORKER_CACHE_NAME = 'ping-watch-static-v2'

export const resolveServiceWorkerAssets = (basePath: string) => {
  const normalizedBasePath = normalizeBasePath(basePath)

  return [
    normalizedBasePath,
    `${normalizedBasePath}index.html`,
    `${normalizedBasePath}manifest.webmanifest`,
    `${normalizedBasePath}pwa-icon-192.svg`,
    `${normalizedBasePath}pwa-icon-512.svg`,
  ]
}

export const isAppShellRequest = (
  request: Pick<Request, 'method' | 'mode' | 'destination'>,
  requestUrl: string,
  origin: string,
  basePath: string,
) => {
  if (request.method !== 'GET') return false

  const normalizedBasePath = normalizeBasePath(basePath)
  const url = new URL(requestUrl)

  if (url.origin !== origin) return false
  if (request.mode === 'navigate') return true

  return request.destination === 'document'
    && (url.pathname === normalizedBasePath || url.pathname === `${normalizedBasePath}index.html`)
}
