'use client'

import { useState } from 'react'

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value: string | null) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

export default function GroupIssueClient({
  myRole,
  groupName
}: {
  myRole: string
  groupName: string
}) {
  const [datum, setDatum] = useState(todayIsoDate())
  const [typJedla, setTypJedla] = useState('OBED')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<any>(null)

  const createIssue = async () => {
    setMessage('')
    setResult(null)
    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datum, typJedla })
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
        setMessage(json.error || 'Hromadný výdaj sa nepodarilo vytvoriť.')
        return
      }

      setResult(json)
      setMessage(json.message || 'Hromadný výdaj bol vytvorený.')
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.box}>
      <h2 style={styles.boxTitle}>Nastavenie výdaja</h2>

      <div style={styles.formGrid}>
        <label style={styles.field}>
          <span style={styles.label}>Dátum</span>
          <input
            type="date"
            value={datum}
            onChange={e => setDatum(e.target.value)}
            style={styles.input}
          />
        </label>

        <label style={styles.field}>
          <span style={styles.label}>Typ jedla</span>
          <select
            value={typJedla}
            onChange={e => setTypJedla(e.target.value)}
            style={styles.input}
          >
            <option value="OBED">OBED</option>
            <option value="VECERA">VEČERA</option>
          </select>
        </label>
      </div>

      <div style={styles.notice}>
        {myRole === 'MANAGER' ? (
          <>
            Ako <b>MANAGER</b> vytvoríte hromadný výdaj okamžite platný.
          </>
        ) : (
          <>
            Ako <b>POVERENY</b> vytvoríte hromadný výdaj, ktorý začne platiť až po 15 minútach.
          </>
        )}
      </div>

      <button
        style={{
          ...styles.button,
          opacity: loading ? 0.65 : 1,
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
        disabled={loading}
        onClick={createIssue}
      >
        {loading ? 'Vytváram...' : 'Vytvoriť hromadný výdaj'}
      </button>

      {message && (
        <div
          style={{
            ...styles.message,
            background: result?.ok ? '#56db3f' : '#f25be6'
          }}
        >
          {message}
        </div>
      )}

      {result?.ok && (
        <div style={styles.resultBox}>
          <h3 style={styles.resultTitle}>Výdaj pripravený</h3>

          <p><b>Skupina:</b> {groupName || '-'}</p>
          <p><b>Dátum:</b> {datum}</p>
          <p><b>Jedlo:</b> {typJedla}</p>
          <p><b>Status:</b> {result.status}</p>
          <p><b>Počet položiek:</b> {result.itemsCount ?? '-'}</p>

          {result.validAfter && (
            <p>
              <b>Platné od:</b> {formatDateTime(result.validAfter)}
            </p>
          )}

          {result.issueId && (
            <a
              href={`/dashboard/group/issue/${result.issueId}`}
              style={styles.detailLink}
            >
              Otvoriť detail výdaja
            </a>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 24,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 22,
    padding: 18
  },
  boxTitle: {
    margin: '0 0 16px',
    fontSize: 26,
    fontWeight: 950
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 14
  },
  field: {
    display: 'grid',
    gap: 7
  },
  label: {
    fontSize: 14,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 18,
    padding: '14px 15px',
    fontSize: 17,
    fontWeight: 900,
    background: '#fff',
    color: '#000'
  },
  notice: {
    marginTop: 16,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 800,
    lineHeight: 1.4
  },
  button: {
    width: '100%',
    marginTop: 18,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 18,
    fontWeight: 950
  },
  message: {
    marginTop: 16,
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 900
  },
  resultBox: {
    marginTop: 18,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 16,
    fontWeight: 800
  },
  resultTitle: {
    margin: '0 0 10px',
    fontSize: 22,
    fontWeight: 950
  },
  detailLink: {
    display: 'inline-block',
    marginTop: 12,
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 16px',
    fontWeight: 950,
    textDecoration: 'none'
  }
}