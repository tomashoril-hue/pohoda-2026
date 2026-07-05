'use client'

import { useEffect } from 'react'

const RUNTIME_CACHE = 'pohoda-pass-offline-v8-runtime'
const SW_RELOAD_KEY = 'pohoda-sw-controller-reload-v8'

function uniqueRoutes(routes: string[]) {
  return Array.from(new Set(
    routes
      .map(route => String(route || '').trim())
      .filter(route => route.startsWith('/') && !route.startsWith('/api/'))
  ))
}

function waitForServiceWorkerReady(timeoutMs = 5000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Service worker ready timeout.')), timeoutMs)
    })
  ])
}

async function cacheRoutesInWindow(paths: string[]) {
  if (!('caches' in window)) return

  const cache = await caches.open(RUNTIME_CACHE)

  await Promise.all(
    paths.map(async path => {
      try {
        const request = new Request(path, {
          credentials: 'include',
          headers: {
            Accept: 'text/html'
          }
        })
        const response = await fetch(request)

        if (!response.ok || response.redirected) return

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('text/html')) return

        await cache.put(request, response.clone())
      } catch {
        // One route failing must not block the rest of the offline warmup.
      }
    })
  )
}

export default function DashboardOfflineWarmup({ routes }: { routes: string[] }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const paths = uniqueRoutes(routes)
    if (paths.length === 0) return

    let cancelled = false
    let warmed = false

    const warmup = async () => {
      if (warmed || !navigator.onLine) return

      try {
        await cacheRoutesInWindow(paths)
        if (cancelled) return

        const registration = await waitForServiceWorkerReady()
        if (cancelled) return

        const worker = registration.active || navigator.serviceWorker.controller
        if (!worker) return

        worker?.postMessage({
          type: 'CACHE_AUTH_ROUTES',
          paths
        })
        warmed = true
      } catch {
        // Offline cache warmup is best-effort and must never affect dashboard usage.
      }
    }

    const scheduleWarmup = () => {
      window.setTimeout(() => {
        void warmup()
      }, 250)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleWarmup()
    }

    const timer = window.setTimeout(() => {
      void warmup()
    }, 500)

    const controllerTimer = window.setTimeout(async () => {
      if (!navigator.onLine || navigator.serviceWorker.controller) return
      if (window.sessionStorage.getItem(SW_RELOAD_KEY) === '1') return

      try {
        await waitForServiceWorkerReady(2500)
        if (navigator.serviceWorker.controller) return

        window.sessionStorage.setItem(SW_RELOAD_KEY, '1')
        window.location.reload()
      } catch {
        // If the worker is not ready yet, the normal online page remains usable.
      }
    }, 1200)

    navigator.serviceWorker.addEventListener('controllerchange', scheduleWarmup)
    window.addEventListener('online', scheduleWarmup)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(controllerTimer)
      navigator.serviceWorker.removeEventListener('controllerchange', scheduleWarmup)
      window.removeEventListener('online', scheduleWarmup)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [routes])

  return null
}
