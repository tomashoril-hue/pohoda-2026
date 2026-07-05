'use client'

import { useEffect, useRef, useState } from 'react'

const refreshThreshold = 72
const maxPullDistance = 104
const disablePullRefreshClass = 'pwa-disable-pull-refresh'
const offlineReadyVersion = 'v10'
const offlineReadyRoutes = new Set([
  '/dashboard',
  '/dashboard/qr',
  '/menu',
  '/dashboard/naroky',
  '/dashboard/vydaj-stravy',
  '/dashboard/offline-rezim',
  '/dashboard/objednavanie-stravy'
])

function offlineReadyKey(path: string) {
  return `pohoda-offline-route-ready:${offlineReadyVersion}:${path}`
}

function isOfflineRouteReady(path: string) {
  if (path === '/offline') return true
  if (!offlineReadyRoutes.has(path)) return false

  try {
    return !!window.localStorage.getItem(offlineReadyKey(path))
  } catch {
    return false
  }
}

function markCurrentOfflineRouteReady() {
  const path = window.location.pathname

  if (!offlineReadyRoutes.has(path) || !navigator.onLine) return

  try {
    window.localStorage.setItem(offlineReadyKey(path), new Date().toISOString())
  } catch {
    // Readiness markers only prevent bad offline navigations.
  }
}

function isIosStandalone() {
  const iosDevice =
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    standaloneNavigator.standalone === true

  return iosDevice && standalone
}

export default function PwaChrome() {
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const pullDistanceRef = useRef(0)
  const [active, setActive] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const handleOfflineLinkClick = (event: MouseEvent) => {
      if (navigator.onLine) return
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target instanceof Element
        ? event.target.closest('a[href]')
        : null

      if (!(target instanceof HTMLAnchorElement)) return
      if (target.target || target.hasAttribute('download')) return

      const url = new URL(target.href, window.location.href)

      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith('/api/') || url.pathname === '/logout') return
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return

      event.preventDefault()
      if (isOfflineRouteReady(url.pathname)) {
        window.location.assign(`${url.pathname}${url.search}${url.hash}`)
        return
      }

      window.location.assign('/offline')
    }

    document.addEventListener('click', handleOfflineLinkClick, true)

    return () => {
      document.removeEventListener('click', handleOfflineLinkClick, true)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (document.readyState === 'complete') {
      window.setTimeout(markCurrentOfflineRouteReady, 500)
      return
    }

    window.addEventListener('load', markCurrentOfflineRouteReady, { once: true })

    return () => {
      window.removeEventListener('load', markCurrentOfflineRouteReady)
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const registerServiceWorker = () => {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        registration.update().catch(() => undefined)
      }).catch(() => {
        // Offline fallback is helpful but must never block the app.
      })
    }

    registerServiceWorker()
  }, [])

  useEffect(() => {
    if (!isIosStandalone()) return

    document.documentElement.classList.add('pwa-ios-standalone')
    setActive(true)

    const resetPull = () => {
      touchStart.current = null
      pullDistanceRef.current = 0
      setPullDistance(0)
    }

    const pullRefreshDisabled = () => {
      return document.documentElement.classList.contains(disablePullRefreshClass)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (pullRefreshDisabled() || refreshing || window.scrollY > 0 || event.touches.length !== 1) {
        resetPull()
        return
      }

      touchStart.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const start = touchStart.current

      if (pullRefreshDisabled()) {
        resetPull()
        return
      }

      if (!start || window.scrollY > 0 || event.touches.length !== 1) return

      const horizontalDistance = Math.abs(event.touches[0].clientX - start.x)
      const verticalDistance = event.touches[0].clientY - start.y

      if (verticalDistance <= 0 || horizontalDistance > verticalDistance) {
        resetPull()
        return
      }

      event.preventDefault()

      const nextDistance = Math.min(verticalDistance * 0.55, maxPullDistance)
      pullDistanceRef.current = nextDistance
      setPullDistance(nextDistance)
    }

    const handleTouchEnd = () => {
      if (pullRefreshDisabled()) {
        resetPull()
        return
      }

      if (pullDistanceRef.current < refreshThreshold) {
        resetPull()
        return
      }

      setRefreshing(true)
      setPullDistance(refreshThreshold)
      window.location.reload()
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('touchcancel', resetPull, { passive: true })

    return () => {
      document.documentElement.classList.remove('pwa-ios-standalone')
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', resetPull)
    }
  }, [refreshing])

  const ready = pullDistance >= refreshThreshold
  const visible = pullDistance > 0 || refreshing

  return (
    <>
      {!online && (
        <div className="pwa-network-badge" role="status" aria-live="polite">
          OFFLINE
        </div>
      )}

      {active && (
        <>
          <div className="pwa-ios-status-bar" aria-hidden="true" />

          <div
            className="pwa-pull-refresh"
            style={{
              opacity: visible ? 1 : 0,
              transform: `translate(-50%, ${visible ? pullDistance : 0}px)`
            }}
            role="status"
            aria-live="polite"
          >
            {refreshing ? 'Obnovujem...' : ready ? 'Pusti pre obnovenie' : 'Potiahni pre obnovenie'}
          </div>
        </>
      )}
    </>
  )
}
