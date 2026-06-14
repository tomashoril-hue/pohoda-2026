'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'
import {
  PRIVACY_CONSENT_TEXT,
  PRIVACY_POLICY_URL
} from '@/lib/privacyConsentConfig'

export default function PrivacyConsentClient({
  userName
}: {
  userName: string
}) {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!accepted) {
      setError('Najprv potvrď oboznámenie s pravidlami ochrany osobných údajov.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/privacy-consent/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true })
      })
      const json = await response.json()

      if (!response.ok || json.error) {
        throw new Error(json.error || 'Potvrdenie sa nepodarilo uložiť.')
      }

      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err?.message || 'Potvrdenie sa nepodarilo uložiť.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.badge}>Ochrana osobných údajov</div>
        <h1 style={styles.title}>PohodaPass</h1>
        <p style={styles.lead}>
          {userName ? `${userName}, pred vstupom do aplikácie je potrebné potvrdiť oboznámenie s pravidlami.` : 'Pred vstupom do aplikácie je potrebné potvrdiť oboznámenie s pravidlami.'}
        </p>

        <div style={styles.textBox}>
          {PRIVACY_CONSENT_TEXT}
        </div>

        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          style={styles.policyLink}
        >
          Otvoriť Pravidlá ochrany osobných údajov
        </a>

        <label style={styles.checkRow}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={event => setAccepted(event.target.checked)}
            style={styles.checkbox}
          />
          <span>
            Potvrdzujem, že som sa oboznámil/a s pravidlami ochrany osobných údajov.
          </span>
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="button"
          disabled={loading || !accepted}
          onClick={submit}
          style={{
            ...styles.button,
            ...((loading || !accepted) ? styles.buttonDisabled : {})
          }}
        >
          {loading ? 'Ukladám...' : 'Pokračovať do aplikácie'}
        </button>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f6f2ff',
    color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif',
    padding: 16,
    display: 'grid',
    placeItems: 'center'
  },
  card: {
    width: '100%',
    maxWidth: 680,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 22,
    padding: 22,
    boxShadow: '8px 8px 0 #000',
    display: 'grid',
    gap: 14
  },
  badge: {
    justifySelf: 'start',
    background: '#56db3f',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '7px 12px',
    fontWeight: 950,
    fontSize: 13
  },
  title: {
    margin: 0,
    fontSize: 38,
    lineHeight: 1,
    fontWeight: 950
  },
  lead: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.4,
    fontWeight: 750
  },
  textBox: {
    background: '#f6f2ff',
    border: '2px solid #000',
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    lineHeight: 1.45,
    fontWeight: 750
  },
  policyLink: {
    color: '#7417e8',
    fontWeight: 950
  },
  checkRow: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    gap: 10,
    alignItems: 'start',
    fontSize: 14,
    lineHeight: 1.35,
    fontWeight: 850
  },
  checkbox: {
    width: 20,
    height: 20,
    margin: 0,
    accentColor: '#7417e8'
  },
  error: {
    border: '2px solid #000',
    borderRadius: 12,
    background: '#ffd6d6',
    padding: 10,
    fontWeight: 900
  },
  button: {
    justifySelf: 'start',
    background: '#7417e8',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000',
    cursor: 'pointer'
  },
  buttonDisabled: {
    background: '#e5e7eb',
    color: '#6b7280',
    borderColor: '#9ca3af',
    boxShadow: 'none',
    cursor: 'not-allowed'
  }
}
