'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { BrowserQRCodeReader } from '@zxing/browser'
import jsQR from 'jsqr'

type ScanMode = 'AUTO' | 'BARCODE_DETECTOR' | 'ZXING' | 'JSQR' | 'JSQR_INVERT' | 'PREPROCESS'

type ScanHit = {
  id: string
  value: string
  engine: string
  elapsedMs: number
  attempt: number
  time: string
}

type Props = {
  actorName: string
}

const modes: Array<{ value: ScanMode; label: string; note: string }> = [
  { value: 'AUTO', label: 'Auto', note: 'BarcodeDetector, ZXing, jsQR a preprocessing v jednom teste.' },
  { value: 'BARCODE_DETECTOR', label: 'BarcodeDetector', note: 'Natívny scanner prehliadača, dostupný hlavne na Androide.' },
  { value: 'ZXING', label: 'ZXing', note: 'Aktuálny rýchly scanner, ktorý používame v aplikácii.' },
  { value: 'JSQR', label: 'jsQR', note: 'Čistý QR scanner pre bežný kontrast.' },
  { value: 'JSQR_INVERT', label: 'jsQR invert', note: 'Cielený pokus pre biely QR na tmavom podklade.' },
  { value: 'PREPROCESS', label: 'Preprocessing', note: 'Úprava obrazu pre farebné a tmavé podklady.' }
]

function formatTime(value: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
}

function deviceSummary() {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent
}

