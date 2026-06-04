'use client'

import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'

type ReservedQr = {
  id: string
  qrCode: string
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export default function BlankQrClient() {
  const [count, setCount] = useState(20)
  const [items, setItems] = useState<ReservedQr[]>([])
  const [images, setImages] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const pages = useMemo(() => chunkItems(items, 20), [items])

  useEffect(() => {
    let cancelled = false

    async function generate() {
      const entries = await Promise.all(
        items.map(async item => {
          const image = await QRCode.toDataURL(item.qrCode, {
            margin: 1,
            width: 240,
            errorCorrectionLevel: 'M'
          })

          return [item.id, image] as const
        })
      )

      if (!cancelled) {
        setImages(Object.fromEntries(entries))
      }
    }

    if (items.length > 0) {
      generate()
    } else {
      setImages({})
    }

    return () => {
      cancelled = true
    }
  }, [items])

  const reserveQr = async () => {
    setLoading(true)
    setMessage('')
    setMessageType('')
    setItems([])

    try {
      const res = await fetch('/api/personalista/blank-qr/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        setMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'QR sa nepodarilo rezervovať.')
        setMessageType('error')
        return
      }

      setItems(json.items || [])
      setMessage(json.message || 'QR boli rezervované.')
      setMessageType('ok')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setMessage('Chyba spojenia so serverom: ' + text)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const readyToPrint = items.length > 0 && Object.keys(images).length === items.length

  return (
    <main style={styles.page}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet { break-after: page; page-break-after: always; }
          .print-sheet:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <section className="no-print" style={styles.panel}>
        <div>
          <div style={styles.breadcrumb}>Personalistika / Prázdne QR</div>
          <h1 style={styles.title}>Generovať prázdne QR</h1>
          <p style={styles.subtitle}>
            Rezervuje voľné QR z tabuľky qr_codes a označí ich ako VYTLACENY. Hodnota QR sa na papier netlačí.
          </p>
        </div>

        <div style={styles.controls}>
          <label style={styles.field}>
            <span>Počet</span>
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={event => setCount(Number(event.target.value))}
              style={styles.input}
              disabled={loading}
            />
          </label>

          <button
            type="button"
            style={styles.primaryButton}
            onClick={reserveQr}
            disabled={loading}
          >
            {loading ? 'Rezervujem...' : 'Rezervovať QR'}
          </button>

          <button
            type="button"
            style={styles.darkButton}
            onClick={() => window.print()}
            disabled={!readyToPrint}
          >
            Tlačiť
          </button>

          <a href="/dashboard/personalista" style={styles.lightButton}>
            Späť
          </a>
        </div>

        {message && (
          <div
            style={{
              ...styles.message,
              background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
              color: messageType === 'ok' ? '#166534' : '#991b1b',
              borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
            }}
          >
            {message}
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <section style={styles.emptyBox}>
          Najprv rezervuj počet QR. Po rezervácii sa hneď zobrazí tlačový hárok.
        </section>
      ) : (
        pages.map((pageItems, pageIndex) => (
          <section key={pageIndex} className="print-sheet" style={styles.sheet}>
            <header style={styles.sheetHeader}>
              <b>Prázdne QR</b>
              <span>Strana {pageIndex + 1} / {pages.length}</span>
            </header>

            <div style={styles.grid}>
              {pageItems.map(item => (
                <article key={item.id} style={styles.card}>
                  <div style={styles.qrBox}>
                    {images[item.id] ? (
                      <img src={images[item.id]} alt="QR kód" style={styles.qrImage} />
                    ) : (
                      <span>QR</span>
                    )}
                  </div>

                  <div style={styles.personName}>Voľný QR</div>
                  <div style={styles.meta}>Nepriradený</div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e5e7eb',
    padding: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  panel: {
    maxWidth: 980,
    margin: '0 auto 12px auto',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 12
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 850,
    color: '#6b7280'
  },
  title: {
    margin: '3px 0 0 0',
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  controls: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'end'
  },
  field: {
    display: 'grid',
    gap: 5,
    minWidth: 120,
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 16,
    fontWeight: 850
  },
  primaryButton: {
    border: '1px solid #16a34a',
    background: '#22c55e',
    color: '#052e16',
    borderRadius: 10,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  darkButton: {
    border: '1px solid #111827',
    background: '#111827',
    color: '#fff',
    borderRadius: 10,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  lightButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 10,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  emptyBox: {
    maxWidth: 980,
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    fontWeight: 850
  },
  sheet: {
    width: '190mm',
    minHeight: '277mm',
    margin: '0 auto 12px auto',
    background: '#fff',
    padding: '6mm',
    boxSizing: 'border-box'
  },
  sheetHeader: {
    height: '10mm',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10,
    fontWeight: 850,
    color: '#374151'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gridAutoRows: '49mm',
    gap: '3mm'
  },
  card: {
    border: '0.3mm solid #d1d5db',
    borderRadius: '2mm',
    padding: '2mm',
    boxSizing: 'border-box',
    display: 'grid',
    alignContent: 'start',
    justifyItems: 'center',
    gap: '1mm',
    overflow: 'hidden'
  },
  qrBox: {
    width: '31mm',
    height: '31mm',
    display: 'grid',
    placeItems: 'center',
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: 900
  },
  qrImage: {
    width: '31mm',
    height: '31mm',
    display: 'block'
  },
  personName: {
    width: '100%',
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 1.12,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  meta: {
    width: '100%',
    textAlign: 'center',
    fontSize: 7,
    lineHeight: 1.1,
    fontWeight: 800,
    color: '#4b5563',
    overflowWrap: 'anywhere'
  }
}
