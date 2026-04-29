'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function LoginConfirmPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginConfirmContent />
    </Suspense>
  )
}

function Loading() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p style={styles.status}>Prihlasujem...</p>
      </section>
    </main>
  )
}

function LoginConfirmContent() {
  const params = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState('Prihlasujem...')

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus('Chýba prihlasovací token.')
        return
      }

      const res = await fetch(`/api/auth/login/confirm?token=${token}`)
      const json = await res.json()

      if (!res.ok || json.error) {
        setStatus(json.error || 'Prihlásenie zlyhalo.')
        return
      }

      window.location.href = '/dashboard'
    }

    run()
  }, [token])

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Prihlásenie</div>
        <h1 style={styles.title}>POHODA 2026</h1>
        <p style={styles.status}>{status}</p>
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
  status: {
    marginTop: 24,
    fontSize: 20,
    lineHeight: 1.4,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontWeight: 700
  }
}