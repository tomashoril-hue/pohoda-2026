'use client'

import { useState } from 'react'

export default function InviteBox() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [inviteLink, setInviteLink] = useState('')

  const sendInvite = async () => {
    setMessage('')
    setInviteLink('')

    if (!email.trim()) {
      setMessage('Zadajte e-mail.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/group/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })

      const text = await res.text()

      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch (e) {
        console.error('API nevrátilo JSON:', text)
        setMessage('Server vrátil neplatnú odpoveď. Pozri terminál vo VS Code.')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa vytvoriť pozvánku.')
        return
      }

      setMessage('Pozvánka bola vytvorená.')
      setInviteLink(json.inviteLink || '')
      setEmail('')
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.inviteBox}>
      <h2 style={styles.inviteTitle}>Pozvať do skupiny</h2>

      <p style={styles.inviteText}>
        Zadajte e-mail osoby, ktorú chcete pozvať do tejto skupiny.
      </p>

      <input
        style={styles.input}
        placeholder="E-mail člena"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />

      <button
        style={{
          ...styles.button,
          opacity: loading ? 0.65 : 1,
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
        onClick={sendInvite}
        disabled={loading}
      >
        {loading ? 'Vytváram pozvánku...' : 'Pozvať do skupiny'}
      </button>

      {message && <p style={styles.message}>{message}</p>}

      {inviteLink && (
        <div style={styles.linkBox}>
          <p style={styles.linkTitle}>Testovací link:</p>
          <p style={styles.linkText}>{inviteLink}</p>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  inviteBox: {
    marginTop: 24,
    padding: 18,
    border: '3px solid #000',
    borderRadius: 20,
    background: '#56db3f'
  },
  inviteTitle: {
    margin: '0 0 8px',
    fontSize: 24,
    fontWeight: 900
  },
  inviteText: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 16
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 18,
    padding: '15px 17px',
    fontSize: 17,
    outline: 'none',
    background: '#fff',
    color: '#000',
    fontWeight: 700
  },
  button: {
    width: '100%',
    marginTop: 16,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 22px',
    fontSize: 17,
    fontWeight: 900
  },
  message: {
    marginTop: 14,
    fontWeight: 900
  },
  linkBox: {
    marginTop: 14,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 14
  },
  linkTitle: {
    margin: '0 0 6px',
    fontWeight: 900
  },
  linkText: {
    wordBreak: 'break-all',
    fontWeight: 700
  }
}