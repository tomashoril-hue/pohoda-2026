'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import MenuClient from '@/app/menu/MenuClient'
import QrCameraScanner from '@/app/dashboard/skupinovy-vydaj/QrCameraScanner'

type Tone = 'success' | 'error' | 'warning' | ''

type KioskSession = {
  token: string
  userId: string
  personName: string
  defaultFood: string | null
  today: string
  menu: any[]
  selections: any[]
  deadlines: any[]
}

function normalizeQrInput(value: any) {
  let text = String(value || '').trim()

  if (!text) return ''

  text = text
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()

  try {
    const url = new URL(text)
    const queryValue =
      url.searchParams.get('qr') ||
      url.searchParams.get('qrCode') ||
      url.searchParams.get('code') ||
      url.searchParams.get('token')

    if (queryValue) {
      text = queryValue
    } else {
      const lastPathPart = url.pathname.split('/').filter(Boolean).pop()
      if (lastPathPart) text = lastPathPart
    }
  } catch {
    // Plain QR values are expected.
  }

  return text.replace(/\s+/g, '').trim()
}

export default function VyberStravyKioskClient({
  actorName,
  isAdmin
}: {
  actorName: string
  isAdmin: boolean
}) {
  const scannerBufferRef = useRef('')
  const scannerLastKeyAtRef = useRef(0)
  const loadingRef = useRef(false)
  const timeoutAtRef = useRef(0)

  const [session, setSession] = useState<KioskSession | null>(null)
  const [message, setMessage] = useState('Pripravené na načítanie QR alebo náramku.')
  const [tone, setTone] = useState<Tone>('')
  const [loading, setLoading] = useState(false)
  const [remainingMs, setRemainingMs] = useState(20000)

  const resetKiosk = (nextMessage = 'Pripravené na načítanie QR alebo náramku.') => {
    setSession(null)
    setMessage(nextMessage)
    setTone('')
    setLoading(false)
    loadingRef.current = false
    timeoutAtRef.current = 0
    setRemainingMs(20000)
  }

  const resetActivity = () => {
    if (!session) return

    timeoutAtRef.current = Date.now() + 20000
    setRemainingMs(20000)
  }

  useEffect(() => {
    if (!session) return

    timeoutAtRef.current = Date.now() + 20000
    setRemainingMs(20000)

    const timer = window.setInterval(() => {
      const remaining = Math.max(0, timeoutAtRef.current - Date.now())
      setRemainingMs(remaining)

      if (remaining <= 0) {
        window.clearInterval(timer)
        resetKiosk('Relácia bola ukončená. Načítaj ďalší QR alebo náramok.')
      }
    }, 200)

    return () => window.clearInterval(timer)
  }, [session?.token])

  useEffect(() => {
    const handleScannerKey = (event: globalThis.KeyboardEvent) => {
      if (session || event.ctrlKey || event.altKey || event.metaKey) return

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return

      const now = Date.now()
      if (now - scannerLastKeyAtRef.current > 1000) {
        scannerBufferRef.current = ''
      }
      scannerLastKeyAtRef.current = now

      if (event.key === 'Enter' || event.key === 'Tab') {
        const value = scannerBufferRef.current
        scannerBufferRef.current = ''
        if (value) {
          event.preventDefault()
          void processQr(value)
        }
        return
      }

      if (event.key.length === 1) {
        scannerBufferRef.current += event.key
      }
    }

    window.addEventListener('keydown', handleScannerKey)
    return () => window.removeEventListener('keydown', handleScannerKey)
  }, [session])

  const processQr = async (rawValue: string) => {
    const qrCode = normalizeQrInput(rawValue)

    if (!qrCode) {
      return { tone: 'warning' as const, message: 'QR kód je prázdny.' }
    }

    if (loadingRef.current) {
      return { tone: 'warning' as const, message: 'Spracovanie už prebieha.' }
    }

    loadingRef.current = true
    setLoading(true)
    setTone('warning')
    setMessage('Načítavam výber stravy...')

    try {
      const res = await fetch('/api/menu-kiosk/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrCode })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        const errorMessage = json.error || 'QR sa nepodarilo načítať.'
        setTone('error')
        setMessage(errorMessage)
        return { tone: 'error' as const, message: errorMessage }
      }

      setSession({
        token: json.token,
        userId: json.userId,
        personName: json.personName || 'Bez mena',
        defaultFood: json.defaultFood || null,
        today: json.today,
        menu: json.menu || [],
        selections: json.selections || [],
        deadlines: json.deadlines || []
      })
      setTone('success')
      setMessage('Osoba načítaná.')

      return { tone: 'success' as const, message: 'Osoba načítaná.' }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setTone('error')
      setMessage('Chyba spojenia so serverom: ' + errorMessage)
      return { tone: 'error' as const, message: 'Chyba spojenia so serverom.' }
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  if (session) {
    const progress = Math.max(0, Math.min(100, (remainingMs / 20000) * 100))
    const seconds = Math.ceil(remainingMs / 1000)

    return (
      <MenuClient
        userId={session.userId}
        today={session.today}
        defaultFood={session.defaultFood}
        menu={session.menu}
        selections={session.selections}
        deadlines={session.deadlines}
        submitUrl="/api/menu-kiosk/select"
        submitExtraBody={{ token: session.token }}
        kioskMode
        heading="Výber stravy"
        description="Vyber alebo odhlás jedlo. Po nečinnosti sa terminál automaticky odhlási."
        infoTitle="Zmeny sa ukladajú po kliknutí na konkrétnu možnosť."
        infoBody="Po skončení stlač Odhlásiť alebo nechaj terminál automaticky ukončiť reláciu."
        selectedPersonName={session.personName}
        onActivity={resetActivity}
        topSlot={
          <div style={styles.timerWrap}>
            <div style={styles.timerTop}>
              <b>Automatické odhlásenie</b>
              <span>{seconds}s</span>
            </div>
            <div style={styles.timerTrack}>
              <div style={{ ...styles.timerBar, width: `${progress}%` }} />
            </div>
            <button type="button" style={styles.logoutButton} onClick={() => resetKiosk('Relácia ukončená. Načítaj ďalší QR alebo náramok.')}>
              Odhlásiť
            </button>
          </div>
        }
      />
    )
  }

  return (
    <main className="menu-kiosk-page" style={styles.page}>
      <style>{`
        .menu-kiosk-page button,
        .menu-kiosk-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .menu-kiosk-page button:not(:disabled):active,
        .menu-kiosk-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        .menu-kiosk-page button:disabled {
          opacity: 0.62;
          cursor: wait;
        }

        @media (max-width: 720px) {
          .menu-kiosk-page { padding: 12px !important; }
          .menu-kiosk-bg-logo { top: 18px !important; width: min(86vw, 360px) !important; opacity: 0.36 !important; }
          .menu-kiosk-shell { padding-top: 96px !important; }
          .menu-kiosk-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .menu-kiosk-title { font-size: 30px !important; }
          .menu-kiosk-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <img className="menu-kiosk-bg-logo" src="/pohoda-30.svg" alt="" aria-hidden="true" style={styles.backgroundLogo} />

      <div className="menu-kiosk-shell" style={styles.shell}>
        <section className="menu-kiosk-card" style={styles.card}>
          <div style={styles.topBar}>
            <span style={styles.actor}>Terminál: {actorName}</span>

            {isAdmin && (
              <Link href="/dashboard" style={styles.homeButton}>
                Domov
              </Link>
            )}
          </div>

          <span style={styles.kicker}>Kiosk</span>
          <h1 className="menu-kiosk-title" style={styles.title}>Výber stravy</h1>

          <div
            style={{
              ...styles.statusBox,
              background: tone === 'error' ? '#ff6b6b' : tone === 'warning' ? '#fff3bf' : tone === 'success' ? '#56db3f' : '#fff'
            }}
          >
            <b>{message}</b>
            <span>Načítaj QR kód alebo náramok osoby.</span>
          </div>

          <div className="menu-kiosk-grid" style={styles.grid}>
            <section style={styles.panel}>
              <div style={styles.panelTitle}>Kamera</div>
              <QrCameraScanner
                disabled={loading}
                autoStopMs={300000}
                showLastMessage={false}
                placeholderAlt="Pohoda Pass"
                placeholderSrc="/icon.png"
                onScan={processQr}
              />
            </section>

            <section style={styles.panel}>
              <div style={styles.panelTitle}>Stav terminálu</div>
              <div style={styles.terminalStatusGrid}>
                <div style={styles.terminalStatusCard}>
                  <span style={styles.terminalLabel}>Skener</span>
                  <b style={styles.terminalValue}>{loading ? 'Spracováva' : 'Pripravený'}</b>
                </div>
                <div style={styles.terminalStatusCard}>
                  <span style={styles.terminalLabel}>Režim</span>
                  <b style={styles.terminalValue}>Výber stravy</b>
                </div>
                <div style={styles.terminalStatusCard}>
                  <span style={styles.terminalLabel}>Prístup</span>
                  <b style={styles.terminalValue}>Iba tento terminál</b>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: 24,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000',
    position: 'relative',
    overflow: 'hidden'
  },
  backgroundLogo: {
    position: 'absolute',
    top: 22,
    left: '50%',
    width: 'min(72vw, 560px)',
    maxHeight: 180,
    objectFit: 'contain',
    transform: 'translateX(-50%)',
    filter: 'brightness(0) invert(1)',
    opacity: 0.42,
    pointerEvents: 'none',
    zIndex: 0
  },
  shell: {
    maxWidth: 1040,
    margin: '0 auto',
    paddingTop: 124,
    position: 'relative',
    zIndex: 1
  },
  card: {
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 28,
    boxShadow: '12px 12px 0 #000'
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16
  },
  actor: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 950,
    background: '#fff'
  },
  homeButton: {
    border: '3px solid #000',
    borderRadius: 999,
    background: '#000',
    color: '#56db3f',
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000'
  },
  kicker: {
    display: 'block',
    fontSize: 13,
    fontWeight: 950,
    textTransform: 'uppercase',
    opacity: 0.65
  },
  title: {
    margin: '4px 0 16px 0',
    fontSize: 44,
    lineHeight: 1,
    fontWeight: 950
  },
  statusBox: {
    border: '3px solid #000',
    borderRadius: 20,
    padding: 16,
    display: 'grid',
    gap: 5,
    minHeight: 76,
    fontSize: 18,
    fontWeight: 900,
    marginBottom: 18
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)',
    gap: 16,
    alignItems: 'stretch'
  },
  panel: {
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: 950,
    marginBottom: 10
  },
  terminalStatusGrid: {
    display: 'grid',
    gap: 10
  },
  terminalStatusCard: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    background: '#f3f4f6',
    display: 'grid',
    gap: 4
  },
  terminalLabel: {
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase',
    opacity: 0.62
  },
  terminalValue: {
    fontSize: 17,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  timerWrap: {
    maxWidth: 760,
    margin: '0 auto 12px auto',
    border: '4px solid #000',
    borderRadius: 22,
    background: '#fff',
    padding: 12,
    boxShadow: '8px 8px 0 #000'
  },
  timerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    fontSize: 15,
    fontWeight: 950,
    marginBottom: 8
  },
  timerTrack: {
    height: 12,
    border: '3px solid #000',
    borderRadius: 999,
    overflow: 'hidden',
    background: '#fff'
  },
  timerBar: {
    height: '100%',
    background: '#56db3f',
    transition: 'width 180ms linear'
  },
  logoutButton: {
    marginTop: 10,
    minHeight: 42,
    width: '100%',
    border: '3px solid #000',
    borderRadius: 999,
    background: '#000',
    color: '#fff',
    padding: '0 16px',
    fontSize: 14,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  }
}
