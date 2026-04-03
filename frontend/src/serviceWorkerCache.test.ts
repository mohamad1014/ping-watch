import { describe, expect, it } from 'vitest'

import {
  isAppShellRequest,
  resolveServiceWorkerAssets,
  SERVICE_WORKER_CACHE_NAME,
} from './serviceWorkerCache'

describe('service worker cache config', () => {
  it('bumps the cache name when the app-shell strategy changes', () => {
    expect(SERVICE_WORKER_CACHE_NAME).toBe('ping-watch-static-v2')
  })

  it('builds app-shell assets from the deployed base path', () => {
    expect(resolveServiceWorkerAssets('/ping-watch-staging')).toEqual([
      '/ping-watch-staging/',
      '/ping-watch-staging/index.html',
      '/ping-watch-staging/manifest.webmanifest',
      '/ping-watch-staging/pwa-icon-192.svg',
      '/ping-watch-staging/pwa-icon-512.svg',
    ])
  })
})

describe('isAppShellRequest', () => {
  it('treats navigations as network-first app-shell requests', () => {
    expect(
      isAppShellRequest(
        { method: 'GET', mode: 'navigate', destination: 'document' },
        'https://alhajj.nl/ping-watch-staging/',
        'https://alhajj.nl',
        '/ping-watch-staging/',
      )
    ).toBe(true)
  })

  it('treats same-origin index.html requests as app-shell requests', () => {
    expect(
      isAppShellRequest(
        { method: 'GET', mode: 'same-origin', destination: 'document' },
        'https://alhajj.nl/ping-watch-staging/index.html',
        'https://alhajj.nl',
        '/ping-watch-staging/',
      )
    ).toBe(true)
  })

  it('does not treat hashed assets as app-shell requests', () => {
    expect(
      isAppShellRequest(
        { method: 'GET', mode: 'same-origin', destination: 'script' },
        'https://alhajj.nl/ping-watch-staging/assets/index-D5hGNUTC.js',
        'https://alhajj.nl',
        '/ping-watch-staging/',
      )
    ).toBe(false)
  })
})
