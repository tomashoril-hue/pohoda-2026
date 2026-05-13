'use client'

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { BrowserQRCodeReader } from '@zxing/browser'

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

export default function VydajStravyClient({
  actorName,
  initialDate,
  initialMeal,
  initialCounts,
  activeIssues
}: {
  actorName: string
  initialDate: string
  initialMeal: string
  initialCounts: {
    obed: number
    vecera: number
  }
  activeIssues: ActiveIssue[]
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<any>(null)
  const cancelledRef = useRef(false)
  const busyRef = useRef(false)
  const lastScanTextRef = useRef('')
  const lastScanTimeRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const [datum, setDatum] = useState(initialDate)
  const [typJedla, setTypJedla] = useState<Meal>(initialMeal === 'VECERA' ? 'VECERA' : 'OBED')
  const [qrValue, setQrValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStatus, setCameraStatus] = useState('Kamera je vypnutá.')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<ScanItem[]>([])
  const [successCount, setSuccessCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [, setDayCounts] = useState(initialCounts)
  const [mealStats, setMealStats] = useState<Record<Meal, MealStats>>({
    OBED: emptyMealStats(initialCounts.obed),
    VECERA: emptyMealStats(initialCounts.vecera)
  })
  const [recentIssued, setRecentIssued] = useState<ScanItem[]>([])
  const [selectedCancelIds, setSelectedCancelIds] = useState<string[]>([])
  const [editChoices, setEditChoices] = useState<Record<string, string>>({})
  const [cancelLoading, setCancelLoading] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const lastItem = history[0] || null
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

    try {
      controlsRef.current?.stop?.()
      controlsRef.current = null
    } catch {
      // ignorujeme
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraReady(false)
    setCameraStatus('Kamera je vypnutá.')
  }

  const startCamera = async () => {
    setCameraOpen(true)
    setCameraReady(false)
    setCameraStatus('Spúšťam kameru...')
    cancelledRef.current = false

    try {
      if (!videoRef.current) {
        setCameraStatus('Video nie je pripravené.')
        return
      }

      const reader = new BrowserQRCodeReader()
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result) => {
          if (cancelledRef.current) return

          const text = String(result?.getText?.() || '').trim()
          if (!text) return

          const nowMs = Date.now()
          if (busyRef.current) return
          if (lastScanTextRef.current === text && nowMs - lastScanTimeRef.current < 1200) return
          if (nowMs - lastScanTimeRef.current < 300) return

          lastScanTextRef.current = text
          lastScanTimeRef.current = nowMs

          await submitQr(text)
        }
      )

      controlsRef.current = controls
      setCameraReady(true)
      setCameraStatus('Kamera je zapnutá.')
    } catch (err: any) {
      setCameraReady(false)
      setCameraStatus(err?.message || 'Kamera sa nepodarila zapnúť. Použi manuálne pole.')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const addHistory = (item: ScanItem) => {
    setHistory(prev => [item, ...prev].slice(0, 24))
  }

  const refreshIssueDataInBackground = () => {
    Promise.all([
      refreshRecentIssued(),
      refreshStats()
    ]).catch(() => {
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
    const params = new URLSearchParams({ datum })
    const res = await fetch(`/api/vydaj-stravy/stats?${params.toString()}`)
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok || !json.stats) return

    setMealStats(json.stats)
    setDayCounts({
      obed: Number(json.stats.OBED?.issued || 0),
      vecera: Number(json.stats.VECERA?.issued || 0)
    })
  }

  useEffect(() => {
    setSelectedCancelIds([])
    refreshRecentIssued()
    refreshStats()
  }, [datum, typJedla])

  const submitQr = async (manualValue?: string) => {
    const cleanQr = String(manualValue ?? qrValue).trim()
    if (!cleanQr || busyRef.current) return

    busyRef.current = true
    setLoading(true)

    try {
      const res = await fetch('/api/vydaj-stravy/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qrCode: cleanQr,
          datum,
          typJedla
        })
      })

      const json = await res.json().catch(() => ({}))
      const ok = !!json.ok && res.ok
      const tone = toneOf(String(json.status || ''), ok)
      const item: ScanItem = {
        id: `${Date.now()}-${cleanQr}`,
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
        issuedAt: String(json.issuedAt || new Date().toISOString())
      }

      addHistory(item)

      if (ok) {
        const issuedCount = Math.max(1, Number(json.issuedCount || 1))
        playBeep('ok')
        setSuccessCount(prev => prev + issuedCount)
        if (item.issuedId) {
          setSelectedCancelIds([item.issuedId])
        }
        setDayCounts(prev => ({
          ...prev,
          [typJedla === 'OBED' ? 'obed' : 'vecera']: prev[typJedla === 'OBED' ? 'obed' : 'vecera'] + issuedCount
        }))
        refreshIssueDataInBackground()
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
      setTimeout(() => inputRef.current?.focus(), 70)
    }
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
        message: `Upravené výdaje (${changedItems.length})`,
        personName: '',
        email: '',
        choice: '',
        method: '',
        groupName: '',
        issuedId: '',
        issuedAt: new Date().toISOString()
      })
      await refreshRecentIssued()
      await refreshStats()
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

      itemsToCancel.forEach(item => {
        setDayCounts(prev => ({
          ...prev,
          [item.typJedla === 'OBED' ? 'obed' : 'vecera']: Math.max(0, prev[item.typJedla === 'OBED' ? 'obed' : 'vecera'] - 1)
        }))
      })

      playBeep('ok')
      await refreshRecentIssued()
      await refreshStats()
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
        await refreshStats()
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
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>POHODA 2026</div>
          <h1 style={styles.title}>Výdaj stravy</h1>
          <div style={styles.actor}>{actorName}</div>
        </div>

        <Link href="/dashboard" style={styles.backButton}>Späť</Link>
      </header>

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

      <section style={styles.scanGrid}>
        <div style={styles.scanPanel}>
          <div style={styles.scanTop}>
            <div>
              <div style={styles.scanLabel}>Aktuálny výdaj</div>
              <h2 style={styles.scanMeal}>{mealLabel(typJedla)}</h2>
            </div>

            <div style={styles.liveBadge}>{loading ? 'Spracúvam' : 'Pripravené'}</div>
          </div>

          <input
            ref={inputRef}
            value={qrValue}
            onChange={event => setQrValue(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Načítaj alebo zadaj QR"
            inputMode="text"
            autoComplete="off"
            style={styles.qrInput}
            disabled={loading}
          />

          <button
            type="button"
            onClick={() => submitQr()}
            disabled={loading || !qrValue.trim()}
            style={{
              ...styles.primaryButton,
              opacity: loading || !qrValue.trim() ? 0.55 : 1
            }}
          >
            {loading ? 'Kontrolujem...' : 'Vydať stravu'}
          </button>

          <div style={styles.cameraActions}>
            <button
              type="button"
              onClick={() => cameraOpen ? (setCameraOpen(false), stopCamera()) : startCamera()}
              style={styles.secondaryButton}
            >
              {cameraOpen ? 'Vypnúť kameru' : 'Zapnúť kameru'}
            </button>

            <span style={styles.cameraStatus}>
              {cameraReady ? '● ' : ''}
              {cameraStatus}
            </span>
          </div>

          {cameraOpen && (
            <video
              ref={videoRef}
              muted
              playsInline
              style={styles.video}
            />
          )}
        </div>

        <aside style={{
          ...styles.resultPanel,
          ...(lastItem ? styles[`tone_${lastItem.tone}`] : {})
        }}>
          {!lastItem ? (
            <>
              <div style={styles.resultEmpty}>Čaká sa na prvý QR kód.</div>
              <div style={styles.resultHint}>Systém najprv overí blokovanie, nárok, duplicitu výdaja a prípadnú hromadnú prípravu.</div>
            </>
          ) : (
            <>
              <div style={styles.resultStatus}>{lastItem.message}</div>
              <div style={styles.resultName}>{lastItem.personName || 'Bez mena'}</div>
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

      <section style={styles.statsGrid}>
        <div style={styles.statBoxWide}>
          <span>Dnes obed</span>
          <b>{mealStats.OBED.issued} / {mealStats.OBED.total}</b>
          <div style={styles.foodBreakdown}>
            <em>MASO {mealStats.OBED.MASO.issued}/{mealStats.OBED.MASO.total}</em>
            <em>VEGE {mealStats.OBED.VEGE.issued}/{mealStats.OBED.VEGE.total}</em>
            <em>DIÉTA {mealStats.OBED.DIETA.issued}/{mealStats.OBED.DIETA.total}</em>
            <em>NEZADANÉ {mealStats.OBED.NEZADANE?.issued || 0}/{mealStats.OBED.NEZADANE?.total || 0}</em>
          </div>
        </div>
        <div style={styles.statBoxWide}>
          <span>Dnes večera</span>
          <b>{mealStats.VECERA.issued} / {mealStats.VECERA.total}</b>
          <div style={styles.foodBreakdown}>
            <em>MASO {mealStats.VECERA.MASO.issued}/{mealStats.VECERA.MASO.total}</em>
            <em>VEGE {mealStats.VECERA.VEGE.issued}/{mealStats.VECERA.VEGE.total}</em>
            <em>DIÉTA {mealStats.VECERA.DIETA.issued}/{mealStats.VECERA.DIETA.total}</em>
            <em>NEZADANÉ {mealStats.VECERA.NEZADANE?.issued || 0}/{mealStats.VECERA.NEZADANE?.total || 0}</em>
          </div>
        </div>
        <div style={styles.statBoxGreen}>
          <span>Vydané teraz</span>
          <b>{successCount}</b>
        </div>
        <div style={styles.statBoxRed}>
          <span>Kontroly stop</span>
          <b>{errorCount}</b>
        </div>
      </section>

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

      {activeIssues.length > 0 && (
        <section style={styles.activeBox}>
          <h2 style={styles.sectionTitle}>Aktívne prípravy</h2>
          <div style={styles.activeList}>
            {activeIssues.map(issue => (
              <div key={issue.id} style={styles.activeIssue}>
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
                ...(item.tone === 'success'
                  ? styles.historySuccess
                  : item.tone === 'warning'
                    ? styles.historyWarning
                    : styles.historyError)
              }}>
                <div>
                  <b>{item.message}</b>
                  <span>{item.personName || item.email || '-'}</span>
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
    fontSize: 34,
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
  scanPanel: {
    background: '#fff',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    padding: 14,
    display: 'grid',
    gap: 12
  },
  scanTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
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
  liveBadge: {
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 950
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
  primaryButton: {
    ...baseButton,
    minHeight: 64,
    background: '#16a34a',
    borderColor: '#15803d',
    color: '#fff',
    fontSize: 20
  },
  cameraActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  secondaryButton: {
    ...baseButton,
    background: '#111827',
    color: '#fff',
    padding: '0 14px'
  },
  cameraStatus: {
    color: '#475569',
    fontSize: 13,
    fontWeight: 750
  },
  video: {
    width: '100%',
    maxHeight: 320,
    background: '#020617',
    borderRadius: 8,
    objectFit: 'cover'
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
  resultHint: {
    fontSize: 14,
    fontWeight: 750,
    color: '#475569'
  },
  resultStatus: {
    fontSize: 36,
    fontWeight: 950,
    lineHeight: 1
  },
  resultName: {
    fontSize: 26,
    fontWeight: 950
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
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 10
  },
  statBox: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 6
  },
  statBoxWide: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 6
  },
  foodBreakdown: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 12,
    fontWeight: 850
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
