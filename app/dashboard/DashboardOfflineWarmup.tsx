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
    if (!navigator.onLine) return
    if (!('serviceWorker' in navigator)) return

    const paths = uniqueRoutes(routes)
    if (paths.length === 0) return

    let cancelled = false

    const warmup = async () => {
      try {
        const registration = await waitForServiceWorkerReady()
        if (cancelled) return

        const worker = registration.active || navigator.serviceWorker.controller
        worker?.postMessage({
          type: 'CACHE_AUTH_ROUTES',
          paths
        })
      } catch {
        // Offline cache warmup is best-effort and must never affect dashboard usage.
      }
    }

    const timer = window.setTimeout(() => {
      void warmup()
    }, 500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [routes])

  return null
}
