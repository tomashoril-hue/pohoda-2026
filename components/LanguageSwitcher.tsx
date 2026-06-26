'use client'

import { useState } from 'react'
import type { AppLanguage } from '@/lib/i18n'

export default function LanguageSwitcher({
  language,
  compact = false
}: {
  language: AppLanguage
  compact?: boolean
}) {
  const [current, setCurrent] = useState<AppLanguage>(language)
  const [loading, setLoading] = useState(false)

  const setLanguage = async (nextLanguage: AppLanguage) => {
    if (nextLanguage === current || loading) return

    setLoading(true)
    setCurrent(nextLanguage)

    try {
      await fetch('/api/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: nextLanguage })
      })
    } finally {
      window.location.reload()
    }
  }

  return (
    <div style={{
      display: 'inline-grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 4,
      background: '#fff',
      border: '2px solid #000',
      borderRadius: 999,
      padding: 3,
      boxShadow: compact ? '2px 2px 0 #000' : '4px 4px 0 #000'
    }}>
      {(['SK', 'EN'] as AppLanguage[]).map(item => {
        const active = item === current

        return (
          <button
            key={item}
            type="button"
            onClick={() => setLanguage(item)}
            disabled={loading}
            style={{
              border: 0,
              borderRadius: 999,
              background: active ? '#7417e8' : 'transparent',
              color: active ? '#fff' : '#000',
              padding: compact ? '5px 8px' : '7px 11px',
              fontSize: compact ? 11 : 12,
              fontWeight: 950,
              cursor: loading ? 'wait' : 'pointer',
              minWidth: compact ? 34 : 40
            }}
          >
            {item}
          </button>
        )
      })}
    </div>
  )
}
