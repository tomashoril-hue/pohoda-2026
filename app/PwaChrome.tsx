'use client'

import { useEffect, useRef, useState } from 'react'

const refreshThreshold = 72
const maxPullDistance = 104

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

  useEffect(() => {
    if (!isIosStandalone()) return

    document.documentElement.classList.add('pwa-ios-standalone')
    setActive(true)

    const resetPull = () => {
      touchStart.current = null
      pullDistanceRef.current = 0
      setPullDistance(0)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (refreshing || window.scrollY > 0 || event.touches.length !== 1) {
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

  if (!active) return null

  const ready = pullDistance >= refreshThreshold
  const visible = pullDistance > 0 || refreshing

  return (
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
  )
}
