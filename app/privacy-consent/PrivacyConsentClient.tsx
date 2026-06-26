'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { appText, type AppLanguage } from '@/lib/i18n'
import {
  PRIVACY_CONSENT_TEXT,
  PRIVACY_CONSENT_TEXT_EN,
  PRIVACY_POLICY_URL
} from '@/lib/privacyConsentConfig'

export default function PrivacyConsentClient({
  language,
  userName
}: {
  language: AppLanguage
  userName: string
}) {
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!accepted) {
      setError(isEnglish
        ? 'Please confirm that you have read the personal data protection rules.'
        : 'Najprv potvrď oboznámenie s pravidlami ochrany osobných údajov.')
      return
    }

    setLoading(true)
    setPressed(true)
    setError('')

    try {
      const response = await fetch('/api/privacy-consent/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true })
      })
      const json = await response.json()

      if (!response.ok || json.error) {
        throw new Error(json.error || (isEnglish ? 'The confirmation could not be saved.' : 'Potvrdenie sa nepodarilo uložiť.'))
      }

      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err?.message || (isEnglish ? 'The confirmation could not be saved.' : 'Potvrdenie sa nepodarilo uložiť.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.headerRow}>
          <div style={styles.badge}>{copy.privacy}</div>
          <LanguageSwitcher language={language} compact />
        </div>

        <h1 style={styles.title}>PohodaPass</h1>
        <p style={styles.lead}>
          {userName
            ? (isEnglish
              ? `${userName}, before entering the app you need to confirm that you have read the rules.`
              : `${userName}, pred vstupom do aplikácie je potrebné potvrdiť oboznámenie s pravidlami.`)
            : (isEnglish
              ? 'Before entering the app you need to confirm that you have read the rules.'
              : 'Pred vstupom do aplikácie je potrebné potvrdiť oboznámenie s pravidlami.')}
        </p>

        <div style={styles.textBox}>
          {isEnglish ? PRIVACY_CONSENT_TEXT_EN : PRIVACY_CONSENT_TEXT}
        </div>

        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noreferrer"
          style={styles.policyLink}
        >
          {copy.privacyOpen}
        </a>

        <label style={styles.checkRow}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={event => setAccepted(event.target.checked)}
            style={styles.checkbox}
          />
          <span>{copy.privacyConfirm}</span>
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="button"
          disabled={loading || !accepted}
          onPointerDown={() => {
            if (accepted && !loading) setPressed(true)
          }}
          onPointerUp={() => window.setTimeout(() => setPressed(false), 180)}
          onPointerLeave={() => setPressed(false)}
          onClick={submit}
          style={{
            ...styles.button,
            ...(pressed ? styles.buttonPressed : {}),
            ...((loading || !accepted) ? styles.buttonDisabled : {})
          }}
        >
          {loading ? copy.saving : copy.continueToApp}
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
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap'
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
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, filter 120ms ease'
  },
  buttonPressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: '1px 1px 0 #000',
    filter: 'brightness(0.92)'
  },
  buttonDisabled: {
    background: '#e5e7eb',
    color: '#6b7280',
    borderColor: '#9ca3af',
    boxShadow: 'none',
    cursor: 'not-allowed'
  }
}
