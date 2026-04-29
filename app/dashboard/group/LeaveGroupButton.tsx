'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LeaveGroupButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const leaveGroup = async () => {
    setMessage('')

    if (!confirm('Naozaj chcete opustiť túto skupinu?')) {
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/group/leave', {
        method: 'POST'
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa opustiť skupinu.')
        return
      }

      router.refresh()
    } catch (err: any) {
      setMessage('Chyba: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.box}>
      <button
        style={{
          ...styles.button,
          opacity: loading ? 0.65 : 1,
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
        onClick={leaveGroup}
        disabled={loading}
      >
        {loading ? 'Spracovávam...' : 'Opustiť skupinu'}
      </button>

      {message && <div style={styles.message}>{message}</div>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 20
  },
  button: {
    width: '100%',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 22px',
    fontSize: 17,
    fontWeight: 900
  },
  message: {
    marginTop: 12,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    fontWeight: 900
  }
}