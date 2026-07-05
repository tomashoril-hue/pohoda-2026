'use client'

import { useEffect } from 'react'

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

    navigator.serviceWorker.addEventListener('controllerchange', scheduleWarmup)
    window.addEventListener('online', scheduleWarmup)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('controllerchange', scheduleWarmup)
      window.removeEventListener('online', scheduleWarmup)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [routes])

  return null
}
