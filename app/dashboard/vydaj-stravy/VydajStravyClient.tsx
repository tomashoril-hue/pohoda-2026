'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { BrowserQRCodeReader } from '@zxing/browser'
import jsQR from 'jsqr'

type Meal = 'OBED' | 'VECERA'
type Tone = 'success' | 'error' | 'warning'

type ScanItem = {
  id: string
  itemType?: 'INDIVIDUAL' | 'BULK'
  typJedla: string
  status: string
  tone: Tone
  message: string
  personName: string
  email: string
  choice: string
  method: string
  groupName: string
  issuedId: string
  issuedAt: string
  detail?: string
  summary?: {
    MASO: number
    VEGE: number
    DIETA: number
    NEZADANE?: number
  }
  children?: ScanItem[]
}

type ActiveIssue = {
  id: string
  groupName: string
  typJedla: string
  status: string
  validAfter: string
}

type ChoiceSummary = {
  MASO: number
  VEGE: number
  DIETA: number
  NEZADANE?: number
}

type BulkIssueOption = {
  id: string
  groupId: string
  groupName: string
  count: number
  summary: ChoiceSummary
  includesScannedPerson: boolean
}

type IssueDecision = {
  qrCode: string
  personName: string
  email: string
  choice: string
  individual: {
    available: boolean
    alreadyIssued: boolean
    hasEntitlement: boolean
  }
  bulkIssues: BulkIssueOption[]
}

type ChoiceStats = {
  total: number
  issued: number
}

type MealStats = {
  total: number
  issued: number
  MASO: ChoiceStats
  VEGE: ChoiceStats
  DIETA: ChoiceStats
  NEZADANE: ChoiceStats
}

function emptyMealStats(issued = 0): MealStats {
  return {
    total: 0,
    issued,
    MASO: { total: 0, issued: 0 },
    VEGE: { total: 0, issued: 0 },
    DIETA: { total: 0, issued: 0 },
    NEZADANE: { total: 0, issued: 0 }
  }
}

function formatTime(value: string) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function mealLabel(value: string) {
  if (value === 'VECERA') return 'VEČERA'
  return 'OBED'
}

function choiceLabel(value: string) {
  if (value === 'DIETA') return 'DIÉTA'
  if (value === 'NEZADANE') return 'NEZADANÉ'
  if (value === 'VEGE') return 'VEGE'
  if (value === 'MASO') return 'MASO'
  return '-'
}

function methodLabel(value: string) {
  if (value === 'HROMADNE') return 'HROMADNE'
  if (value === 'INDIVIDUALNE') return 'INDIVIDUÁLNE'
  return ''
}

function issueStatusLabel(value: string) {
  if (value === 'READY') return 'aktívna'
  if (value === 'WAITING') return 'čaká'
  return value.toLowerCase()
}

function toneOf(status: string, ok: boolean): Tone {
  if (ok) return 'success'
  if (status === 'ALREADY_ISSUED') return 'warning'
  return 'error'
}

function historyStatusLabel(item: ScanItem) {
  if (item.status === 'ISSUED' && item.method === 'HROMADNE') {
    return 'Vydané hromadne'
  }

  return item.message
}

function historyDetail(item: ScanItem) {
  if (item.detail) return item.detail

  const name = item.personName || item.email || '-'

  if (item.method === 'HROMADNE') {
    const summary = item.summary
    const counts = summary
      ? [
          summary.MASO ? `${summary.MASO} x MASO` : '',
          summary.VEGE ? `${summary.VEGE} x VEGE` : '',
          summary.DIETA ? `${summary.DIETA} x DIÉTA` : '',
          summary.NEZADANE ? `${summary.NEZADANE} x NEZADANÉ` : ''
        ].filter(Boolean).join(' · ')
      : ''

    const group = item.groupName
      ? `${item.groupName} (hromadný výdaj)`
      : 'Hromadný výdaj'

    return `${name} · ${group}${counts ? ` · ${counts}` : ''}`
  }

  return `${name}${item.choice ? ` · 1 x ${choiceLabel(item.choice)}` : ''}`
}

function changedIssueDetail(items: ScanItem[], nextChoices: Record<string, string>) {
  const changes = items.map(item => {
    const name = item.personName || item.email || 'Bez mena'
    const from = choiceLabel(item.choice || 'NEZADANE')
    const to = choiceLabel(nextChoices[item.issuedId] || 'NEZADANE')

    return { name, from, to }
  })

  if (changes.length <= 5) {
    return changes
      .map(change => `${change.name}: ${change.from} → ${change.to}`)
      .join(' · ')
  }

  const counts = new Map<string, number>()

  changes.forEach(change => {
    const key = `${change.from} → ${change.to}`
    counts.set(key, (counts.get(key) || 0) + 1)
  })

  return Array.from(counts.entries())
    .map(([change, count]) => `${change}: ${count}`)
    .join(' · ')
}

function personCountLabel(count: number) {
  if (count === 1) return '1 osoba'
  if (count >= 2 && count <= 4) return `${count} osoby`
  return `${count} osôb`
}

