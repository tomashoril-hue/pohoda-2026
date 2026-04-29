'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CreateGroupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const createGroup = async () => {
    setError('')

    if (!name.trim()) {
      setError('Zadajte názov skupiny.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/group/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setError('Server vrátil neplatnú odpoveď. Pozri terminál vo VS Code.')
        return
      }

      if (!res.ok || json.error) {
        setError(json.error || 'Nepodarilo sa vytvoriť skupinu.')
        return
      }

      router.push('/dashboard/group')
    } catch (err: any) {
      setError('Chyba spojenia so serverom: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Moja skupina</div>

        <h1 style={styles.title}>Vytvoriť skupinu</h1>

        <p style={styles.subtitle}>
          Skupina slúži na spoločný výber, členov skupiny a prípravu hromadného výdaja.
        </p>

        <input
          style={styles.input}
          placeholder="Názov skupiny, napr. STAGE"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button
          style={{
            ...styles.button,
            opacity: loading ? 0.65 : 1,
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
          onClick={createGroup}
          disabled={loading}
        >
          {loading ? 'Vytváram...' : 'Vytvoriť skupinu'}
        </button>

        <a href="/dashboard/group" style={styles.back}>
          Späť na skupinu
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
  subtitle: {
    margin: '14px 0 26px',
    fontSize: 18,
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
  error: {
    marginTop: 16,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 14,
    fontWeight: 900
  },
  back: {
    display: 'block',
    marginTop: 20,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900
  }
}