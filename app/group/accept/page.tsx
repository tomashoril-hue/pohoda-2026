'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function AcceptGroupInvitePage() {
  const params = useSearchParams()
  const token = params.get('token')

  const [status, setStatus] = useState('Spracovávam pozvánku...')
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const acceptInvite = async () => {
      if (!token) {
        setStatus('Chýba token pozvánky.')
        return
      }

      try {
        const res = await fetch(`/api/group/accept?token=${token}`)
        const json = await res.json()

        if (!res.ok || json.error) {
          setStatus(json.error || 'Pozvánku sa nepodarilo prijať.')
          setOk(false)
          return
        }

        setStatus('Boli ste úspešne pridaný do skupiny.')
        setOk(true)
      } catch (err: any) {
        setStatus('Chyba: ' + err.message)
      }
    }

    acceptInvite()
  }, [token])

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Pozvánka do skupiny</div>

        <h1 style={styles.title}>{ok ? 'Hotovo' : 'Prijatie pozvánky'}</h1>

        <p style={styles.status}>{status}</p>

        <a href="/dashboard/group" style={styles.buttonLink}>
          Prejsť na moju skupinu
        </a>
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
    fontSize: 44,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  status: {
    marginTop: 22,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontSize: 18,
    fontWeight: 800
  },
  buttonLink: {
    display: 'inline-block',
    marginTop: 24,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 22px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  }
}