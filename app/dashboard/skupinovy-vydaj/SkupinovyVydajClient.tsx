'use client'

import { useState } from 'react'
import Link from 'next/link'

type MealType = 'OBED' | 'VECERA'

type Props = {
  initialDate: string
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${value}T12:00:00`))
  } catch {
    return value
  }
}

function mealLabel(value: MealType) {
  return value === 'OBED' ? 'Obed' : 'Večera'
}

export default function SkupinovyVydajClient({ initialDate }: Props) {
  const [date, setDate] = useState(initialDate)
  const [meal, setMeal] = useState<MealType>('OBED')
  const [confirmed, setConfirmed] = useState(false)

  return (
    <main className="group-issue-page" style={styles.page}>
      <style>{`
        .group-issue-page button,
        .group-issue-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .group-issue-page button:not(:disabled):active,
        .group-issue-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        .group-issue-page button:disabled {
          cursor: wait;
          opacity: 0.7;
        }

        @media (max-width: 720px) {
          .group-issue-page { padding: 12px !important; }
          .group-issue-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .group-issue-title { font-size: 32px !important; }
          .group-issue-actions { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <section className="group-issue-card" style={styles.card}>
        <div style={styles.topRow}>
          <div>
            <div style={styles.kicker}>Strava</div>
            <h1 className="group-issue-title" style={styles.title}>Skupinový výdaj</h1>
            <p style={styles.subtitle}>Najprv vyber deň a typ jedla. Ďalšie kroky doplníme postupne.</p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            Späť
          </Link>
        </div>

        <div style={styles.stepBadge}>Krok 1</div>

        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span style={styles.label}>Dátum skupinového výdaja</span>
            <input
              type="date"
              value={date}
              onChange={event => {
                setDate(event.target.value)
                setConfirmed(false)
              }}
              style={styles.input}
            />
          </label>

          <div style={styles.field}>
            <span style={styles.label}>Jedlo</span>
            <div style={styles.segment}>
              <button
                type="button"
                onClick={() => {
                  setMeal('OBED')
                  setConfirmed(false)
                }}
                style={{
                  ...styles.segmentButton,
                  ...(meal === 'OBED' ? styles.segmentButtonActive : {})
                }}
              >
                Obed
              </button>
              <button
                type="button"
                onClick={() => {
                  setMeal('VECERA')
                  setConfirmed(false)
                }}
                style={{
                  ...styles.segmentButton,
                  ...(meal === 'VECERA' ? styles.segmentButtonActive : {})
                }}
              >
                Večera
              </button>
            </div>
          </div>
        </div>

        <div style={styles.summaryBox}>
          <span style={styles.summaryLabel}>Vybrané</span>
          <b>{formatDate(date)} · {mealLabel(meal)}</b>
        </div>

        <div className="group-issue-actions" style={styles.actions}>
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            disabled={!date}
            style={styles.primaryButton}
          >
            Pokračovať
          </button>

          <Link href="/dashboard" style={styles.secondaryButton}>
            Zrušiť
          </Link>
        </div>

        {confirmed && (
          <div style={styles.message}>
            Tento výber je pripravený. Ďalší krok bude výber ľudí zo skupiny alebo cez QR.
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
    padding: 24,
    color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  card: {
    maxWidth: 760,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24
  },
  kicker: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 12px',
    fontWeight: 950,
    fontSize: 12,
    textTransform: 'uppercase'
  },
  title: {
    margin: '14px 0 8px 0',
    fontSize: 44,
    lineHeight: 1,
    fontWeight: 950
  },
  subtitle: {
    margin: 0,
    maxWidth: 520,
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.35
  },
  backButton: {
    background: '#000',
    color: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000',
    whiteSpace: 'nowrap'
  },
  stepBadge: {
    display: 'inline-block',
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '7px 14px',
    fontWeight: 950,
    marginBottom: 14
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 14
  },
  field: {
    display: 'grid',
    gap: 8
  },
  label: {
    fontSize: 13,
    fontWeight: 950
  },
  input: {
    width: '100%',
    minHeight: 52,
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 16,
    padding: '0 14px',
    fontSize: 18,
    fontWeight: 900,
    background: '#fff',
    color: '#000'
  },
  segment: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10
  },
  segmentButton: {
    minHeight: 52,
    border: '3px solid #000',
    borderRadius: 16,
    background: '#fff',
    color: '#000',
    fontSize: 17,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  segmentButtonActive: {
    background: '#56db3f'
  },
  summaryBox: {
    marginTop: 18,
    border: '3px solid #000',
    borderRadius: 18,
    background: '#000',
    color: '#fff',
    padding: 14,
    display: 'grid',
    gap: 4
  },
  summaryLabel: {
    color: '#56db3f',
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  actions: {
    marginTop: 18,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12
  },
  primaryButton: {
    minHeight: 52,
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    fontSize: 16,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  secondaryButton: {
    minHeight: 52,
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000'
  },
  message: {
    marginTop: 16,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 950
  }
}