function choiceSummaryLabel(summary: ChoiceSummary) {
  return [
    summary.MASO ? `${summary.MASO} x MASO` : '',
    summary.VEGE ? `${summary.VEGE} x VEGE` : '',
    summary.DIETA ? `${summary.DIETA} x DIÉTA` : '',
    summary.NEZADANE ? `${summary.NEZADANE} x NEZADANÉ` : ''
  ].filter(Boolean).join(' · ')
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

function makeScanId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function VydajStravyClient({
  actorName,
  initialDate,
  initialMeal,
  issueMode,
  activeIssues
}: {
  actorName: string
  initialDate: string
  initialMeal: string
  issueMode: 'FULL' | 'BASIC'
  activeIssues: ActiveIssue[]
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
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
  const decisionOpenRef = useRef(false)

  const [datum, setDatum] = useState(initialDate)
  const [typJedla, setTypJedla] = useState<Meal>(initialMeal === 'VECERA' ? 'VECERA' : 'OBED')
  const [qrValue, setQrValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('Kamera je vypnutá.')
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchChanging, setTorchChanging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<ScanItem[]>([])
  const [successCount, setSuccessCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [mealStats, setMealStats] = useState<Record<Meal, MealStats>>({
    OBED: emptyMealStats(),
    VECERA: emptyMealStats()
  })
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [recentIssued, setRecentIssued] = useState<ScanItem[]>([])
  const [selectedCancelIds, setSelectedCancelIds] = useState<string[]>([])
  const [editChoices, setEditChoices] = useState<Record<string, string>>({})
  const [cancelLoading, setCancelLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [issueDecision, setIssueDecision] = useState<IssueDecision | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const fullMode = issueMode === 'FULL'
  const lastItem = history[0] || null
  const showManualQrControls = !isMobile || !cameraOpen
  const selectedCancelTopItems = recentIssued.filter(item => selectedCancelIds.includes(item.issuedId))
  const selectedCancelChildItems = recentIssued.flatMap(item => {
    if (!item.children?.length || selectedCancelIds.includes(item.issuedId)) return []

    return item.children.filter(child => selectedCancelIds.includes(child.issuedId))
  })
  const selectedCancelItems = [...selectedCancelTopItems, ...selectedCancelChildItems]
  const editableIssuedItems = recentIssued.flatMap(item => item.children?.length ? item.children : [item])
  const changedChoiceCount = editableIssuedItems.filter(item => {
    const nextChoice = editChoices[item.issuedId]
    return nextChoice && nextChoice !== item.choice
  }).length

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const updateMobileState = () => setIsMobile(query.matches)

    updateMobileState()

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', updateMobileState)
      return () => query.removeEventListener('change', updateMobileState)
    }

    query.addListener(updateMobileState)
    return () => query.removeListener(updateMobileState)
  }, [])

  const playBeep = (type: 'ok' | 'error') => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass()
      }

      const ctx = audioCtxRef.current
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = type === 'ok' ? 980 : 220

      const duration = type === 'ok' ? 0.18 : 0.34

      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration + 0.02)
    } catch {
      // zvuk nemusí byť dostupný
    }

    try {
      if (navigator.vibrate) {
        navigator.vibrate(type === 'ok' ? 70 : [90, 60, 90])
      }
    } catch {
      // vibrácia nemusí byť dostupná
    }
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
    setCameraStatus('Kamera je vypnutá.')
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
      setCameraStatus('Svetlo nie je na tomto zariadení dostupné.')
      return
    }

    setTorchChanging(true)

    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled }]
      })

      setTorchOn(enabled)
      setCameraStatus(enabled ? 'Svetlo je zapnuté. Skenujte QR kódy postupne.' : 'Svetlo je vypnuté. Skenujte QR kódy postupne.')
    } catch {
      setTorchAvailable(false)
      setTorchOn(false)
      setCameraStatus('Svetlo nie je na tomto zariadení dostupné.')
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
    if (cancelledRef.current || decisionOpenRef.current || busyRef.current) return

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

    await submitQr(value)
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
    setCameraStatus('Spúšťam kameru...')
    cancelledRef.current = false

    try {
      if (!videoRef.current) {
        setCameraStatus('Video nie je pripravené.')
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
      setCameraStatus('Kamera je zapnutá. Skenujte QR kódy postupne.')
      scheduleCameraScan()
    } catch (err: any) {
      setCameraReady(false)
      setCameraStatus(err?.message || 'Kamera sa nepodarila zapnúť. Použi manuálne pole.')
      setTimeout(() => inputRef.current?.focus(), 80)
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

  const addHistory = (item: ScanItem) => {
    setHistory(prev => [item, ...prev].slice(0, 24))
  }

  const refreshRecentIssuedInBackground = () => {
    if (!fullMode) return

    refreshRecentIssued().catch(() => {
      // Obnova prehľadov nesmie blokovať ďalšie skenovanie.
    })
  }

  const refreshRecentIssued = async () => {
    const params = new URLSearchParams({
      datum,
      typJedla
    })

    const res = await fetch(`/api/vydaj-stravy/recent?${params.toString()}`)
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) return

    const items: ScanItem[] = (json.items || []).map((item: any) => ({
      id: item.issuedId,
      itemType: item.itemType || 'INDIVIDUAL',
      typJedla: item.typJedla,
      status: 'ISSUED',
      tone: 'success',
      message: item.method === 'HROMADNE' ? 'Vydané hromadne' : 'Vydané',
      personName: item.personName || '',
      email: item.email || '',
      choice: item.choice || '',
      method: item.method || '',
      groupName: item.groupName || '',
      issuedId: item.issuedId || '',
      issuedAt: item.issuedAt || '',
      summary: item.summary || undefined,
      children: (item.children || []).map((child: any) => ({
        id: child.issuedId,
        itemType: 'INDIVIDUAL',
        typJedla: child.typJedla,
        status: 'ISSUED',
        tone: 'success',
        message: child.method === 'HROMADNE' ? 'Vydané hromadne' : 'Vydané',
        personName: child.personName || '',
        email: child.email || '',
        choice: child.choice || '',
        method: child.method || '',
        groupName: child.groupName || '',
        issuedId: child.issuedId || '',
        issuedAt: child.issuedAt || ''
      }))
    }))
    const editableItems = items.flatMap(item => item.children?.length ? item.children : [item])

    setRecentIssued(items)
    setEditChoices(Object.fromEntries(editableItems.map(item => [item.issuedId, item.choice || ''])))
    setSelectedCancelIds(prev => prev.filter(id => items.some(item => item.issuedId === id)))
  }

  const refreshStats = async () => {
    setStatsLoading(true)
    setStatsError('')

    try {
      const params = new URLSearchParams({ datum })
      const res = await fetch(`/api/vydaj-stravy/stats?${params.toString()}`)
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.ok || !json.stats) {
        setStatsError(json.error || 'Prehľad sa nepodarilo načítať.')
        return
      }

      setMealStats(json.stats)
    } catch {
      setStatsError('Prehľad sa nepodarilo načítať.')
    } finally {
      setStatsLoading(false)
    }
  }

  const openStats = () => {
    setStatsOpen(true)
    refreshStats()
  }

  useEffect(() => {
    setSelectedCancelIds([])
    if (fullMode) {
      refreshRecentIssued()
    } else {
      setRecentIssued([])
    }
  }, [datum, typJedla, fullMode])

  const submitQr = async (
    manualValue?: string,
    issueAction?: 'INDIVIDUAL' | 'BULK',
    bulkIssueId?: string
  ) => {
    const cleanQr = String(manualValue ?? qrValue).trim()
    if (!cleanQr || busyRef.current || (decisionOpenRef.current && !issueAction)) return

    busyRef.current = true
    setLoading(true)

    try {
      const res = await fetch('/api/vydaj-stravy/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrCode: cleanQr,
          datum,
          typJedla,
          issueAction,
          bulkIssueId
        })
      })

      const json = await res.json().catch(() => ({}))

      if (json.status === 'ISSUE_DECISION_REQUIRED') {
        decisionOpenRef.current = true
        setIssueDecision({
          qrCode: cleanQr,
          personName: String(json.person?.fullName || ''),
          email: String(json.person?.email || ''),
          choice: String(json.choice || ''),
          individual: {
            available: Boolean(json.individual?.available),
            alreadyIssued: Boolean(json.individual?.alreadyIssued),
            hasEntitlement: Boolean(json.individual?.hasEntitlement)
          },
          bulkIssues: (json.bulkIssues || []).map((issue: any) => ({
            id: String(issue.id || ''),
            groupId: String(issue.groupId || ''),
            groupName: String(issue.groupName || ''),
            count: Number(issue.count || 0),
            summary: issue.summary || {
              MASO: 0,
              VEGE: 0,
              DIETA: 0,
              NEZADANE: 0
            },
            includesScannedPerson: Boolean(issue.includesScannedPerson)
          }))
        })
        setQrValue('')
        return
      }

      const ok = !!json.ok && res.ok
      const tone = toneOf(String(json.status || ''), ok)
      const item: ScanItem = {
        id: makeScanId(),
        typJedla,
        status: String(json.status || (ok ? 'ISSUED' : 'ERROR')),
        tone,
        message: String(json.message || json.error || 'Nepodarilo sa spracovať QR.'),
        personName: String(json.person?.fullName || ''),
        email: String(json.person?.email || ''),
        choice: String(json.choice || ''),
        method: String(json.method || ''),
        groupName: String(json.groupName || ''),
        issuedId: String(json.issuedId || ''),
        issuedAt: String(json.issuedAt || new Date().toISOString()),
        summary: json.bulkSummary || undefined
      }

      addHistory(item)

      if (ok) {
        const issuedCount = Math.max(1, Number(json.issuedCount || 1))
        playBeep('ok')
        setSuccessCount(prev => prev + issuedCount)
        if (item.issuedId) {
          setSelectedCancelIds([item.issuedId])
        }
        refreshRecentIssuedInBackground()
      } else {
        playBeep('error')
        setErrorCount(prev => prev + 1)
      }

      setQrValue('')
    } catch (err: any) {
      playBeep('error')
      setErrorCount(prev => prev + 1)
      addHistory({
        id: `${Date.now()}-error`,
        typJedla,
        status: 'ERROR',
        tone: 'error',
        message: err?.message || 'Chyba spojenia so serverom.',
        personName: '',
        email: '',
        choice: '',
        method: '',
        groupName: '',
        issuedId: '',
        issuedAt: new Date().toISOString()
      })
    } finally {
      busyRef.current = false
      setLoading(false)
      if (!decisionOpenRef.current) {
        setTimeout(() => inputRef.current?.focus(), 70)
      }
    }
  }

  const closeIssueDecision = () => {
    if (loading) return

    decisionOpenRef.current = false
    setIssueDecision(null)
    setTimeout(() => inputRef.current?.focus(), 70)
  }

  const confirmIssueDecision = async (
    issueAction: 'INDIVIDUAL' | 'BULK',
    bulkIssueId?: string
  ) => {
    if (!issueDecision || loading) return

    const qrCode = issueDecision.qrCode
    decisionOpenRef.current = false
    setIssueDecision(null)
    await submitQr(qrCode, issueAction, bulkIssueId)
  }

  const toggleCancelSelection = (issuedId: string) => {
    setSelectedCancelIds(prev => {
      if (prev.includes(issuedId)) {
        return prev.filter(id => id !== issuedId)
      }

      return [...prev, issuedId]
    })
  }

  const toggleBulkCancelSelection = (item: ScanItem) => {
    setSelectedCancelIds(prev => {
      const childIds = (item.children || []).map(child => child.issuedId)

      if (prev.includes(item.issuedId)) {
        return prev.filter(id => id !== item.issuedId)
      }

      return [...prev.filter(id => !childIds.includes(id)), item.issuedId]
    })
  }

  const toggleBulkChildCancelSelection = (parent: ScanItem, child: ScanItem) => {
    setSelectedCancelIds(prev => {
      const withoutParent = prev.filter(id => id !== parent.issuedId)

      if (withoutParent.includes(child.issuedId)) {
        return withoutParent.filter(id => id !== child.issuedId)
      }

      return [...withoutParent, child.issuedId]
    })
  }

  const saveChoiceChanges = async () => {
    const changedItems = editableIssuedItems.filter(item => {
      const nextChoice = editChoices[item.issuedId]
      return nextChoice && nextChoice !== item.choice
    })

    if (!changedItems.length || editLoading) return

    setEditLoading(true)

    try {
      for (const item of changedItems) {
        const res = await fetch('/api/vydaj-stravy/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issuedId: item.issuedId,
            choice: editChoices[item.issuedId]
          })
        })

        const json = await res.json().catch(() => ({}))

        if (!res.ok || !json.ok) {
          throw new Error(json.error || `Úprava sa nepodarila pre ${item.personName || item.email || 'osobu'}.`)
        }
      }

      playBeep('ok')
      addHistory({
        id: `${Date.now()}-edit`,
        typJedla,
        status: 'UPDATED',
        tone: 'success',
        message: changedItems.length === 1
          ? 'Upravený výdaj'
          : `Upravené výdaje · ${personCountLabel(changedItems.length)}`,
        personName: '',
        email: '',
        choice: '',
        method: '',
        groupName: '',
        issuedId: '',
        issuedAt: new Date().toISOString(),
        detail: changedIssueDetail(changedItems, editChoices)
      })
      await refreshRecentIssued()
    } catch (err: any) {
      playBeep('error')
      addHistory({
        id: `${Date.now()}-edit-error`,
        typJedla,
        status: 'UPDATE_ERROR',
        tone: 'error',
        message: err?.message || 'Úprava sa nepodarila.',
        personName: '',
        email: '',
        choice: '',
        method: '',
        groupName: '',
        issuedId: '',
        issuedAt: new Date().toISOString()
      })
    } finally {
      setEditLoading(false)
      setTimeout(() => inputRef.current?.focus(), 70)
    }
  }

  const cancelSelectedIssued = async () => {
    if (!selectedCancelItems.length || cancelLoading) return

    setCancelLoading(true)

    const cancelledIds: string[] = []

    try {
      const itemsToCancel = selectedCancelItems.flatMap(item => item.children?.length ? item.children : [item])
      const idsToCancel = itemsToCancel.map(item => item.issuedId).filter(Boolean)

      if (!idsToCancel.length) return

      const res = await fetch('/api/vydaj-stravy/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuedIds: idsToCancel })
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Storno sa nepodarilo.')
      }

      cancelledIds.push(...idsToCancel)

      selectedCancelItems.forEach(item => {
        const count = item.children?.length || 1
        addHistory({
          ...item,
          id: `${Date.now()}-cancel-${item.issuedId}`,
          status: 'CANCELLED',
          tone: 'warning',
          personName: item.itemType === 'BULK'
            ? item.groupName || item.personName || 'Hromadný výdaj'
            : item.personName,
          email: '',
          message: item.itemType === 'BULK'
            ? `Hromadný výdaj bol stornovaný (${count} osôb).`
            : 'Výdaj bol stornovaný.'
        })
      })

      playBeep('ok')
      await refreshRecentIssued()
      setSelectedCancelIds([])
    } catch (err: any) {
      playBeep('error')
      addHistory({
        id: `${Date.now()}-cancel-error`,
        typJedla,
        status: 'CANCEL_ERROR',
        tone: 'error',
        message: err?.message || 'Storno sa nepodarilo.',
        personName: '',
        email: '',
        choice: '',
        method: '',
        groupName: '',
        issuedId: '',
        issuedAt: new Date().toISOString()
      })
      if (cancelledIds.length > 0) {
        await refreshRecentIssued()
      }
    } finally {
      setCancelLoading(false)
      setTimeout(() => inputRef.current?.focus(), 70)
    }
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submitQr()
  }

  return (
    <main style={{ ...styles.page, ...(isMobile ? styles.pageMobile : {}) }}>
      <header style={{ ...styles.header, ...(isMobile ? styles.headerMobile : {}) }}>
        <div style={isMobile ? styles.mobileHeaderText : undefined}>
          <div style={styles.kicker}>POHODA 2026</div>
          <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>Výdaj stravy</h1>
          <div style={{ ...styles.actor, ...(isMobile ? styles.actorMobile : {}) }}>{actorName}</div>
        </div>

        {!isMobile && <Link href="/dashboard" style={styles.backButton}>Späť</Link>}
      </header>

      {!isMobile && (
        <section style={styles.toolbar}>
          <label style={styles.field}>
            <span>Dátum</span>
            <input
              type="date"
              value={datum}
              onChange={event => setDatum(event.target.value)}
              style={styles.dateInput}
            />
          </label>

          <div style={styles.mealSwitch}>
            {(['OBED', 'VECERA'] as Meal[]).map(meal => (
              <button
                key={meal}
                type="button"
                onClick={() => setTypJedla(meal)}
                style={{
                  ...styles.mealButton,
                  ...(typJedla === meal ? styles.mealButtonActive : {})
                }}
              >
                {mealLabel(meal)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ ...styles.scanGrid, ...(isMobile ? styles.scanGridMobile : {}) }}>
        <div style={{ ...styles.scanPanel, ...(isMobile ? styles.scanPanelMobile : {}) }}>
          <div style={{ ...styles.scanTop, ...(isMobile ? styles.scanTopMobile : {}) }}>
            <div>
              <div style={styles.scanLabel}>Aktuálny výdaj</div>
              <h2 style={{ ...styles.scanMeal, ...(isMobile ? styles.scanMealMobile : {}) }}>{mealLabel(typJedla)}</h2>
            </div>

            <div style={{ ...styles.liveBadge, ...(isMobile ? styles.liveBadgeMobile : {}) }}>{loading ? 'Spracúvam' : 'Pripravené'}</div>
          </div>

          {showManualQrControls && (
            <>
              <input
                ref={inputRef}
                type="password"
                value={qrValue}
                onChange={event => setQrValue(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Načítaj QR"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="QR kód"
                style={{ ...styles.qrInput, ...(isMobile ? styles.qrInputMobile : {}) }}
                disabled={loading || Boolean(issueDecision)}
              />

              <button
                type="button"
                onClick={() => submitQr()}
                disabled={loading || Boolean(issueDecision) || !qrValue.trim()}
                style={{
                  ...styles.primaryButton,
                  ...(isMobile ? styles.primaryButtonMobile : {}),
                  opacity: loading || issueDecision || !qrValue.trim() ? 0.55 : 1
                }}
              >
                {loading ? 'Kontrolujem...' : 'Vydať stravu'}
              </button>
            </>
          )}

          <div style={{ ...styles.cameraActions, ...(isMobile ? styles.cameraActionsMobile : {}) }}>
            {(!isMobile || !cameraOpen) && (
              <button
                type="button"
                onClick={() => setCameraOpen(prev => !prev)}
                style={{ ...styles.secondaryButton, ...(isMobile ? styles.cameraToggleMobile : {}) }}
              >
                {cameraOpen ? 'Vypnúť kameru' : 'Zapnúť kameru'}
              </button>
            )}

            <span style={{ ...styles.cameraStatus, ...(isMobile ? styles.cameraStatusMobile : {}) }}>
              {cameraReady ? '● ' : ''}
              {cameraStatus}
            </span>
          </div>

          {cameraOpen && (
            <div style={{ ...styles.cameraBox, ...(isMobile ? styles.cameraBoxMobile : {}) }}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                style={styles.cameraVideo}
              />
              <canvas ref={canvasRef} style={styles.hiddenCanvas} />

              <div
                style={{
                  ...styles.cameraFrame,
                  borderColor: cameraReady ? '#22c55e' : '#f97316'
                }}
              />

              {!cameraReady && (
                <div style={styles.cameraOverlay}>
                  {cameraStatus}
                </div>
              )}

              <button
                type="button"
                style={{
                  ...styles.torchButton,
                  opacity: cameraReady && torchAvailable && !torchChanging ? 1 : 0.55,
                  background: torchOn ? '#facc15' : '#111827',
                  color: torchOn ? '#111827' : '#fff'
                }}
                onClick={() => setCameraTorch(!torchOn)}
                disabled={!cameraReady || !torchAvailable || torchChanging}
              >
                {torchChanging ? '...' : torchOn ? 'Svetlo zap.' : 'Svetlo'}
              </button>
            </div>
          )}
        </div>

        <aside style={{
          ...styles.resultPanel,
          ...(isMobile ? styles.resultPanelMobile : {}),
          ...(lastItem ? styles[`tone_${lastItem.tone}`] : {})
        }}>
          {!lastItem ? (
            <>
              <div style={{ ...styles.resultEmpty, ...(isMobile ? styles.resultEmptyMobile : {}) }}>Čaká sa na prvý QR kód.</div>
              <div style={{ ...styles.resultHint, ...(isMobile ? styles.resultHintMobile : {}) }}>Systém najprv overí blokovanie, nárok, duplicitu výdaja a prípadnú hromadnú prípravu.</div>
            </>
          ) : (
            <>
              <div style={{ ...styles.resultStatus, ...(isMobile ? styles.resultStatusMobile : {}) }}>{lastItem.message}</div>
              <div style={{ ...styles.resultName, ...(isMobile ? styles.resultNameMobile : {}) }}>{lastItem.personName || 'Bez mena'}</div>
              {lastItem.email && <div style={styles.resultSub}>{lastItem.email}</div>}

              <div style={styles.badges}>
                {lastItem.choice && <span style={styles.badge}>{choiceLabel(lastItem.choice)}</span>}
                {lastItem.method && <span style={styles.badge}>{methodLabel(lastItem.method)}</span>}
                {lastItem.groupName && <span style={styles.badge}>{lastItem.groupName}</span>}
              </div>

              {lastItem.issuedAt && (
                <div style={styles.resultTime}>{formatTime(lastItem.issuedAt)}</div>
              )}
            </>
          )}
        </aside>
      </section>

      <section style={{ ...styles.statsGrid, ...(isMobile ? styles.statsGridMobile : {}) }}>
        <div style={styles.statBoxGreen}>
          <span>Vydané teraz</span>
          <b>{successCount}</b>
        </div>
        <div style={styles.statBoxRed}>
          <span>Kontroly stop</span>
          <b>{errorCount}</b>
        </div>
        <button type="button" onClick={openStats} style={styles.statsButton}>
          Prehľad stravy
        </button>
      </section>

      {issueDecision && (
        <div style={styles.modalBackdrop}>
          <div style={styles.decisionModal}>
            <div style={styles.decisionHeader}>
              <div>
                <div style={styles.decisionKicker}>OPRÁVNENÁ OSOBA</div>
                <h2 style={styles.decisionTitle}>Vyber spôsob výdaja</h2>
                <p style={styles.decisionPerson}>
                  {issueDecision.personName || issueDecision.email || 'Bez mena'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeIssueDecision}
                disabled={loading}
                style={styles.closeButton}
              >
                Zavrieť
              </button>
            </div>

            <div style={styles.decisionList}>
              {issueDecision.bulkIssues.map(issue => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => confirmIssueDecision('BULK', issue.id)}
                  disabled={loading}
                  style={styles.bulkDecisionButton}
                >
                  <span style={styles.decisionAction}>VYDAŤ HROMADNE</span>
                  <b style={styles.decisionGroup}>{issue.groupName || 'Skupina'}</b>
                  <span style={styles.decisionSummary}>
                    {personCountLabel(issue.count)}
                    {choiceSummaryLabel(issue.summary) ? ` · ${choiceSummaryLabel(issue.summary)}` : ''}
                  </span>
                  <span style={issue.includesScannedPerson
                    ? styles.decisionIncluded
                    : styles.decisionExcluded}
                  >
                    {issue.includesScannedPerson ? 'Vrátane porcie: ' : 'Bez porcie: '}
                    {issueDecision.personName || issueDecision.email || 'Bez mena'}
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => confirmIssueDecision('INDIVIDUAL')}
                disabled={loading || !issueDecision.individual.available}
                style={{
                  ...styles.individualDecisionButton,
                  opacity: loading || !issueDecision.individual.available ? 0.5 : 1
                }}
              >
                <span style={styles.decisionAction}>
                  {issueDecision.individual.available
                    ? 'VYDAŤ IBA OSOBNE'
                    : issueDecision.individual.alreadyIssued
                      ? 'UŽ VYDANÉ OSOBNE'
                      : 'BEZ OSOBNÉHO NÁROKU'}
                </span>
                <b style={styles.decisionGroup}>
                  {issueDecision.personName || issueDecision.email || 'Bez mena'}
                </b>
                {issueDecision.choice && (
                  <span style={styles.decisionSummary}>1 x {choiceLabel(issueDecision.choice)}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {statsOpen && (
        <div style={styles.modalBackdrop} onClick={() => setStatsOpen(false)}>
          <div style={styles.statsModal} onClick={event => event.stopPropagation()}>
            <div style={styles.statsModalHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Prehľad stravy</h2>
                <p style={styles.cancelHint}>{datum} · všetky terminály</p>
              </div>
              <button type="button" onClick={() => setStatsOpen(false)} style={styles.closeButton}>
                Zavrieť
              </button>
            </div>

            {statsLoading ? (
              <div style={styles.emptyHistory}>Načítavam aktuálny stav...</div>
            ) : statsError ? (
              <div style={styles.statsError}>{statsError}</div>
            ) : (
              <div style={styles.statsMealGrid}>
                {(['OBED', 'VECERA'] as Meal[]).map(meal => (
                  <section key={meal} style={styles.statsMealBox}>
                    <div style={styles.statsMealHeader}>
                      <h3 style={styles.statsMealTitle}>{mealLabel(meal)}</h3>
                      <b>{mealStats[meal].issued} / {mealStats[meal].total}</b>
                    </div>
                    <div style={styles.statsTableHeader}>
                      <span>Strava</span>
                      <span>Nárok</span>
                      <span>Vydané</span>
                    </div>
                    {(['MASO', 'VEGE', 'DIETA'] as const).map(choice => (
                      <div key={choice} style={styles.statsTableRow}>
                        <b>{choiceLabel(choice)}</b>
                        <span>{mealStats[meal][choice].total}</span>
                        <span>{mealStats[meal][choice].issued}</span>
                      </div>
                    ))}
                    {(mealStats[meal].NEZADANE.total > 0 || mealStats[meal].NEZADANE.issued > 0) && (
                      <div style={styles.statsTableRow}>
                        <b>NEZADANÉ</b>
                        <span>{mealStats[meal].NEZADANE.total}</span>
                        <span>{mealStats[meal].NEZADANE.issued}</span>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}

            <button type="button" onClick={refreshStats} disabled={statsLoading} style={styles.secondaryButton}>
              {statsLoading ? 'Načítavam...' : 'Obnoviť stav'}
            </button>
          </div>
        </div>
      )}

      {fullMode && (
      <section style={styles.actionsRow}>
        <button type="button" onClick={() => setCancelOpen(true)} style={styles.cancelButton}>
          Storno výdajov
        </button>
        {cancelOpen && (
          <div style={styles.modalBackdrop} onClick={() => setCancelOpen(false)}>
            <div style={styles.cancelBox} onClick={event => event.stopPropagation()}>
          <div style={styles.cancelHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Storno posledných výdajov</h2>
              <p style={styles.cancelHint}>Vyber jeden alebo viac z posledných 10 výdajov.</p>
            </div>

            <button
              type="button"
              onClick={cancelSelectedIssued}
              disabled={!selectedCancelItems.length || cancelLoading}
              style={{
                ...styles.cancelButton,
                opacity: !selectedCancelItems.length || cancelLoading ? 0.45 : 1
              }}
            >
              {cancelLoading ? 'Stornujem...' : `Stornovať (${selectedCancelItems.length})`}
            </button>
            <button
              type="button"
              onClick={saveChoiceChanges}
              disabled={!changedChoiceCount || editLoading}
              style={{
                ...styles.saveButton,
                opacity: !changedChoiceCount || editLoading ? 0.45 : 1
              }}
            >
              {editLoading ? 'Ukladám...' : `Uložiť úpravy (${changedChoiceCount})`}
            </button>
          </div>

          {recentIssued.length === 0 ? (
            <div style={styles.emptyHistory}>Zatiaľ nie je čo stornovať.</div>
          ) : (
            <div style={styles.cancelList}>
              {recentIssued.map(item => {
                const isBulk = item.itemType === 'BULK' && !!item.children?.length

                if (isBulk) {
                  return (
                    <div key={item.issuedId} style={styles.bulkCancelItem}>
                      <label style={styles.bulkCancelHeader}>
                        <input
                          type="checkbox"
                          checked={selectedCancelIds.includes(item.issuedId)}
                          onChange={() => toggleBulkCancelSelection(item)}
                          style={styles.cancelCheckbox}
                        />
                        <span>
                          <b>{item.groupName || item.personName || 'Hromadný výdaj'}</b>
                          <em>{mealLabel(item.typJedla)} · {formatTime(item.issuedAt)} · {item.children?.length || 0} osôb</em>
                        </span>
                      </label>
                      <details style={styles.bulkDetails}>
                        <summary style={styles.bulkSummary}>Zobraziť osoby</summary>
                        <div style={styles.bulkChildren}>
                          {(item.children || []).map(child => (
                            <div key={child.issuedId} style={styles.childEditRow}>
                              <input
                                type="checkbox"
                                checked={selectedCancelIds.includes(child.issuedId)}
                                onChange={() => toggleBulkChildCancelSelection(item, child)}
                                style={styles.cancelCheckbox}
                                aria-label={`Stornovať ${child.personName || child.email || 'osobu'}`}
                              />
                              <span>
                                <b>{child.personName || child.email || '-'}</b>
                                <em>{child.email || choiceLabel(child.choice)}</em>
                              </span>
                              <select
                                value={editChoices[child.issuedId] || child.choice || ''}
                                onChange={event => setEditChoices(prev => ({
                                  ...prev,
                                  [child.issuedId]: event.target.value
                                }))}
                                style={styles.choiceSelect}
                              >
                                <option value="" disabled>NEZADANÉ</option>
                                <option value="MASO">MASO</option>
                                <option value="VEGE">VEGE</option>
                                <option value="DIETA">DIÉTA</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )
                }

                return (
                  <label key={item.issuedId} style={styles.cancelItem}>
                    <input
                      type="checkbox"
                      checked={selectedCancelIds.includes(item.issuedId)}
                      onChange={() => toggleCancelSelection(item.issuedId)}
                      style={styles.cancelCheckbox}
                    />
                    <span>
                      <b>{item.personName || item.email || '-'}</b>
                      <em>{mealLabel(item.typJedla)} · {formatTime(item.issuedAt)}</em>
                    </span>
                    <select
                      value={editChoices[item.issuedId] || item.choice || ''}
                      onChange={event => setEditChoices(prev => ({
                        ...prev,
                        [item.issuedId]: event.target.value
                      }))}
                      style={styles.choiceSelect}
                    >
                      <option value="" disabled>NEZADANÉ</option>
                      <option value="MASO">MASO</option>
                      <option value="VEGE">VEGE</option>
                      <option value="DIETA">DIÉTA</option>
                    </select>
                  </label>
                )
              })}
            </div>
          )}
            </div>
          </div>
        )}
      </section>
      )}

      {isMobile && (
        <section style={styles.mobileNavStack}>
          <div style={styles.mobileActionRow}>
            <Link href="/dashboard" style={styles.mobileBackButton}>Späť</Link>

            <button
              type="button"
              onClick={() => setSettingsOpen(prev => !prev)}
              style={styles.mobileSettingsButton}
            >
              Nastavenie výdaja
            </button>
          </div>

          {settingsOpen && (
            <div style={styles.mobileSettingsPanel}>
              <label style={styles.field}>
                <span>Dátum</span>
                <input
                  type="date"
                  value={datum}
                  onChange={event => setDatum(event.target.value)}
                  style={styles.dateInput}
                />
              </label>

              <div style={styles.mealSwitch}>
                {(['OBED', 'VECERA'] as Meal[]).map(meal => (
                  <button
                    key={meal}
                    type="button"
                    onClick={() => setTypJedla(meal)}
                    style={{
                      ...styles.mealButton,
                      ...(typJedla === meal ? styles.mealButtonActive : {})
                    }}
                  >
                    {mealLabel(meal)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {fullMode && activeIssues.length > 0 && (
        <section style={styles.activeBox}>
          <h2 style={styles.sectionTitle}>Aktívne prípravy</h2>
          <div style={styles.activeList}>
            {activeIssues.map(issue => (
              <div key={issue.id} style={{ ...styles.activeIssue, ...(isMobile ? styles.activeIssueMobile : {}) }}>
                <b>{mealLabel(issue.typJedla)}</b>
                <span>{issue.groupName}</span>
                <em>{issueStatusLabel(issue.status)}</em>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={styles.historyBox}>
        <h2 style={styles.sectionTitle}>Posledné načítania</h2>
        {history.length === 0 ? (
          <div style={styles.emptyHistory}>Zatiaľ bez záznamu.</div>
        ) : (
          <div style={styles.historyList}>
            {history.map(item => (
              <div key={item.id} style={{
                ...styles.historyItem,
                ...(isMobile ? styles.historyItemMobile : {}),
                ...(item.tone === 'success'
                  ? styles.historySuccess
                  : item.tone === 'warning'
                    ? styles.historyWarning
                    : styles.historyError)
              }}>
                <div style={styles.historyText}>
                  <b>{historyStatusLabel(item)}</b>
                  <span>{historyDetail(item)}</span>
                </div>
                <em>{formatTime(item.issuedAt)}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

const baseButton: CSSProperties = {
  minHeight: 56,
  borderRadius: 8,
  border: '1px solid #111827',
  fontSize: 17,
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
    maxWidth: 1120,
    margin: '0 auto'
  },
  pageMobile: {
    padding: 6,
    gap: 6,
    maxWidth: '100%',
    width: '100%',
    boxSizing: 'border-box'
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
  headerMobile: {
    alignItems: 'flex-start',
    padding: '7px 9px',
    gap: 4
  },
  mobileHeaderText: {
    minWidth: 0
  },
  kicker: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0
  },
  title: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.05,
    fontWeight: 950
  },
  titleMobile: {
    fontSize: 21
  },
  actor: {
    marginTop: 6,
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: 750
  },
  actorMobile: {
    marginTop: 3,
    fontSize: 12
  },
  backButton: {
    ...baseButton,
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    color: '#111827',
    textDecoration: 'none',
    padding: '0 16px'
  },
  toolbar: {
    display: 'grid',
    gridTemplateColumns: 'minmax(170px, 230px) 1fr',
    gap: 10,
    alignItems: 'end'
  },
  mobileNavStack: {
    display: 'grid',
    gap: 6,
    width: '100%',
    minWidth: 0
  },
  mobileActionRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(78px, 0.38fr) minmax(0, 1fr)',
    gap: 6,
    width: '100%',
    minWidth: 0
  },
  mobileBackButton: {
    ...baseButton,
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f59e0b',
    borderColor: '#d97706',
    color: '#111827',
    textDecoration: 'none',
    padding: '0 10px',
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 14
  },
  mobileSettingsButton: {
    ...baseButton,
    minHeight: 42,
    background: '#2563eb',
    borderColor: '#1d4ed8',
    color: '#fff',
    padding: '0 10px',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'center',
    fontSize: 14
  },
  mobileSettingsPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gap: 10,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 13,
    fontWeight: 850
  },
  dateInput: {
    height: 56,
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    padding: '0 12px',
    fontSize: 17,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  mealSwitch: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10
  },
  mealButton: {
    ...baseButton,
    background: '#fff',
    color: '#111827'
  },
  mealButtonActive: {
    background: '#2563eb',
    color: '#fff',
    borderColor: '#1d4ed8'
  },
  scanGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(280px, 0.85fr)',
    gap: 12
  },
  scanGridMobile: {
    gridTemplateColumns: '1fr',
    gap: 6,
    width: '100%',
    minWidth: 0
  },
  scanPanel: {
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    padding: 14,
    display: 'grid',
    gap: 12
  },
  scanPanelMobile: {
    padding: 8,
    gap: 7,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  scanTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  scanTopMobile: {
    alignItems: 'flex-start'
  },
  scanLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 850
  },
  scanMeal: {
    margin: 0,
    fontSize: 36,
    fontWeight: 950
  },
  scanMealMobile: {
    fontSize: 24
  },
  liveBadge: {
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  liveBadgeMobile: {
    padding: '6px 8px',
    fontSize: 11
  },
  qrInput: {
    width: '100%',
    boxSizing: 'border-box',
    height: 68,
    borderRadius: 8,
    border: '2px solid #111827',
    padding: '0 14px',
    fontSize: 22,
    fontWeight: 900,
    outline: 'none'
  },
  qrInputMobile: {
    height: 58,
    fontSize: 18
  },
  primaryButton: {
    ...baseButton,
    minHeight: 64,
    background: '#16a34a',
    borderColor: '#15803d',
    color: '#fff',
    fontSize: 20
  },
  primaryButtonMobile: {
    minHeight: 58,
    fontSize: 18
  },
  cameraActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  cameraActionsMobile: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 5
  },
  secondaryButton: {
    ...baseButton,
    background: '#111827',
    color: '#fff',
    padding: '0 14px'
  },
  cameraToggleMobile: {
    width: '100%',
    minHeight: 48,
    fontSize: 16
  },
  cameraStatus: {
    color: '#475569',
    fontSize: 13,
    fontWeight: 750
  },
  cameraStatusMobile: {
    fontSize: 11
  },
  cameraBox: {
    position: 'relative',
    width: '100%',
    height: 280,
    background: '#020617',
    borderRadius: 8,
    overflow: 'hidden'
  },
  cameraBoxMobile: {
    height: 'min(39vh, 330px)',
    minHeight: 210,
    width: '100%',
    minWidth: 0
  },
  cameraVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  cameraFrame: {
    position: 'absolute',
    inset: '13% 18%',
    border: '4px solid',
    borderRadius: 12,
    pointerEvents: 'none',
    boxShadow: '0 0 0 999px rgba(2,6,23,0.22)'
  },
  cameraOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 16,
    color: '#fff',
    fontSize: 14,
    fontWeight: 900,
    background: 'rgba(2,6,23,0.58)'
  },
  torchButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    border: 0,
    borderRadius: 999,
    padding: '9px 12px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  hiddenCanvas: {
    display: 'none'
  },
  resultPanel: {
    minHeight: 260,
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    padding: 18,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 10
  },
  resultPanelMobile: {
    minHeight: 98,
    padding: 10,
    gap: 5,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  tone_success: {
    background: '#dcfce7',
    borderColor: '#22c55e',
    color: '#14532d'
  },
  tone_error: {
    background: '#fee2e2',
    borderColor: '#ef4444',
    color: '#7f1d1d'
  },
  tone_warning: {
    background: '#fef3c7',
    borderColor: '#f59e0b',
    color: '#78350f'
  },
  resultEmpty: {
    fontSize: 28,
    fontWeight: 950
  },
  resultEmptyMobile: {
    fontSize: 18
  },
  resultHint: {
    fontSize: 14,
    fontWeight: 750,
    color: '#475569'
  },
  resultHintMobile: {
    fontSize: 11
  },
  resultStatus: {
    fontSize: 36,
    fontWeight: 950,
    lineHeight: 1
  },
  resultStatusMobile: {
    fontSize: 23,
    lineHeight: 1.05
  },
  resultName: {
    fontSize: 26,
    fontWeight: 950
  },
  resultNameMobile: {
    fontSize: 18
  },
  resultSub: {
    fontSize: 15,
    fontWeight: 750
  },
  badges: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
  },
  badge: {
    background: '#111827',
    color: '#fff',
    borderRadius: 999,
    padding: '7px 10px',
    fontSize: 13,
    fontWeight: 950
  },
  resultTime: {
    fontSize: 20,
    fontWeight: 950
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10
  },
  statsGridMobile: {
    gridTemplateColumns: '1fr',
    gap: 8
  },
  statBoxGreen: {
    background: '#dcfce7',
    border: '1px solid #86efac',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 6
  },
  statBoxRed: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 6
  },
  statsButton: {
    ...baseButton,
    background: '#2563eb',
    borderColor: '#1d4ed8',
    color: '#fff',
    padding: '0 14px'
  },
  actionsRow: {
    display: 'grid'
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12
  },
  decisionModal: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    display: 'grid',
    gap: 14,
    width: 'min(720px, 100%)',
    maxHeight: '92vh',
    overflowY: 'auto'
  },
  decisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: 12
  },
  decisionKicker: {
    color: '#166534',
    fontSize: 12,
    fontWeight: 950
  },
  decisionTitle: {
    margin: '3px 0 0',
    fontSize: 27,
    fontWeight: 950
  },
  decisionPerson: {
    margin: '6px 0 0',
    color: '#475569',
    fontSize: 16,
    fontWeight: 850
  },
  decisionList: {
    display: 'grid',
    gap: 10
  },
  bulkDecisionButton: {
    minHeight: 112,
    border: '2px solid #15803d',
    borderRadius: 8,
    background: '#dcfce7',
    color: '#14532d',
    padding: 14,
    display: 'grid',
    gap: 5,
    textAlign: 'left',
    cursor: 'pointer'
  },
  individualDecisionButton: {
    minHeight: 96,
    border: '2px solid #1d4ed8',
    borderRadius: 8,
    background: '#dbeafe',
    color: '#1e3a8a',
    padding: 14,
    display: 'grid',
    gap: 5,
    textAlign: 'left',
    cursor: 'pointer'
  },
  decisionAction: {
    fontSize: 19,
    fontWeight: 950
  },
  decisionGroup: {
    fontSize: 25,
    lineHeight: 1.05
  },
  decisionSummary: {
    fontSize: 15,
    fontWeight: 850
  },
  decisionIncluded: {
    color: '#166534',
    fontSize: 15,
    fontWeight: 950
  },
  decisionExcluded: {
    color: '#b91c1c',
    fontSize: 15,
    fontWeight: 950
  },
  statsModal: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 12,
    width: 'min(720px, 100%)',
    maxHeight: '86vh',
    overflowY: 'auto'
  },
  statsModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  closeButton: {
    ...baseButton,
    minHeight: 44,
    background: '#fff',
    color: '#111827',
    padding: '0 12px'
  },
  statsMealGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 10
  },
  statsMealBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gap: 8
  },
  statsMealHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  statsMealTitle: {
    margin: 0,
    fontSize: 18
  },
  statsTableHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 72px 72px',
    gap: 8,
    color: '#64748b',
    fontSize: 12,
    fontWeight: 850
  },
  statsTableRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 72px 72px',
    gap: 8,
    borderTop: '1px solid #e5e7eb',
    paddingTop: 8,
    fontSize: 15
  },
  statsError: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#991b1b',
    padding: 10,
    fontWeight: 800
  },
  cancelBox: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 10,
    width: 'min(560px, 100%)',
    maxHeight: '86vh',
    overflowY: 'auto'
  },
  cancelHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 10,
    alignItems: 'center'
  },
  cancelHint: {
    margin: 0,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 750
  },
  cancelButton: {
    ...baseButton,
    background: '#f59e0b',
    borderColor: '#d97706',
    color: '#111827',
    padding: '0 14px'
  },
  saveButton: {
    ...baseButton,
    background: '#16a34a',
    borderColor: '#15803d',
    color: '#fff',
    padding: '0 14px'
  },
  cancelList: {
    display: 'grid',
    gap: 8
  },
  cancelItem: {
    minHeight: 52,
    display: 'grid',
    gridTemplateColumns: '28px 1fr 110px',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    background: '#f8fafc',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 850
  },
  cancelCheckbox: {
    width: 22,
    height: 22
  },
  bulkCancelItem: {
    borderRadius: 8,
    background: '#f8fafc',
    padding: 10,
    display: 'grid',
    gap: 8
  },
  bulkCancelHeader: {
    minHeight: 52,
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
    fontWeight: 850
  },
  bulkDetails: {
    display: 'grid',
    gap: 8
  },
  bulkSummary: {
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 950,
    color: '#1d4ed8'
  },
  bulkChildren: {
    display: 'grid',
    gap: 8
  },
  childEditRow: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr 110px',
    alignItems: 'center',
    gap: 10,
    background: '#fff',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    fontWeight: 850
  },
  choiceSelect: {
    height: 42,
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#111827',
    fontSize: 16,
    fontWeight: 900,
    padding: '0 8px'
  },
  activeBox: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12
  },
  sectionTitle: {
    margin: '0 0 10px 0',
    fontSize: 20,
    fontWeight: 950
  },
  activeList: {
    display: 'grid',
    gap: 8
  },
  activeIssue: {
    display: 'grid',
    gridTemplateColumns: '90px 1fr auto',
    gap: 10,
    alignItems: 'center',
    background: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    fontSize: 14
  },
  activeIssueMobile: {
    gridTemplateColumns: '1fr',
    gap: 6
  },
  historyBox: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12
  },
  emptyHistory: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: 750
  },
  historyList: {
    display: 'grid',
    gap: 8
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: 8,
    padding: 10,
    fontSize: 13
  },
  historyItemMobile: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 6
  },
  historyText: {
    display: 'grid',
    gap: 3
  },
  historySuccess: {
    background: '#dcfce7'
  },
  historyWarning: {
    background: '#fef3c7'
  },
  historyError: {
    background: '#fee2e2'
  }
}
