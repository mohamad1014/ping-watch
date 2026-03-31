import { describe, expect, it } from 'vitest'

import { normalizeBasePath, resolveServiceWorkerUrl } from './pwaPaths'

describe('normalizeBasePath', () => {
  it('defaults to root for empty values', () => {
    expect(normalizeBasePath(undefined)).toBe('/')
    expect(normalizeBasePath('')).toBe('/')
    expect(normalizeBasePath('/')).toBe('/')
  })

  it('normalizes nested path deployments', () => {
    expect(normalizeBasePath('/ping-watch')).toBe('/ping-watch/')
    expect(normalizeBasePath('/ping-watch/')).toBe('/ping-watch/')
    expect(normalizeBasePath('ping-watch-staging')).toBe('/ping-watch-staging/')
  })
})

describe('resolveServiceWorkerUrl', () => {
  it('builds the service worker path from the app base path', () => {
    expect(resolveServiceWorkerUrl('/')).toBe('/sw.js')
    expect(resolveServiceWorkerUrl('/ping-watch/')).toBe('/ping-watch/sw.js')
    expect(resolveServiceWorkerUrl('/ping-watch-staging')).toBe('/ping-watch-staging/sw.js')
  })
})
