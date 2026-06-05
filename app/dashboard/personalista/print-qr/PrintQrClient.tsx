'use client'

import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'

type PrintQrItem = {
  userId: string
  fullName: string
  groupName: string
  food: string
  qrCode: string
}

function foodLabel(value: string) {
  const normalized = String(value || '').toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIÉTA' || normalized === 'DIĂ‰TA') return 'DIÉTA'

  return 'NEZADANÉ'
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export default function PrintQrClient({
  title,
  items
}: {
  title: string
  items: PrintQrItem[]
}) {
  const [images, setImages] = useState<Record<string, string>>({})
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

          return [item.userId, image] as const
        })
      )

      if (!cancelled) {
        setImages(Object.fromEntries(entries))
      }
    }

    generate()

    return () => {
      cancelled = true
    }
  }, [items])

  return (
    <main className="print-page" style={styles.page}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .print-page { min-height: auto !important; padding: 0 !important; background: #fff !important; }
          .no-print { display: none !important; }
          .print-sheet {
            width: 190mm !important;
            min-height: auto !important;
            margin: 0 auto !important;
            padding: 5mm !important;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .print-sheet:last-child { break-after: auto; page-break-after: auto; }
          .print-grid { grid-auto-rows: 47mm !important; gap: 2.5mm !important; }
        }
      `}</style>

      <section className="no-print" style={styles.toolbar}>
        <div>
          <b>{title}</b>
          <span>{items.length} QR pripravených na tlač</span>
        </div>

        <div style={styles.toolbarActions}>
          <a href="/dashboard/personalista" style={styles.lightButton}>
            Späť
          </a>

          <button
            type="button"
            style={styles.darkButton}
            onClick={() => window.print()}
            disabled={Object.keys(images).length !== items.length}
          >
            Tlačiť
          </button>
        </div>
      </section>

      {items.length === 0 ? (
        <section style={styles.emptyBox}>
          Nie sú dostupné žiadne aktívne QR na tlač.
        </section>
      ) : (
        pages.map((pageItems, pageIndex) => (
          <section key={pageIndex} className="print-sheet" style={styles.sheet}>
            <header style={styles.sheetHeader}>
              <b>{title}</b>
              <span>Strana {pageIndex + 1} / {pages.length}</span>
            </header>

            <div className="print-grid" style={styles.grid}>
              {pageItems.map(item => (
                <article key={item.userId} style={styles.card}>
                  <div style={styles.qrBox}>
                    {images[item.userId] ? (
                      <img src={images[item.userId]} alt="QR kód" style={styles.qrImage} />
                    ) : (
                      <span>QR</span>
                    )}
                  </div>

                  <div style={styles.personName}>{item.fullName}</div>
                  <div style={styles.meta}>{item.groupName}</div>
                  <div style={styles.food}>{foodLabel(item.food)}</div>
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
  toolbar: {
    maxWidth: 980,
    margin: '0 auto 12px auto',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  toolbarActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center'
  },
  lightButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  darkButton: {
    border: '1px solid #111827',
    background: '#111827',
    color: '#fff',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer'
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
    width: '29mm',
    height: '29mm',
    display: 'grid',
    placeItems: 'center',
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: 900
  },
  qrImage: {
    width: '29mm',
    height: '29mm',
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
  },
  food: {
    marginTop: 1,
    border: '0.3mm solid #9ca3af',
    borderRadius: '999px',
    padding: '0.8mm 2mm',
    fontSize: 7,
    lineHeight: 1,
    fontWeight: 950
  }
}
