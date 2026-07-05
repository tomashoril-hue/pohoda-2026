'use client'

import { useEffect } from 'react'

const OFFLINE_READY_VERSION = 'v10'
const RUNTIME_CACHE = `pohoda-pass-offline-${OFFLINE_READY_VERSION}-runtime`
const SW_RELOAD_KEY = `pohoda-sw-controller-reload-${OFFLINE_READY_VERSION}`

function offlineReadyKey(path: string) {
  return `pohoda-offline-route-ready:${OFFLINE_READY_VERSION}:${path}`
}

function markOfflineRouteReady(path: string) {
  try {
    window.localStorage.setItem(offlineReadyKey(path), new Date().toISOString())
  } catch {
    // Readiness markers only improve offline navigation; failures are harmless.
  }
}

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

function waitForHiddenFrameLoad(path: string, timeoutMs = 6000) {
  return new Promise<void>(resolve => {
    if (!document.body) {
      resolve()
      return
    }

    const frame = document.createElement('iframe')
    let finished = false

    const finish = (loaded = false) => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      if (loaded) markOfflineRouteReady(path)
      frame.remove()
      resolve()
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs)

    frame.addEventListener('load', () => {
      window.setTimeout(() => finish(true), 350)
    }, { once: true })
    frame.addEventListener('error', () => finish(false), { once: true })
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.src = path
    frame.style.position = 'fixed'
    frame.style.left = '-10000px'
    frame.style.top = '-10000px'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'
    frame.style.border = '0'

    document.body.appendChild(frame)
  })
}

async function warmRoutesWithHiddenFrames(paths: string[]) {
  const framePaths = paths.filter(path => path !== '/dashboard')
  if (framePaths.length === 0 || !navigator.onLine) return

  await Promise.all(framePaths.map(path => waitForHiddenFrameLoad(path)))
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
        markOfflineRouteReady('/dashboard')

        const registration = await waitForServiceWorkerReady()
        if (cancelled) return

        const worker = registration.active || navigator.serviceWorker.controller
        if (!worker) return

        worker?.postMessage({
          type: 'CACHE_AUTH_ROUTES',
          paths
        })
        await warmRoutesWithHiddenFrames(paths)
        if (cancelled) return

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