function makeCanvasImage(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth: number) {
  const videoWidth = video.videoWidth || 1280
  const videoHeight = video.videoHeight || 720
  const scale = Math.min(1, maxWidth / videoWidth)
  const width = Math.max(1, Math.round(videoWidth * scale))
  const height = Math.max(1, Math.round(videoHeight * scale))

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function thresholdImage(imageData: ImageData) {
  const source = imageData.data
  const output = new Uint8ClampedArray(source.length)
  let total = 0
  const pixels = source.length / 4

  for (let index = 0; index < source.length; index += 4) {
    total += source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114
  }

  const threshold = total / pixels

  for (let index = 0; index < source.length; index += 4) {
    const luminance = source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114
    const value = luminance >= threshold ? 255 : 0
    output[index] = value
    output[index + 1] = value
    output[index + 2] = value
    output[index + 3] = 255
  }

  return output
}

export default function ScannerTestClient({ actorName }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const zxingRef = useRef<BrowserQRCodeReader | null>(null)
  const detectorRef = useRef<any>(null)
  const loopRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const lastValueRef = useRef('')
  const lastHitTimeRef = useRef(0)
  const attemptRef = useRef(0)

  const [mode, setMode] = useState<ScanMode>('AUTO')
  const [running, setRunning] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [status, setStatus] = useState('Kamera je vypnutá.')
  const [nativeStatus, setNativeStatus] = useState('Kontrolujem...')
  const [hits, setHits] = useState<ScanHit[]>([])
  const [lastEngine, setLastEngine] = useState('-')
  const [lastElapsed, setLastElapsed] = useState(0)
  const [attempts, setAttempts] = useState(0)
  const [intervalMs, setIntervalMs] = useState(80)
  const [maxWidth, setMaxWidth] = useState(720)
  const [manualValue, setManualValue] = useState('')
  const [userAgent, setUserAgent] = useState('')

  const selectedMode = modes.find(item => item.value === mode) || modes[0]

  useEffect(() => {
    setUserAgent(deviceSummary())

    const BarcodeDetectorClass = (window as any).BarcodeDetector
    if (!BarcodeDetectorClass) {
      setNativeStatus('BarcodeDetector nie je dostupný.')
      return
    }

    const getSupportedFormats = BarcodeDetectorClass.getSupportedFormats

    if (typeof getSupportedFormats !== 'function') {
      setNativeStatus('BarcodeDetector je dostupný, ale bez kontroly formátov.')
      return
    }

    getSupportedFormats()
      .then((formats: string[]) => {
        setNativeStatus(
          formats.includes('qr_code')
            ? 'BarcodeDetector podporuje qr_code.'
            : `BarcodeDetector je dostupný, ale qr_code nie je v podporovaných formátoch: ${formats.join(', ')}`
        )
      })
      .catch(() => setNativeStatus('BarcodeDetector je dostupný, ale formáty sa nepodarilo overiť.'))
  }, [])

  const stopCamera = () => {
    runningRef.current = false

    if (loopRef.current) {
      window.clearTimeout(loopRef.current)
      loopRef.current = null
    }

    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setRunning(false)
    setCameraReady(false)
    setStatus('Kamera je vypnutá.')
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const prepareBarcodeDetector = () => {
    const BarcodeDetectorClass = (window as any).BarcodeDetector

    if (!BarcodeDetectorClass) return null
    if (!detectorRef.current) {
      detectorRef.current = new BarcodeDetectorClass({ formats: ['qr_code'] })
    }

    return detectorRef.current
  }

  const tryBarcodeDetector = async (video: HTMLVideoElement) => {
    const detector = prepareBarcodeDetector()
    if (!detector) return null

    const results = await detector.detect(video)
    const value = String(results?.[0]?.rawValue || '').trim()

    return value ? { value, engine: 'BarcodeDetector' } : null
  }

  const tryZxing = (video: HTMLVideoElement) => {
    try {
      if (!zxingRef.current) {
        zxingRef.current = new BrowserQRCodeReader()
      }

      const result = zxingRef.current.decode(video)
      const value = String(result?.getText?.() || '').trim()

      return value ? { value, engine: 'ZXing' } : null
    } catch {
      return null
    }
  }

  const tryJsQr = (video: HTMLVideoElement, inversionAttempts: 'dontInvert' | 'onlyInvert' | 'attemptBoth', engine: string) => {
    if (!canvasRef.current) return null

    const image = makeCanvasImage(video, canvasRef.current, maxWidth)
    if (!image) return null

    const result = jsQR(image.data, image.width, image.height, { inversionAttempts })
    const value = String(result?.data || '').trim()

    return value ? { value, engine } : null
  }

  const tryPreprocess = (video: HTMLVideoElement) => {
    if (!canvasRef.current) return null

    const image = makeCanvasImage(video, canvasRef.current, maxWidth)
    if (!image) return null

    const data = thresholdImage(image)
    const result = jsQR(data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
    const value = String(result?.data || '').trim()

    return value ? { value, engine: 'Preprocessing' } : null
  }

  const registerHit = (value: string, engine: string, elapsedMs: number, attempt: number) => {
    const now = Date.now()

    setLastEngine(engine)
    setLastElapsed(elapsedMs)

    if (lastValueRef.current === value && now - lastHitTimeRef.current < 1400) return

    lastValueRef.current = value
    lastHitTimeRef.current = now

    setHits(prev => [{
      id: `${now}-${engine}`,
      value,
      engine,
      elapsedMs,
      attempt,
      time: new Date().toISOString()
    }, ...prev].slice(0, 20))
  }

  const scanOnce = async () => {
    const video = videoRef.current
    if (!runningRef.current || !video || video.readyState < 2) return

    const startedAt = performance.now()
    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    setAttempts(attempt)

    try {
      let hit: { value: string; engine: string } | null = null

      if (mode === 'BARCODE_DETECTOR' || mode === 'AUTO') {
        hit = await tryBarcodeDetector(video)
      }

      if (!hit && (mode === 'ZXING' || mode === 'AUTO')) {
        hit = tryZxing(video)
      }

      if (!hit && (mode === 'JSQR' || mode === 'AUTO')) {
        hit = tryJsQr(video, 'dontInvert', 'jsQR')
      }

      if (!hit && (mode === 'JSQR_INVERT' || mode === 'AUTO')) {
        hit = tryJsQr(video, 'onlyInvert', 'jsQR invert')
      }

      if (!hit && (mode === 'PREPROCESS' || mode === 'AUTO')) {
        hit = tryPreprocess(video)
      }

      if (hit) {
        registerHit(hit.value, hit.engine, Math.round(performance.now() - startedAt), attempt)
      } else {
        setLastEngine('-')
        setLastElapsed(Math.round(performance.now() - startedAt))
      }
    } catch (err: any) {
      setStatus(err?.message || 'Chyba pri skenovaní.')
    }
  }

  const scheduleLoop = () => {
    if (!runningRef.current) return

    loopRef.current = window.setTimeout(async () => {
      await scanOnce()
      scheduleLoop()
    }, intervalMs)
  }

  const startCamera = async () => {
    if (runningRef.current) return

    setStatus('Spúšťam kameru...')
    setCameraReady(false)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })

      streamRef.current = stream

      if (!videoRef.current) {
        throw new Error('Video prvok nie je pripravený.')
      }

      videoRef.current.srcObject = stream
      await videoRef.current.play()

      runningRef.current = true
      setRunning(true)
      setCameraReady(true)
      setStatus('Kamera je zapnutá. Namier QR kód do rámika.')
      scheduleLoop()
    } catch (err: any) {
      stopCamera()
      setStatus(err?.message || 'Kameru sa nepodarilo zapnúť.')
    }
  }

  const addManualHit = () => {
    const value = manualValue.trim()
    if (!value) return

    registerHit(value, 'Manuálny vstup', 0, attemptRef.current)
    setManualValue('')
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>POHODA 2026</div>
          <h1 style={styles.title}>Test QR skenera</h1>
          <div style={styles.actor}>{actorName}</div>
        </div>

        <Link href="/dashboard" style={styles.backButton}>Späť</Link>
      </header>

      <section style={styles.layout}>
        <div style={styles.cameraPanel}>
          <div style={styles.cameraTop}>
            <div>
              <span style={styles.label}>Režim</span>
              <strong>{selectedMode.label}</strong>
            </div>
            <div style={{
              ...styles.liveBadge,
              background: cameraReady ? '#dcfce7' : '#ffedd5',
              color: cameraReady ? '#166534' : '#9a3412'
            }}>
              {cameraReady ? 'kamera beží' : 'kamera vypnutá'}
            </div>
          </div>

          <div style={styles.videoWrap}>
            <video ref={videoRef} muted playsInline style={styles.video} />
            <div style={styles.scanFrame} />
          </div>

          <div style={styles.controls}>
            <button
              type="button"
              onClick={running ? stopCamera : startCamera}
              style={running ? styles.stopButton : styles.startButton}
            >
              {running ? 'Vypnúť kameru' : 'Zapnúť kameru'}
            </button>

            <select
              value={mode}
              onChange={event => setMode(event.target.value as ScanMode)}
              style={styles.select}
              disabled={running}
            >
              {modes.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.statusBox}>
            <b>{status}</b>
            <span>{selectedMode.note}</span>
          </div>
        </div>

        <aside style={styles.sidePanel}>
          <div style={styles.metricsGrid}>
            <div style={styles.metric}>
              <span>Pokusy</span>
              <b>{attempts}</b>
            </div>
            <div style={styles.metric}>
              <span>Posledný engine</span>
              <b>{lastEngine}</b>
            </div>
            <div style={styles.metric}>
              <span>Čas pokusu</span>
              <b>{lastElapsed} ms</b>
            </div>
            <div style={styles.metric}>
              <span>Nálezy</span>
              <b>{hits.length}</b>
            </div>
          </div>

          <div style={styles.tuningBox}>
            <label style={styles.field}>
              <span>Interval pokusu: {intervalMs} ms</span>
              <input
                type="range"
                min="40"
                max="240"
                step="20"
                value={intervalMs}
                onChange={event => setIntervalMs(Number(event.target.value))}
                style={styles.range}
              />
            </label>

            <label style={styles.field}>
              <span>Šírka spracovania: {maxWidth}px</span>
              <input
                type="range"
                min="360"
                max="1280"
                step="80"
                value={maxWidth}
                onChange={event => setMaxWidth(Number(event.target.value))}
                style={styles.range}
              />
            </label>
          </div>

          <div style={styles.nativeBox}>
            <b>Natívny scanner</b>
            <span>{nativeStatus}</span>
          </div>

          <div style={styles.manualBox}>
            <input
              value={manualValue}
              onChange={event => setManualValue(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') addManualHit()
              }}
              placeholder="Manuálny QR vstup"
              style={styles.manualInput}
            />
            <button type="button" onClick={addManualHit} style={styles.manualButton}>
              Pridať
            </button>
          </div>
        </aside>
      </section>

      <section style={styles.resultsGrid}>
        <div style={styles.resultsPanel}>
          <h2 style={styles.sectionTitle}>Posledné nálezy</h2>
          {hits.length === 0 ? (
            <div style={styles.empty}>Zatiaľ bez načítaného QR.</div>
          ) : (
            <div style={styles.hitList}>
              {hits.map(hit => (
                <div key={hit.id} style={styles.hitItem}>
                  <div>
                    <b>{hit.engine}</b>
                    <span>{hit.value}</span>
                  </div>
                  <em>{hit.elapsedMs} ms · pokus {hit.attempt} · {formatTime(hit.time)}</em>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.resultsPanel}>
          <h2 style={styles.sectionTitle}>Zariadenie</h2>
          <pre style={styles.userAgent}>{userAgent}</pre>
        </div>
      </section>

      <canvas ref={canvasRef} style={styles.hiddenCanvas} />
    </main>
  )
}

const baseButton: CSSProperties = {
  minHeight: 48,
  borderRadius: 8,
  border: '1px solid #111827',
  fontSize: 15,
  fontWeight: 900,
  cursor: 'pointer'
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    color: '#111827',
    fontFamily: 'Arial, Helvetica, sans-serif',
    padding: 12,
    display: 'grid',
    gap: 12,
    maxWidth: 1180,
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: '#111827',
    color: '#fff',
    borderRadius: 8,
    padding: 16
  },
  kicker: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0
  },
  title: {
    margin: 0,
    fontSize: 32,
    lineHeight: 1.05,
    fontWeight: 950
  },
  actor: {
    marginTop: 6,
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: 750
  },
  backButton: {
    ...baseButton,
    minHeight: 44,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    color: '#111827',
    textDecoration: 'none',
    padding: '0 14px'
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.45fr) minmax(300px, 0.55fr)',
    gap: 12
  },
  cameraPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 12
  },
  cameraTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  label: {
    display: 'block',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 850,
    textTransform: 'uppercase'
  },
  liveBadge: {
    border: '1px solid currentColor',
    borderRadius: 999,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 900
  },
  videoWrap: {
    position: 'relative',
    background: '#020617',
    borderRadius: 8,
    overflow: 'hidden',
    aspectRatio: '4 / 3',
    minHeight: 320
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block'
  },
  scanFrame: {
    position: 'absolute',
    inset: '18%',
    border: '3px solid #22c55e',
    borderRadius: 8,
    boxShadow: '0 0 0 999px rgba(0,0,0,0.16)',
    pointerEvents: 'none'
  },
  controls: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10
  },
  startButton: {
    ...baseButton,
    background: '#16a34a',
    color: '#fff',
    borderColor: '#15803d'
  },
  stopButton: {
    ...baseButton,
    background: '#fee2e2',
    color: '#991b1b',
    borderColor: '#fecaca'
  },
  select: {
    minHeight: 48,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    padding: '0 12px',
    fontSize: 15,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  statusBox: {
    display: 'grid',
    gap: 4,
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14
  },
  sidePanel: {
    display: 'grid',
    alignContent: 'start',
    gap: 12
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  metric: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 4
  },
  tuningBox: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 12
  },
  field: {
    display: 'grid',
    gap: 8,
    fontSize: 13,
    fontWeight: 850
  },
  range: {
    width: '100%'
  },
  nativeBox: {
    background: '#eff6ff',
    color: '#1e3a8a',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 6,
    fontSize: 13,
    fontWeight: 750
  },
  manualBox: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12
  },
  manualInput: {
    minHeight: 44,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    padding: '0 10px',
    fontSize: 16
  },
  manualButton: {
    ...baseButton,
    minHeight: 44,
    background: '#111827',
    color: '#fff',
    padding: '0 14px'
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 0.9fr',
    gap: 12
  },
  resultsPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    minWidth: 0
  },
  sectionTitle: {
    margin: '0 0 10px',
    fontSize: 18,
    fontWeight: 950
  },
  empty: {
    background: '#f9fafb',
    border: '1px dashed #d1d5db',
    borderRadius: 8,
    padding: 14,
    color: '#6b7280',
    fontSize: 14,
    fontWeight: 750
  },
  hitList: {
    display: 'grid',
    gap: 8
  },
  hitItem: {
    display: 'grid',
    gap: 6,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    padding: 10
  },
  userAgent: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: '#374151'
  },
  hiddenCanvas: {
    display: 'none'
  }
}
