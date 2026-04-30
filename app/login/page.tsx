'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async () => {
    if (!email.trim()) {
      alert('Zadaj e-mail')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error || 'E-mail sa nepodarilo odoslať.')
        return
      }

      setSent(true)
    } catch (err: any) {
      setError('Chyba: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />

        <div style={styles.chefIconWrap}>
          <img
            src="/kuchar-capica.png"
            alt="Stravovanie"
            style={styles.chefIcon}
          />
        </div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>
          <span style={styles.badgeDot} />
          Prihlásenie
        </div>

        <h1 style={styles.title}>Vitaj späť</h1>

        {!sent ? (
          <>
            <p style={styles.subtitle}>
              Zadaj svoj registračný e-mail. Pošleme ti prihlasovací link.
            </p>

            <div style={styles.formBox}>
              <input
                style={styles.input}
                placeholder="E-mail"
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
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
                {loading ? 'Odosielam...' : 'Poslať prihlasovací link'}
              </button>
            </div>

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
              Na adresu <b>{email}</b> sme poslali prihlasovací link.
            </p>
            <p>
              Kliknutím na link sa prihlásiš do systému.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background:
      'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
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
    objectFit: 'contain',
    display: 'block'
  },
  chefIconWrap: {
    width: 54,
    height: 54,
    minWidth: 54,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.95)',
    border: '2px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(0,0,0,0.22)'
  },
  chefIcon: {
    width: 34,
    height: 34,
    objectFit: 'contain',
    display: 'block'
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: 'rgba(255,255,255,0.96)',
    border: '2px solid #000',
    borderRadius: 34,
    padding: 30,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    background: 'rgba(86,219,63,0.22)',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '8px 15px',
    fontWeight: 950,
    marginBottom: 20
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#56db3f',
    border: '2px solid #000'
  },
  title: {
    fontSize: 52,
    lineHeight: 0.95,
    margin: 0,
    fontWeight: 950,
    letterSpacing: '-1.4px'
  },
  subtitle: {
    margin: '16px 0 26px',
    fontSize: 20,
    lineHeight: 1.4,
    fontWeight: 800,
    maxWidth: 600
  },
  formBox: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 24,
    padding: 16,
    boxShadow: '6px 6px 0 rgba(0,0,0,0.9)'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '2px solid #000',
    borderRadius: 18,
    padding: '15px 17px',
    fontSize: 17,
    outline: 'none',
    background: '#fff',
    color: '#000',
    fontWeight: 800
  },
  button: {
    width: '100%',
    marginTop: 14,
    background: '#000',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 18,
    fontWeight: 950
  },
  error: {
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    background: '#ff3b30',
    color: '#fff',
    border: '2px solid #000',
    fontWeight: 900
  },
  registerLink: {
    display: 'block',
    marginTop: 20,
    textAlign: 'center',
    color: '#000',
    fontWeight: 950,
    textDecoration: 'underline',
    textUnderlineOffset: 4
  },
  success: {
    marginTop: 24,
    padding: 18,
    borderRadius: 22,
    background: '#56db3f',
    color: '#000',
    border: '2px solid #000',
    fontWeight: 800,
    boxShadow: '6px 6px 0 #000'
  },
  messageTitle: {
    margin: '0 0 8px',
    fontSize: 24,
    fontWeight: 950
  }
}