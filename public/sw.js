const CACHE_VERSION = 'pohoda-pass-offline-v9'
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
      .then(cache => cacheUrlsSafely(cache, APP_SHELL_URLS))
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

  if (isNextNavigationDataRequest(request, url)) {
    event.respondWith(handleNavigationDataRequest(request, url))
    return
  }

  if (isStaticAsset(url) || APP_SHELL_URLS.includes(url.pathname)) {
    event.respondWith(handleStaticAsset(request))
  }
})

self.addEventListener('message', event => {
  const data = event.data || {}

  if (data.type !== 'CACHE_AUTH_ROUTES' || !Array.isArray(data.paths)) return

  event.waitUntil(cacheAuthRoutes(data.paths))
})

async function cacheUrlsSafely(cache, urls) {
  await Promise.all(
    urls.map(async url => {
      try {
        await cache.add(url)
      } catch {
        // One missing icon or transient request must not prevent offline fallback from installing.
      }
    })
  )
}

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

    const cachedPageByPath = await findCachedNavigationByPath([requestUrl.pathname])
    if (cachedPageByPath) return cachedPageByPath

    const offlinePage = await caches.match('/offline')
    if (offlinePage) return offlinePage

    return new Response(inlineOfflineHtml(), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }
}

async function handleNavigationDataRequest(request, url) {
  try {
    return await fetch(request)
  } catch {
    const cachedPage = await findCachedNavigationByPath([url.pathname])
    if (cachedPage) {
      return new Response('', {
        status: 204,
        headers: {
          'X-Pohoda-Offlline-Document-Available': '1'
        }
      })
    }

    return new Response('', { status: 503 })
  }
}

function isNextNavigationDataRequest(request, url) {
  const accept = request.headers.get('accept') || ''
  const nextRouter = request.headers.get('next-router-state-tree')
  const rsc = request.headers.get('rsc')

  return (
    url.searchParams.has('_rsc') ||
    rsc === '1' ||
    !!nextRouter ||
    accept.includes('text/x-component')
  )
}

async function cacheAuthRoutes(paths) {
  const cache = await caches.open(RUNTIME_CACHE)
  const safePaths = paths
    .map(path => typeof path === 'string' ? path : '')
    .filter(path => path.startsWith('/') && !path.startsWith('/api/') && path !== '/logout')

  await Promise.all(
    safePaths.map(async path => {
      try {
        const request = new Request(path, {
          credentials: 'include',
          headers: {
            Accept: 'text/html'
          }
        })
        const response = await fetch(request)

        if (!response || !response.ok || response.redirected) return

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('text/html')) return

        await cache.put(request, response.clone())
      } catch {
        // The app remains usable even if one warmup route is not available.
      }
    })
  )
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

function inlineOfflineHtml() {
  return `<!doctype html>
<html lang="sk">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>POHODA Pass offline</title>
    <style>
      body{margin:0;min-height:100vh;background:#7417e8;color:#111827;display:grid;place-items:center;padding:18px;font-family:Arial,Helvetica,sans-serif}
      section{width:min(100%,520px);border:2px solid #000;border-radius:22px;background:#fff;box-shadow:8px 8px 0 #000;padding:22px;display:grid;gap:14px}
      .kicker{width:fit-content;border:2px solid #000;border-radius:999px;background:#dcfce7;color:#14532d;padding:6px 10px;font-size:11px;font-weight:950}
      h1{margin:0;font-size:28px;line-height:1.05;font-weight:950;color:#111827}
      p{margin:0;color:#374151;font-size:14px;font-weight:800;line-height:1.45}
      .notice{border:1px solid #fed7aa;border-radius:10px;background:#fff7ed;color:#9a3412;padding:12px;font-size:13px;font-weight:900;line-height:1.35}
      .actions{display:flex;gap:8px;flex-wrap:wrap}
      a{min-height:44px;border:2px solid #000;border-radius:10px;background:#22c55e;color:#052e16;box-shadow:4px 4px 0 #000;display:inline-flex;align-items:center;justify-content:center;padding:0 14px;text-decoration:none;font-size:14px;font-weight:950}
      a.secondary{background:#fff;color:#111827}
    </style>
  </head>
  <body>
    <section>
      <div class="kicker">OFFLINE REŽIM</div>
      <h1>Aplikácia je bez internetu</h1>
      <p>Momentálne nie je dostupné internetové pripojenie. Skontroluj sieť a skús stránku obnoviť.</p>
      <div class="notice">Niektoré časti aplikácie nemusia fungovať, kým sa zariadenie znova nepripojí na internet.</div>
      <div class="actions">
        <a href="">Obnoviť</a>
        <a class="secondary" href="/dashboard">Dashboard</a>
      </div>
    </section>
  </body>
</html>`
}
