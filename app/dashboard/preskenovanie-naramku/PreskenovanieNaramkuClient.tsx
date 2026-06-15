'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import QrCameraScanner from '@/app/dashboard/skupinovy-vydaj/QrCameraScanner'

type Step = 'PERSON' | 'WRISTBAND' | 'DONE'
type Tone = 'success' | 'error' | 'warning' | ''

type Person = {
  userId: string
  personName: string
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
    // QR values are usually plain text. URL parsing is only a compatibility path.
  }

  return text.replace(/\s+/g, '').trim()
}

function stepTitle(step: Step) {
  if (step === 'WRISTBAND') return 'Načítaj QR náramku'
  if (step === 'DONE') return 'Náramok je priradený'
  return 'Načítaj databázový QR osoby'
}

function statusBackground(tone: Tone) {
  if (tone === 'success') return '#56db3f'
  if (tone === 'error') return '#ff6b6b'
  if (tone === 'warning') return '#fff3bf'
  return '#fff'
}

export default function PreskenovanieNaramkuClient({
  actorName,
  isAdmin
}: {
  actorName: string
  isAdmin: boolean
}) {
  const manualInputRef = useRef<HTMLInputElement | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const stepTimeoutRef = useRef<number | null>(null)
  const stepRef = useRef<Step>('PERSON')
  const currentQrRef = useRef('')
  const personUserIdRef = useRef('')
  const loadingRef = useRef(false)

  const [step, setStep] = useState<Step>('PERSON')
  const [currentQr, setCurrentQr] = useState('')
  const [person, setPerson] = useState<Person | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [message, setMessage] = useState('Pripravené na preskenovanie.')
  const [tone, setTone] = useState<Tone>('')
  const [loading, setLoading] = useState(false)

  const resetFlow = () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
    if (stepTimeoutRef.current) {
      window.clearTimeout(stepTimeoutRef.current)
      stepTimeoutRef.current = null
    }

    setStep('PERSON')
    stepRef.current = 'PERSON'
    setCurrentQr('')
    currentQrRef.current = ''
    personUserIdRef.current = ''
    setPerson(null)
    setManualValue('')
    setMessage('Pripravené na preskenovanie.')
    setTone('')
    setLoading(false)
    loadingRef.current = false
    setTimeout(() => manualInputRef.current?.focus(), 80)
  }

  useEffect(() => {
    manualInputRef.current?.focus()

    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current)
      }
      if (stepTimeoutRef.current) {
        window.clearTimeout(stepTimeoutRef.current)
      }
    }
  }, [])

  const processQr = async (rawValue: string) => {
    const value = normalizeQrInput(rawValue)

    if (!value) {
      return { tone: 'warning' as const, message: 'QR kód je prázdny.' }
    }

    if (loadingRef.current) {
      return { tone: 'warning' as const, message: 'Spracovanie už prebieha.' }
    }

    const activeStep = stepRef.current

    if (activeStep === 'DONE') {
      resetFlow()
      return { tone: 'warning' as const, message: 'Začínam ďalšie preskenovanie.' }
    }

    loadingRef.current = true
    setLoading(true)
    setMessage('Spracovávam QR kód...')
    setTone('warning')

    try {
      const activeCurrentQr = currentQrRef.current || currentQr
      const activeUserId = personUserIdRef.current || person?.userId || ''
      const body = activeStep === 'PERSON'
        ? { mode: 'LOOKUP', currentQr: value }
        : { mode: 'REPLACE', currentQr: activeCurrentQr, wristbandQr: value, userId: activeUserId }

      const res = await fetch('/api/wristband-kiosk/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        const errorMessage = json.error || 'QR kód sa nepodarilo spracovať.'
        setMessage(errorMessage)
        setTone('error')
        return { tone: 'error' as const, message: errorMessage }
      }

      if (activeStep === 'PERSON') {
        currentQrRef.current = value
        setCurrentQr(value)
        personUserIdRef.current = json.userId || ''
        setPerson({
          userId: json.userId || '',
          personName: json.personName || 'Bez mena'
        })
        stepRef.current = 'WRISTBAND'
        setStep('WRISTBAND')
        stepTimeoutRef.current = window.setTimeout(() => {
          resetFlow()
        }, 20000)
        const okMessage = 'Osoba načítaná. Teraz načítaj náramok.'
        setMessage(okMessage)
        setTone('success')
        setManualValue('')
        setTimeout(() => manualInputRef.current?.focus(), 80)
        return { tone: 'success' as const, message: okMessage }
      }

      const okMessage = 'Náramok priradený.'
      if (stepTimeoutRef.current) {
        window.clearTimeout(stepTimeoutRef.current)
        stepTimeoutRef.current = null
      }
      setMessage(okMessage)
      setTone('success')
      stepRef.current = 'DONE'
      setStep('DONE')
      setManualValue('')
      resetTimerRef.current = window.setTimeout(() => {
        resetFlow()
      }, 2600)

      return { tone: 'success' as const, message: okMessage }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setMessage('Chyba spojenia so serverom: ' + errorMessage)
      setTone('error')
      return { tone: 'error' as const, message: 'Chyba spojenia so serverom.' }
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  const submitManual = async () => {
    const result = await processQr(manualValue)

    if (result.tone !== 'error') {
      setManualValue('')
    }
  }

  const handleManualKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return

    event.preventDefault()
    await submitManual()
  }

  return (
    <main className="wristband-kiosk-page" style={styles.page}>
      <style>{`
        .wristband-kiosk-page button,
        .wristband-kiosk-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .wristband-kiosk-page button:not(:disabled):active,
        .wristband-kiosk-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        .wristband-kiosk-page button:disabled {
          opacity: 0.62;
          cursor: wait;
        }

        @media (max-width: 720px) {
          .wristband-kiosk-page { padding: 12px !important; }
          .wristband-kiosk-bg-logo { top: 18px !important; width: min(86vw, 360px) !important; opacity: 0.36 !important; }
          .wristband-kiosk-shell { padding-top: 96px !important; }
          .wristband-kiosk-topbar { margin-bottom: 12px !important; }
          .wristband-kiosk-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .wristband-kiosk-title { font-size: 30px !important; }
          .wristband-kiosk-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <img className="wristband-kiosk-bg-logo" src="/pohoda-30.svg" alt="" aria-hidden="true" style={styles.backgroundLogo} />

      <div className="wristband-kiosk-shell" style={styles.shell}>
        <section className="wristband-kiosk-card" style={styles.card}>
          <div className="wristband-kiosk-topbar" style={styles.topBar}>
            <span style={styles.actor}>Obsluha: {actorName}</span>

            {isAdmin && (
              <Link href="/dashboard" style={styles.homeButton}>
                Domov
              </Link>
            )}
          </div>

          <div style={styles.titleRow}>
            <div>
              <span style={styles.kicker}>Preskenovanie náramku</span>
              <h1 className="wristband-kiosk-title" style={styles.title}>{stepTitle(step)}</h1>
            </div>
          </div>

          <div
            style={{
              ...styles.statusBox,
              background: statusBackground(tone)
            }}
          >
            <b>{message}</b>
            {person && (
              <span>
                Osoba: {person.personName}
              </span>
            )}
          </div>

          <div className="wristband-kiosk-grid" style={styles.grid}>
            <section style={styles.panel}>
              <div style={styles.panelTitle}>Kamera</div>
              <QrCameraScanner
                disabled={loading || step === 'DONE'}
                autoStopMs={60000}
                placeholderAlt="Pohoda Pass"
                placeholderSrc="/icon.png"
                onScan={processQr}
              />
            </section>

            <section style={styles.panel}>
              <div style={styles.panelTitle}>Ručné načítanie</div>
              <p style={styles.hint}>
                Pole slúži pre USB alebo Bluetooth čítačku. Po načítaní stlač Enter.
              </p>

              <input
                ref={manualInputRef}
                value={manualValue}
                onChange={event => setManualValue(event.target.value)}
                onKeyDown={handleManualKeyDown}
                style={styles.input}
                disabled={loading || step === 'DONE'}
                autoComplete="off"
                inputMode="text"
                placeholder={step === 'WRISTBAND' ? 'Načítaj QR náramku' : 'Načítaj aktuálny QR osoby'}
              />

              <div style={styles.actionRow}>
                <button
                  type="button"
                  style={styles.primaryButton}
                  disabled={loading || step === 'DONE'}
                  onClick={submitManual}
                >
                  {loading ? 'Spracúvam...' : 'Spracovať QR'}
                </button>

                <button
                  type="button"
                  style={styles.secondaryButton}
                  disabled={loading}
                  onClick={resetFlow}
                >
                  Začať odznova
                </button>
              </div>

              <div style={styles.stepsList}>
                <div style={step === 'PERSON' ? styles.activeStep : styles.step}>
                  1. Aktuálny QR osoby
                </div>
                <div style={step === 'WRISTBAND' ? styles.activeStep : styles.step}>
                  2. Nový QR náramku
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
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    marginBottom: 16
  },
  kicker: {
    display: 'block',
    fontSize: 13,
    fontWeight: 950,
    textTransform: 'uppercase',
    opacity: 0.65
  },
  title: {
    margin: '4px 0 0 0',
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
    alignItems: 'start'
  },
  panel: {
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    background: '#fff'
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: 950,
    marginBottom: 10
  },
  hint: {
    margin: '0 0 12px 0',
    fontSize: 13,
    lineHeight: 1.35,
    fontWeight: 800,
    opacity: 0.72
  },
  input: {
    width: '100%',
    height: 48,
    border: '3px solid #000',
    borderRadius: 12,
    padding: '0 12px',
    fontSize: 18,
    fontWeight: 900,
    outline: 'none',
    boxSizing: 'border-box'
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12
  },
  primaryButton: {
    minHeight: 44,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#56db3f',
    color: '#000',
    padding: '0 16px',
    fontSize: 14,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  secondaryButton: {
    minHeight: 44,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#fff',
    color: '#000',
    padding: '0 16px',
    fontSize: 14,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  stepsList: {
    display: 'grid',
    gap: 8,
    marginTop: 18
  },
  step: {
    border: '2px solid #000',
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    fontWeight: 900,
    background: '#f3f4f6'
  },
  activeStep: {
    border: '3px solid #000',
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    fontWeight: 950,
    background: '#fff3bf'
  }
}
