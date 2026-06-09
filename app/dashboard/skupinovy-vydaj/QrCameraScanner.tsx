'use client'

import { BrowserQRCodeReader } from '@zxing/browser'
import jsQR from 'jsqr'
import { useEffect, useRef, useState, type CSSProperties } from 'react'

type Tone = 'success' | 'error' | 'warning'

type ScanResult = {
  tone: Tone
  message: string
}

type Props = {
  disabled?: boolean
  onScan: (value: string) => Promise<ScanResult>
}

function scanFlashColor(tone: Tone) {
  if (tone === 'success') return '#22c55e'
  if (tone === 'warning') return '#f59e0b'
  return '#ef4444'
}

function scanFlashLabel(tone: Tone) {
  if (tone === 'success') return 'PRIDANE'
  if (tone === 'warning') return 'ROZPOZNANE'
  return 'ZAMIETNUTE'
}

function makeCanvasImage(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxWidth = 720) {
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

export default function QrCameraScanner({ disabled, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanLoopRef = useRef<number | null>(null)
  const zxingReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const cancelledRef = useRef(false)
  const busyRef = useRef(false)
  const lastScanTextRef = useRef('')
  const lastScanTimeRef = useRef(0)
  const scanAttemptRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const flashTimerRef = useRef<number | null>(null)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('Kamera je vypnuta.')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchChanging, setTorchChanging] = useState(false)
  const [scanFlash, setScanFlash] = useState<Tone | null>(null)
  const [lastMessage, setLastMessage] = useState('')

  const playBeep = (type: 'ok' | 'error') => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass()
      }

      const ctx = audioCtxRef.current
      void ctx.resume?.()
      const oscillator = ctx.createOscillator()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()

      oscillator.type = type === 'ok' ? 'square' : 'sawtooth'
      oscillator.frequency.setValueAtTime(type === 'ok' ? 1320 : 185, ctx.currentTime)
      if (type === 'error') {
        oscillator.frequency.exponentialRampToValueAtTime(115, ctx.currentTime + 0.24)
      }

      const duration = type === 'ok' ? 0.14 : 0.32
      const peak = type === 'ok' ? 0.9 : 0.82

      filter.type = type === 'ok' ? 'highpass' : 'lowpass'
      filter.frequency.value = type === 'ok' ? 620 : 540

      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

      oscillator.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration + 0.02)
    } catch {
      // Audio can be unavailable on some devices.
    }

    try {
      if (navigator.vibrate) {
        navigator.vibrate(type === 'ok' ? 70 : [90, 60, 90])
      }
    } catch {
      // Vibration can be unavailable on some devices.
    }
  }

  const triggerScanFlash = (tone: Tone) => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current)
    }

    setScanFlash(tone)
    flashTimerRef.current = window.setTimeout(() => {
      setScanFlash(null)
      flashTimerRef.current = null
    }, 360)
  }

  const stopCamera = () => {
    cancelledRef.current = true

    if (scanLoopRef.current) {
      window.clearTimeout(scanLoopRef.current)
      scanLoopRef.current = null
    }

    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    zxingReaderRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraReady(false)
    setTorchAvailable(false)
    setTorchOn(false)
    setTorchChanging(false)
    setScanFlash(null)
    setCameraStatus('Kamera je vypnuta.')
  }

  const getCameraVideoTrack = () => {
    return streamRef.current?.getVideoTracks?.()[0] || null
  }

  const updateTorchSupport = () => {
    const track = getCameraVideoTrack() as any
    const capabilities = track?.getCapabilities?.()
    setTorchAvailable(Boolean(capabilities?.torch))
  }

  const setCameraTorch = async (enabled: boolean) => {
    const track = getCameraVideoTrack() as any

    if (!track?.applyConstraints) {
      setTorchAvailable(false)
      setTorchOn(false)
      setCameraStatus('Svetlo nie je na tomto zariadeni dostupne.')
      return
    }

    setTorchChanging(true)

    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled }]
      })

      setTorchOn(enabled)
      setCameraStatus(enabled ? 'Svetlo je zapnute. Skenujte QR.' : 'Svetlo je vypnute. Skenujte QR.')
    } catch {
      setTorchAvailable(false)
      setTorchOn(false)
      setCameraStatus('Svetlo nie je na tomto zariadeni dostupne.')
    } finally {
      setTorchChanging(false)
    }
  }

  const tryZxingQr = () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return ''

    try {
      if (!zxingReaderRef.current) {
        zxingReaderRef.current = new BrowserQRCodeReader()
      }

      const result = zxingReaderRef.current.decode(video)
      return String(result?.getText?.() || '').trim()
    } catch {
      return ''
    }
  }

  const tryPreprocessedQr = () => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video || !canvas || video.readyState < 2) return ''

    const image = makeCanvasImage(video, canvas)
    if (!image) return ''

    const processed = thresholdImage(image)
    const result = jsQR(processed, image.width, image.height, { inversionAttempts: 'attemptBoth' })

    return String(result?.data || '').trim()
  }

  const scanCameraFrame = async () => {
    if (cancelledRef.current || busyRef.current || disabled) return

    scanAttemptRef.current += 1

    let value = tryZxingQr()

    if (!value && scanAttemptRef.current % 3 === 0) {
      value = tryPreprocessedQr()
    }

    if (!value) return

    const nowMs = Date.now()

    if (nowMs - lastScanTimeRef.current < 300) return

    if (
      lastScanTextRef.current === value &&
      nowMs - lastScanTimeRef.current < 2500
    ) {
      return
    }

    lastScanTextRef.current = value
    lastScanTimeRef.current = nowMs
    busyRef.current = true

    try {
      const result = await onScan(value)
      setLastMessage(result.message)
      triggerScanFlash(result.tone)
      playBeep(result.tone === 'success' ? 'ok' : 'error')
    } catch (err: any) {
      setLastMessage(err?.message || 'QR sa nepodarilo spracovat.')
      triggerScanFlash('error')
      playBeep('error')
    } finally {
      busyRef.current = false
    }
  }

  const scheduleCameraScan = () => {
    if (cancelledRef.current) return

    scanLoopRef.current = window.setTimeout(async () => {
      await scanCameraFrame()
      scheduleCameraScan()
    }, 80)
  }

  const startCamera = async () => {
    setCameraReady(false)
    setTorchAvailable(false)
    setTorchOn(false)
    setTorchChanging(false)
    setCameraStatus('Spustam kameru...')
    cancelledRef.current = false

    try {
      if (!videoRef.current) {
        setCameraStatus('Video nie je pripravene.')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })

      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      scanAttemptRef.current = 0
      setCameraReady(true)
      updateTorchSupport()
      setCameraStatus('Kamera je zapnuta. Skenujte QR.')
      scheduleCameraScan()
    } catch (err: any) {
      setCameraReady(false)
      setCameraStatus(err?.message || 'Kamera sa nepodarila zapnut.')
    }
  }

  useEffect(() => {
    if (!cameraOpen) {
      stopCamera()
      return
    }

    startCamera()

    return () => stopCamera()
  }, [cameraOpen])

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current)
      }
      stopCamera()
    }
  }, [])

  return (
    <div style={styles.wrapper}>
      <div style={styles.actions}>
        <button
          type="button"
          onClick={() => setCameraOpen(value => !value)}
          disabled={disabled}
          style={styles.button}
        >
          {cameraOpen ? 'Vypnut kameru' : 'Zapnut kameru'}
        </button>
        <span style={styles.status}>{cameraStatus}</span>
      </div>

      {cameraOpen && (
        <div style={styles.cameraBox}>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={styles.video}
          />
          <canvas ref={canvasRef} style={styles.hiddenCanvas} />
          <div
            style={{
              ...styles.frame,
              borderColor: scanFlash ? scanFlashColor(scanFlash) : cameraReady ? '#22c55e' : '#f97316',
              boxShadow: scanFlash
                ? `0 0 0 999px ${scanFlashColor(scanFlash)}55, 0 0 26px ${scanFlashColor(scanFlash)}`
                : styles.frame.boxShadow
            }}
          />
          {scanFlash && (
            <div
              style={{
                ...styles.flashOverlay,
                background: `${scanFlashColor(scanFlash)}d9`
              }}
            >
              {scanFlashLabel(scanFlash)}
            </div>
          )}
          {!cameraReady && (
            <div style={styles.overlay}>
              {cameraStatus}
            </div>
          )}
          {torchAvailable && (
            <button
              type="button"
              onClick={() => setCameraTorch(!torchOn)}
              disabled={!cameraReady || torchChanging}
              style={styles.torchButton}
            >
              {torchOn ? 'Svetlo vyp' : 'Svetlo zap'}
            </button>
          )}
        </div>
      )}

      {lastMessage && <div style={styles.lastMessage}>{lastMessage}</div>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: 'grid',
    gap: 10
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  button: {
    minHeight: 38,
    border: '1px solid #111827',
    borderRadius: 6,
    background: '#111827',
    color: '#fff',
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 900
  },
  status: {
    fontSize: 12,
    fontWeight: 850,
    color: '#6b7280'
  },
  cameraBox: {
    position: 'relative',
    overflow: 'hidden',
    border: '1px solid #111827',
    borderRadius: 16,
    background: '#111827',
    aspectRatio: '1 / 1',
    maxHeight: 420
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block'
  },
  hiddenCanvas: {
    display: 'none'
  },
  frame: {
    position: 'absolute',
    inset: 28,
    border: '4px solid #22c55e',
    borderRadius: 18,
    boxShadow: '0 0 0 999px rgba(0,0,0,0.22)',
    pointerEvents: 'none',
    transition: 'border-color 120ms ease, box-shadow 120ms ease'
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: 900,
    background: 'rgba(0,0,0,0.55)',
    padding: 16,
    textAlign: 'center'
  },
  flashOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#000',
    fontSize: 28,
    fontWeight: 950,
    letterSpacing: 0
  },
  torchButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    minHeight: 38,
    border: '2px solid rgba(255,255,255,0.85)',
    borderRadius: 999,
    background: '#111827',
    color: '#fff',
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 950,
    boxShadow: '0 10px 24px rgba(0,0,0,0.24)'
  },
  lastMessage: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    padding: 10,
    color: '#374151',
    fontSize: 12,
    fontWeight: 850
  }
}
