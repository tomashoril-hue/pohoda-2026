'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'

export default function LoginPage({
  initialEmail = '',
  initialSent = false,
  initialError = '',
  initialMethod = 'email',
  initialAccessCode = '',
  initialNext = ''
}: {
  initialEmail?: string
  initialSent?: boolean
  initialError?: string
  initialMethod?: 'email' | 'code'
  initialAccessCode?: string
  initialNext?: string
}) {
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [accessMeno, setAccessMeno] = useState('')
  const [accessPriezvisko, setAccessPriezvisko] = useState('')
  const [accessCode, setAccessCode] = useState(initialAccessCode.replace(/\D/g, '').slice(0, 8))
  const [loginMethod, setLoginMethod] = useState<'email' | 'code'>(initialMethod === 'code' ? 'code' : 'email')
  const [loading, setLoading] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [accessLoading, setAccessLoading] = useState(false)
  const [sent, setSent] = useState(initialSent)
  const [error, setError] = useState(initialError)

  const cleanEmail = email.trim().toLowerCase()
  const redirectAfterLogin = initialNext || '/dashboard'

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

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

  const handleCodeLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

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

      window.location.href = redirectAfterLogin
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

  const handleAccessCodeLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!accessMeno.trim() || !accessPriezvisko.trim()) {
      setError('Zadaj meno aj priezvisko.')
      return
    }

    if (accessCode.length !== 8) {
      setError('Zadaj 8-miestny prístupový kód.')
      return
    }

    setAccessLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login/access-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meno: accessMeno,
          priezvisko: accessPriezvisko,
          code: accessCode
        })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error || 'Prihlásenie prístupovým kódom zlyhalo.')
        return
      }

      window.location.href = redirectAfterLogin
    } catch (err: any) {
      setError('Chyba: ' + err.message)
    } finally {
      setAccessLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <a href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
          <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        </a>
        <div style={styles.date}>8. & 9. - 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Prihlásenie</div>

        <h1 style={styles.title}>Vitaj späť</h1>

        {!sent ? (
          <>
          <div style={styles.methodSwitch}>
            <button
              type="button"
              style={{
                ...styles.methodButton,
                ...(loginMethod === 'email' ? styles.methodButtonActive : {})
              }}
              onClick={() => {
                setLoginMethod('email')
                setError('')
              }}
            >
              E-mail
            </button>

            <button
              type="button"
              style={{
                ...styles.methodButton,
                ...(loginMethod === 'code' ? styles.methodButtonActive : {})
              }}
              onClick={() => {
                setLoginMethod('code')
                setError('')
              }}
            >
              Prístupový kód
            </button>
          </div>

          {loginMethod === 'email' ? (
          <form action="/api/auth/login/request" method="post" onSubmit={handleLogin}>
            <p style={styles.subtitle}>
              Zadaj svoj registračný e-mail. Pošleme ti prihlasovací link aj 6-miestny kód.
            </p>

            <input
              style={styles.input}
              placeholder="E-mail"
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              name="email"
              autoComplete="email"
              required
            />

            <button
              type="submit"
              style={{
                ...styles.button,
                opacity: loading ? 0.65 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              disabled={loading}
            >
              {loading ? 'Odosielam...' : 'Poslať prihlasenie'}
            </button>

            <Link href="/register" style={styles.registerLink}>
              Ešte nemám registráciu
            </Link>
          </form>
          ) : (
          <form onSubmit={handleAccessCodeLogin} style={styles.accessBox}>
            <h2 style={styles.accessTitle}>Prihlásenie menom a kódom</h2>
            <p style={styles.accessText}>
              Použi túto možnosť, ak máš pridelený prístupový kód od organizátora.
            </p>

            <div style={styles.accessGrid}>
              <input
                style={styles.input}
                placeholder="Meno"
                value={accessMeno}
                onChange={e => setAccessMeno(e.target.value)}
                autoComplete="given-name"
              />
              <input
                style={styles.input}
                placeholder="Priezvisko"
                value={accessPriezvisko}
                onChange={e => setAccessPriezvisko(e.target.value)}
                autoComplete="family-name"
              />
            </div>

            <input
              style={styles.codeInput}
              placeholder="00000000"
              value={accessCode}
              onChange={e => setAccessCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={8}
            />

            <button
              type="submit"
              style={{
                ...styles.button,
                opacity: accessLoading ? 0.65 : 1,
                cursor: accessLoading ? 'not-allowed' : 'pointer'
              }}
              disabled={accessLoading}
            >
              {accessLoading ? 'Prihlasujem...' : 'Prihlásiť kódom'}
            </button>
          </form>
          )}

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}
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

            <form action="/api/auth/login/code" method="post" onSubmit={handleCodeLogin}>
              <input type="hidden" name="email" value={cleanEmail} />
              <input
                style={styles.codeInput}
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                name="code"
                required
              />

              <button
                type="submit"
                style={{
                  ...styles.button,
                  marginTop: 14,
                  opacity: codeLoading ? 0.65 : 1,
                  cursor: codeLoading ? 'not-allowed' : 'pointer'
                }}
                disabled={codeLoading}
              >
                {codeLoading ? 'Prihlasujem...' : 'Prihlásiť kódom'}
              </button>
            </form>

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
  methodSwitch: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    margin: '22px 0 18px',
    padding: 6,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#f6f2ff'
  },
  methodButton: {
    border: 0,
    borderRadius: 999,
    padding: '12px 14px',
    background: 'transparent',
    color: '#000',
    fontSize: 15,
    fontWeight: 950,
    cursor: 'pointer'
  },
  methodButtonActive: {
    background: '#56db3f',
    boxShadow: 'inset 0 0 0 2px #000'
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
  divider: {
    margin: '24px 0',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 950,
    opacity: 0.62,
    textTransform: 'uppercase'
  },
  accessBox: {
    marginTop: 0,
    padding: 18,
    borderRadius: 20,
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    display: 'grid',
    gap: 12
  },
  accessTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 950
  },
  accessText: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.35,
    fontWeight: 750
  },
  accessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 10
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
