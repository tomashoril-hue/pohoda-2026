const CACHE_VERSION = 'pohoda-pass-offline-v4'
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

const OFFLINE_START_PATHS = ['/', '/login']
const OFFLINE_AUTH_FALLBACK_PATHS = [
  '/dashboard',
  '/dashboard/vydaj-stravy',
  '/dashboard/qr',
  '/menu',
  '/dashboard/naroky',
  '/dashboard/offline-rezim'
]

const APP_SHELL_URLS = [
  '/install',
  '/offline',
  '/manifest.webmanifest',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/icon.png',
  '/apple-icon.png'
]

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/logout'
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2')
  )
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => !cacheName.startsWith(CACHE_VERSION))
            .map(cacheName => caches.delete(cacheName))
        )
      })
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (!isSameOrigin(url) || isApiRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  if (isStaticAsset(url) || APP_SHELL_URLS.includes(url.pathname)) {
    event.respondWith(handleStaticAsset(request))
  }
})

async function handleNavigation(request) {
  const requestUrl = new URL(request.url)

  try {
    const response = await fetch(request)

    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      cache.put(request, response.clone()).catch(() => undefined)
    }

    return response
  } catch {
    if (OFFLINE_START_PATHS.includes(requestUrl.pathname)) {
      const cachedAuthPage = await findCachedNavigationByPath(OFFLINE_AUTH_FALLBACK_PATHS)
      if (cachedAuthPage) return cachedAuthPage
    }

    const cachedPage = await caches.match(request)
    if (cachedPage) return cachedPage

    const offlinePage = await caches.match('/offline')
    if (offlinePage) return offlinePage

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
}

async function findCachedNavigationByPath(paths) {
  const cache = await caches.open(RUNTIME_CACHE)
  const keys = await cache.keys()

  for (const path of paths) {
    const matchingRequest = keys
      .filter(key => key.mode === 'navigate' || key.destination === 'document' || key.headers.get('accept')?.includes('text/html'))
      .find(key => {
        try {
          const url = new URL(key.url)
          return url.origin === self.location.origin && url.pathname === path
        } catch {
          return false
        }
      })

    if (!matchingRequest) continue

    const response = await cache.match(matchingRequest)
    if (response) return response
  }

  return null
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)

    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      cache.put(request, response.clone()).catch(() => undefined)
    }

    return response
  } catch {
    return cached || Response.error()
  }
}
