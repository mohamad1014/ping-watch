const ensureLeadingSlash = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`

export const normalizeBasePath = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  const normalized = ensureLeadingSlash(trimmed).replace(/\/+$/, '')
  return `${normalized}/`
}

export const resolveServiceWorkerUrl = (basePath: string | undefined): string =>
  `${normalizeBasePath(basePath)}sw.js`
