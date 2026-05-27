'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const cleanEmail = email.trim().toLowerCase()

  const handleLogin = async () => {
    if (!cleanEmail) {
      alert('Zadaj e-mail')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error || 'E-mail sa nepodarilo odoslať.')
        return
      }

      setSent(true)
      setCode('')
    } catch (err: any) {
      setError('Chyba: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCodeLogin = async () => {
    if (!cleanEmail) {
      setError('Chýba e-mail. Pošli si nový prihlasovací kód.')
      return
    }

    if (code.length !== 6) {
      setError('Zadaj 6-miestny kód.')
      return
    }

    setCodeLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, code })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error || 'Prihlásenie kódom zlyhalo.')
        return
      }

      window.location.href = '/dashboard'
    } catch (err: any) {
      setError('Chyba: ' + err.message)
    } finally {
      setCodeLoading(false)
    }
  }

  const resetLogin = () => {
    setSent(false)
    setCode('')
    setError('')
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. - 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Prihlásenie</div>

        <h1 style={styles.title}>Vitaj späť</h1>

        {!sent ? (
          <>
            <p style={styles.subtitle}>
              Zadaj svoj registračný e-mail. Pošleme ti prihlasovací link aj 6-miestny kód.
            </p>

            <input
              style={styles.input}
              placeholder="E-mail"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />

            <button
              style={{
                ...styles.button,
                opacity: loading ? 0.65 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? 'Odosielam...' : 'Poslať prihlasenie'}
            </button>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}

            <Link href="/register" style={styles.registerLink}>
              Ešte nemám registráciu
            </Link>
          </>
        ) : (
          <div style={styles.success}>
            <h2 style={styles.messageTitle}>E-mail bol odoslaný</h2>
            <p>
              Na adresu <b>{cleanEmail}</b> sme poslali prihlasovací link aj 6-miestny kód.
            </p>
            <p>
              Ak používaš aplikáciu z plochy, zadaj kód priamo sem.
            </p>

            <input
              style={styles.codeInput}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
            />

            <button
              style={{
                ...styles.button,
                marginTop: 14,
                opacity: codeLoading ? 0.65 : 1,
                cursor: codeLoading ? 'not-allowed' : 'pointer'
              }}
              onClick={handleCodeLogin}
              disabled={codeLoading}
            >
              {codeLoading ? 'Prihlasujem...' : 'Prihlásiť kódom'}
            </button>

            <button
              style={styles.secondaryButton}
              onClick={resetLogin}
              type="button"
            >
              Zadať iný e-mail
            </button>

            {error && (
              <div style={styles.error}>
                {error}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  title: {
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  subtitle: {
    margin: '12px 0 28px',
    fontSize: 19,
    lineHeight: 1.45,
    fontWeight: 700
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
  codeInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 18,
    padding: '15px 17px',
    fontSize: 28,
    outline: 'none',
    background: '#fff',
    color: '#000',
    fontWeight: 900,
    letterSpacing: 8,
    textAlign: 'center'
  },
  button: {
    width: '100%',
    marginTop: 22,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 19,
    fontWeight: 900
  },
  secondaryButton: {
    width: '100%',
    marginTop: 12,
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '13px 20px',
    fontSize: 16,
    fontWeight: 900
  },
  error: {
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    background: '#ff3b30',
    color: '#fff',
    border: '3px solid #000',
    fontWeight: 900
  },
  registerLink: {
    display: 'block',
    marginTop: 18,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900,
    textDecoration: 'underline'
  },
  success: {
    marginTop: 24,
    padding: 18,
    borderRadius: 20,
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    fontWeight: 700
  },
  messageTitle: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 900
  }
}
