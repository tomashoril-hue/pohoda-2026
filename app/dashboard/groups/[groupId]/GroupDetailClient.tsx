'use client'

import { BrowserQRCodeReader } from '@zxing/browser'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'
import jsQR from 'jsqr'

type Member = {
  id: string
  userId: string
  role: string
  fullName: string
  email: string
  telefon: string
  aktivny: string
  isMe: boolean
}

type Invite = {
  id: string
  email: string
  status: string
  created_at: string
}

type Props = {
  group: {
    id: string
    name: string
  }
  myRole: string
  members: Member[]
  invites: Invite[]
  canManage: boolean
  canInvite: boolean
  canIssue: boolean
  canAssignManagers: boolean
}

type QrHistoryItem = {
  key: string
  status: 'ADDED' | 'EXISTS' | 'ERROR'
  message: string
  name?: string
  email?: string
  time: string
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

export default function GroupDetailClient({
  group,
  myRole,
  members,
  invites,
  canManage,
  canInvite,
  canIssue,
  canAssignManagers
}: Props) {
  const router = useRouter()
  const qrInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanLoopRef = useRef<number | null>(null)
  const zxingReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const cancelledRef = useRef(false)
  const qrBusyRef = useRef(false)
  const lastScanTextRef = useRef('')
  const lastScanTimeRef = useRef(0)
  const scanAttemptRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bulkRole, setBulkRole] = useState('MEMBER')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [cancelInviteId, setCancelInviteId] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrValue, setQrValue] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrMessage, setQrMessage] = useState('')
  const [qrMessageType, setQrMessageType] = useState<'ok' | 'error' | ''>('')
  const [cameraStatus, setCameraStatus] = useState('Spúšťam kameru...')
  const [cameraReady, setCameraReady] = useState(false)
  const [qrHistory, setQrHistory] = useState<QrHistoryItem[]>([])

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    return members
      .filter(member => {
        if (!q) return true

        return (
          member.fullName.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q) ||
          member.telefon.toLowerCase().includes(q) ||
          member.role.toLowerCase().includes(q) ||
          (String(member.aktivny || '').toUpperCase() !== 'ANO' && 'blokovany'.includes(q))
        )
      })
      .sort((a, b) => {
        const aBlocked = String(a.aktivny || '').toUpperCase() !== 'ANO'
        const bBlocked = String(b.aktivny || '').toUpperCase() !== 'ANO'

        if (aBlocked !== bBlocked) return aBlocked ? 1 : -1

        return a.fullName.localeCompare(b.fullName, 'sk')
      })
  }, [members, search])

  const selectableMembers = filteredMembers.filter(member => !member.isMe)
  const allSelected =
    selectableMembers.length > 0 &&
    selectableMembers.every(member => selected.includes(member.id))

  const setStatus = (text: string, type: 'ok' | 'error') => {
    setMessage(text)
    setMessageType(type)
  }

  const toggleMember = (memberId: string) => {
    setSelected(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    )
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelected([])
      return
    }

    setSelected(selectableMembers.map(member => member.id))
  }

  const memberAction = async (memberIds: string[], action: 'ROLE' | 'REMOVE', role?: string) => {
    setMessage('')
    setMessageType('')

    if (!memberIds.length) {
      setStatus('Nie je vybraný žiadny člen.', 'error')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/group/member/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds, action, role })
      })

      const text = await res.text()
      let json: { error?: string; message?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Úprava členov sa nepodarila.', 'error')
        return
      }

      setSelected([])
      setStatus(json.message || 'Zmeny boli uložené.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setLoading(false)
    }
  }

  const sendInvite = async () => {
    setMessage('')
    setMessageType('')

    if (!inviteEmail.trim()) {
      setStatus('Zadaj e-mail pozývanej osoby.', 'error')
      return
    }

    setInviteLoading(true)

    try {
      const res = await fetch('/api/group/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), groupId: group.id })
      })

      const text = await res.text()
      let json: { error?: string; message?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Pozvánku sa nepodarilo odoslať.', 'error')
        return
      }

      setInviteEmail('')
      setStatus(json.message || 'Pozvánka bola odoslaná.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setInviteLoading(false)
    }
  }

  const cancelInvite = async (inviteId: string) => {
    if (!confirm('Naozaj zrušiť túto pozvánku?')) return

    setCancelInviteId(inviteId)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/group/invite/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId })
      })

      const json: { error?: string } = await res.json()

      if (!res.ok || json.error) {
        setStatus(json.error || 'Pozvánku sa nepodarilo zrušiť.', 'error')
        return
      }

      setStatus('Pozvánka bola zrušená.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setCancelInviteId('')
    }
  }

  const leaveGroup = async () => {
    if (!confirm('Naozaj chceš opustiť túto skupinu?')) return

    setLeaving(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/group/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id })
      })

      const text = await res.text()
      let json: { error?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Skupinu sa nepodarilo opustiť.', 'error')
        return
      }

      router.push('/dashboard/groups')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setLeaving(false)
    }
  }

  const deleteGroup = async () => {
    const confirmed = confirm(
      `Naozaj zrušiť skupinu "${group.name}"?\n\nZrušia sa aktívne prípravy tejto skupiny, pozvánky a členstvá. Túto akciu nevrátiš späť.`
    )

    if (!confirmed) return

    setDeletingGroup(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/group/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id })
      })

      const text = await res.text()
      let json: { error?: string; message?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Skupinu sa nepodarilo zrušiť.', 'error')
        return
      }

      router.push('/dashboard/groups')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setDeletingGroup(false)
    }
  }

  const nowLabel = () => {
    return new Date().toLocaleTimeString('sk-SK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const addQrHistory = (item: Omit<QrHistoryItem, 'key' | 'time'>) => {
    setQrHistory(prev => [
      {
        ...item,
        key: `${Date.now()}-${prev.length}`,
        time: nowLabel()
      },
      ...prev
    ].slice(0, 12))
  }

  const playBeep = (type: 'ok' | 'error') => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext
      }).webkitAudioContext

      if (!AudioContextClass) return

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass()
      }

      const ctx = audioCtxRef.current
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      const duration = type === 'ok' ? 0.22 : 0.34

      oscillator.type = 'sine'
      oscillator.frequency.value = type === 'ok' ? 920 : 240
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration + 0.02)
    } catch {
      // Zvuk nemusí byť dostupný na každom zariadení.
    }

    try {
      navigator.vibrate?.(type === 'ok' ? 80 : [80, 70, 80])
    } catch {
      // Vibrácie sú voliteľné.
    }
  }

  const stopCamera = () => {
    cancelledRef.current = true

    try {
      if (scanLoopRef.current) {
        window.clearTimeout(scanLoopRef.current)
        scanLoopRef.current = null
      }

      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      zxingReaderRef.current = null
    } catch {
      // Ignorujeme vypnutie už zastavenej kamery.
    }

    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraReady(false)
  }

  const submitGroupQr = async (manualValue?: string, fromCamera = false) => {
    const cleanQr = String(manualValue ?? qrValue).trim()

    if (!cleanQr || qrBusyRef.current) return

    const nowMs = Date.now()

    if (
      fromCamera &&
      lastScanTextRef.current === cleanQr &&
      nowMs - lastScanTimeRef.current < 2500
    ) {
      return
    }

    lastScanTextRef.current = cleanQr
    lastScanTimeRef.current = nowMs
    qrBusyRef.current = true
    setQrLoading(true)
    setQrMessage('')
    setQrMessageType('')

    try {
      const res = await fetch('/api/groups/add-member-by-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: group.id,
          qr_code: cleanQr
        })
      })

      const result: {
        error?: string
        message?: string
        status?: 'ADDED' | 'EXISTS'
        member?: {
          fullName?: string
          email?: string
        }
      } = await res.json()

      if (!res.ok || result.error) {
        const errorMessage = result.error || 'Člena sa nepodarilo pridať.'
        playBeep('error')
        setQrMessage(errorMessage)
        setQrMessageType('error')
        addQrHistory({
          status: 'ERROR',
          message: errorMessage
        })
        return
      }

      const successMessage = result.message || 'Člen bol pridaný do skupiny.'
      playBeep('ok')
      setQrValue('')
      setQrMessage(successMessage)
      setQrMessageType('ok')
      addQrHistory({
        status: result.status === 'EXISTS' ? 'EXISTS' : 'ADDED',
        message: successMessage,
        name: result.member?.fullName,
        email: result.member?.email
      })
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      playBeep('error')
      setQrMessage('Chyba spojenia so serverom: ' + text)
      setQrMessageType('error')
      addQrHistory({
        status: 'ERROR',
        message: 'Chyba spojenia so serverom.'
      })
    } finally {
      qrBusyRef.current = false
      setQrLoading(false)

      setTimeout(() => {
        qrInputRef.current?.focus()
      }, 50)
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
    if (cancelledRef.current || qrBusyRef.current) return

    scanAttemptRef.current += 1

    const zxingValue = tryZxingQr()
    if (zxingValue) {
      await submitGroupQr(zxingValue, true)
      return
    }

    // Preprocessing je drahší, preto ho púšťame občas ako fallback pre tmavé a inverzné QR.
    if (scanAttemptRef.current % 3 !== 0) return

    const processedValue = tryPreprocessedQr()
    if (processedValue) {
      await submitGroupQr(processedValue, true)
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
    setCameraStatus('Spúšťam kameru...')
    cancelledRef.current = false

    try {
      if (!videoRef.current) {
        setCameraStatus('Video prvok nie je pripravený.')
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
      setCameraStatus('Kamera je zapnutá. Skenuj QR kódy postupne.')
      scheduleCameraScan()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Kameru sa nepodarilo zapnúť.'
      setCameraReady(false)
      setCameraStatus(text)

      setTimeout(() => {
        qrInputRef.current?.focus()
      }, 100)
    }
  }

  const closeQrModal = () => {
    if (qrLoading) return

    setQrOpen(false)
    setQrValue('')
    setQrMessage('')
    setQrMessageType('')
    stopCamera()
  }

  const handleQrKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      submitGroupQr()
    }
  }

  useEffect(() => {
    if (!qrOpen) {
      stopCamera()
      return
    }

    setQrValue('')
    setQrMessage('')
    setQrMessageType('')
    startCamera()

    const timer = setTimeout(() => {
      qrInputRef.current?.focus()
    }, 250)

    return () => {
      clearTimeout(timer)
      stopCamera()
    }
  }, [qrOpen])

  return (
    <main style={styles.screen}>
      <header style={styles.mobileHeader}>
        <div>
          <div style={styles.breadcrumb}>Prehľad / Skupiny / Detail</div>
          <h1 style={styles.title}>{group.name}</h1>
          <p style={styles.subtitle}>Členovia, pozvánky a výdaj pre túto skupinu.</p>
        </div>

        <Link href="/dashboard/groups" style={styles.closeButton}>
          Skupiny
        </Link>
      </header>

      <section style={styles.modeBar}>
        <div style={styles.modeMain}>
          <b>Správa skupiny</b>
          <span>Tvoja rola: {myRole}</span>
        </div>

        <div style={styles.modeStatus}>
          <strong>{members.length}</strong>
          <small>členov</small>
        </div>
      </section>

      {members.some(member => String(member.aktivny || '').toUpperCase() !== 'ANO') && (
        <section style={styles.blockedNotice}>
          <b>{members.filter(member => String(member.aktivny || '').toUpperCase() !== 'ANO').length}</b>
          <span>blokovaní členovia v tejto skupine</span>
        </section>
      )}
      <section style={styles.actionBar}>
        <div style={styles.actionLeft}>
          {canIssue && (
            <Link href={`/dashboard/groups/${group.id}/issue`} style={styles.confirmButton}>
              Hromadný výdaj
            </Link>
          )}

          {canManage && (
            <button type="button" onClick={() => setQrOpen(true)} style={styles.qrButton}>
              Pridať cez QR
            </button>
          )}

        </div>

        <div style={styles.dangerActions}>
          {canManage && (
            <button
              type="button"
              style={{
                ...styles.deleteButton,
                opacity: deletingGroup ? 0.6 : 1
              }}
              onClick={deleteGroup}
              disabled={deletingGroup || leaving}
            >
              {deletingGroup ? 'Ruším...' : 'Zrušiť skupinu'}
            </button>
          )}

          <button
            type="button"
            style={{
              ...styles.cancelButton,
              opacity: leaving ? 0.6 : 1
            }}
            onClick={leaveGroup}
            disabled={leaving || deletingGroup}
          >
            {leaving ? 'Odchádzam...' : 'Opustiť skupinu'}
          </button>
        </div>
      </section>

      {message && (
        <section
          style={{
            ...styles.message,
            background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
            color: messageType === 'ok' ? '#166534' : '#991b1b',
            borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
          }}
        >
          {message}
        </section>
      )}

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeaderRow}>
            <b>Členovia</b>
            {canManage && (
              <button
                type="button"
                style={styles.tinyButton}
                onClick={toggleAll}
                disabled={loading || selectableMembers.length === 0}
              >
                {allSelected ? 'Zrušiť výber' : 'Označiť'}
              </button>
            )}
          </div>

          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Hľadať podľa mena, e-mailu, telefónu alebo roly..."
            style={styles.searchInput}
          />

          {canManage && selected.length > 0 && (
            <div style={styles.bulkBar}>
              <span>Vybraných: <b>{selected.length}</b></span>

              <select
                value={bulkRole}
                onChange={event => setBulkRole(event.target.value)}
                style={styles.select}
                disabled={loading}
              >
                <option value="MEMBER">MEMBER</option>
                <option value="POVERENY">POVERENY</option>
                {canAssignManagers && <option value="MANAGER">MANAGER</option>}
              </select>

              <button
                type="button"
                style={styles.qrButton}
                onClick={() => memberAction(selected, 'ROLE', bulkRole)}
                disabled={loading}
              >
                Zmeniť rolu
              </button>

              <button
                type="button"
                style={styles.cancelButton}
                onClick={() => {
                  if (confirm(`Odobrať ${selected.length} členov zo skupiny?`)) {
                    memberAction(selected, 'REMOVE')
                  }
                }}
                disabled={loading}
              >
                Odobrať
              </button>
            </div>
          )}
        </div>

        {canInvite && (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Pozvať do skupiny</div>

            <div style={styles.inviteRow}>
              <input
                value={inviteEmail}
                onChange={event => setInviteEmail(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    sendInvite()
                  }
                }}
                placeholder="E-mail člena"
                style={styles.searchInput}
                disabled={inviteLoading}
              />

              <button
                type="button"
                style={{
                  ...styles.confirmButton,
                  opacity: inviteLoading ? 0.6 : 1
                }}
                onClick={sendInvite}
                disabled={inviteLoading}
              >
                {inviteLoading ? 'Posielam...' : 'Pozvať'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div />
          <div>Osoba</div>
          <div>Stav</div>
          <div>Rola</div>
          <div>Akcie</div>
        </div>

        {filteredMembers.length === 0 ? (
          <div style={styles.emptyState}>Nenašli sa žiadni členovia.</div>
        ) : (
          filteredMembers.map(member => {
            const blocked = String(member.aktivny || '').toUpperCase() !== 'ANO'

            return (
            <div
              key={member.id}
              style={{
                ...styles.row,
                background: blocked ? '#fef2f2' : '#fff'
              }}
            >
              <div style={styles.checkCell}>
                {canManage && (
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={selected.includes(member.id)}
                    disabled={member.isMe || loading}
                    onChange={() => toggleMember(member.id)}
                  />
                )}
              </div>

              <div style={styles.personCell}>
                <div style={styles.personName}>
                  {member.fullName}{member.isMe ? ' (ty)' : ''}
                </div>
                <div style={styles.personMeta}>
                  {member.email || '-'}{member.telefon ? ` · ${member.telefon}` : ''}
                </div>
              </div>

              <div>
                <span
                  style={{
                    ...styles.statusBadge,
                    background: blocked ? '#fee2e2' : '#dcfce7',
                    color: blocked ? '#991b1b' : '#166534'
                  }}
                >
                  {blocked ? 'Blokovaný' : 'Aktívny'}
                </span>
              </div>

              <div>
                {canManage && !member.isMe ? (
                  <select
                    value={member.role}
                    onChange={event => memberAction([member.id], 'ROLE', event.target.value)}
                    style={styles.smallSelect}
                    disabled={loading}
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="POVERENY">POVERENY</option>
                    {canAssignManagers && <option value="MANAGER">MANAGER</option>}
                  </select>
                ) : (
                  <span style={styles.roleBadge}>{member.role}</span>
                )}
              </div>

              <div>
                {canManage && !member.isMe && (
                  <button
                    type="button"
                    style={styles.lightButton}
                    onClick={() => {
                      if (confirm('Odobrať tohto člena zo skupiny?')) {
                        memberAction([member.id], 'REMOVE')
                      }
                    }}
                    disabled={loading}
                  >
                    Odobrať
                  </button>
                )}
              </div>
            </div>
            )
          })
        )}
      </section>

      {canInvite && invites.length > 0 && (
        <section style={styles.panel}>
          <div style={styles.panelTitle}>Odoslané pozvánky</div>

          <div style={styles.inviteList}>
            {invites.map(invite => (
              <div key={invite.id} style={styles.inviteItem}>
                <div>
                  <b>{invite.email}</b>
                  <span>Čaká na potvrdenie</span>
                </div>

                <button
                  type="button"
                  style={styles.lightButton}
                  onClick={() => cancelInvite(invite.id)}
                  disabled={cancelInviteId === invite.id}
                >
                  {cancelInviteId === invite.id ? 'Ruším...' : 'Zrušiť'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!canManage && myRole === 'MEMBER' && (
        <section style={styles.message}>
          Ako člen skupiny môžeš vidieť členov a opustiť skupinu. Správu členov,
          pozvánky a hromadný výdaj rieši poverená osoba alebo manažér.
        </section>
      )}

      {qrOpen && (
        <div style={styles.modalOverlay} onClick={closeQrModal}>
          <div style={styles.qrModal} onClick={event => event.stopPropagation()}>
            <div style={styles.qrModalHeader}>
              <div>
                <b>Pridať cez QR</b>
                <span>Skenuj QR kódy postupne. Člen sa pridá hneď po úspešnom načítaní.</span>
              </div>

              <button
                type="button"
                onClick={closeQrModal}
                style={styles.qrCloseButton}
                disabled={qrLoading}
              >
                ×
              </button>
            </div>

            <div style={styles.cameraBox}>
              <video
                ref={videoRef}
                style={styles.cameraVideo}
                playsInline
                muted
                autoPlay
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
            </div>

            <div
              style={{
                ...styles.cameraStatus,
                color: cameraReady ? '#166534' : '#9a3412'
              }}
            >
              {cameraStatus}
            </div>

            <div style={styles.manualQrBox}>
              <label style={styles.manualQrLabel}>Manuálne načítanie / scanner</label>

              <div style={styles.manualQrRow}>
                <input
                  ref={qrInputRef}
                  value={qrValue}
                  onChange={event => setQrValue(event.target.value)}
                  onKeyDown={handleQrKeyDown}
                  placeholder="Naskenuj alebo vlož QR..."
                  style={styles.qrInput}
                  disabled={qrLoading}
                  autoComplete="off"
                  inputMode="text"
                />

                <button
                  type="button"
                  style={{
                    ...styles.confirmButton,
                    opacity: qrLoading ? 0.6 : 1
                  }}
                  onClick={() => submitGroupQr()}
                  disabled={qrLoading}
                >
                  {qrLoading ? '...' : 'Pridať'}
                </button>
              </div>
            </div>

            {qrMessage && (
              <div
                style={{
                  ...styles.message,
                  background: qrMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                  color: qrMessageType === 'ok' ? '#166534' : '#991b1b',
                  borderColor: qrMessageType === 'ok' ? '#86efac' : '#fecaca'
                }}
              >
                {qrMessage}
              </div>
            )}

            <div style={styles.qrHistoryBox}>
              <div style={styles.panelTitle}>Posledné skeny</div>

              {qrHistory.length === 0 ? (
                <div style={styles.emptyState}>Zatiaľ nebol načítaný žiadny člen.</div>
              ) : (
                qrHistory.map(item => (
                  <div
                    key={item.key}
                    style={{
                      ...styles.qrHistoryItem,
                      background:
                        item.status === 'ADDED'
                          ? '#dcfce7'
                          : item.status === 'EXISTS'
                            ? '#eff6ff'
                            : '#fee2e2',
                      color:
                        item.status === 'ERROR'
                          ? '#991b1b'
                          : item.status === 'EXISTS'
                            ? '#1d4ed8'
                            : '#166534'
                    }}
                  >
                    <b>{item.message}</b>
                    {item.name && <span>{item.name}</span>}
                    {item.email && <span>{item.email}</span>}
                    <small>{item.time}</small>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  screen: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 10,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  mobileHeader: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.05)'
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 800,
    color: '#6b7280',
    marginBottom: 3
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  closeButton: {
    background: '#111827',
    color: '#fff',
    borderRadius: 12,
    padding: '9px 11px',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  modeBar: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center'
  },
  modeMain: {
    minWidth: 0,
    display: 'grid',
    gap: 5
  },
  modeStatus: {
    background: '#111827',
    color: '#fff',
    borderRadius: 12,
    padding: '8px 10px',
    display: 'grid',
    justifyItems: 'center',
    minWidth: 82
  },
  blockedNotice: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 16,
    padding: 12,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 900
  },
  actionBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap'
  },
  actionLeft: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap'
  },
  dangerActions: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  topGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 10
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  panelHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 10
  },
  tinyButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '6px 9px',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'pointer'
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 16,
    fontWeight: 700,
    outline: 'none'
  },
  inviteRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8
  },
  bulkBar: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 13,
    fontWeight: 850
  },
  select: {
    minWidth: 130,
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 16,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  smallSelect: {
    maxWidth: 118,
    border: '1px solid #d1d5db',
    borderRadius: 999,
    padding: '6px 7px',
    fontSize: 16,
    fontWeight: 900,
    background: '#fff',
    color: '#111827'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 11px',
    fontSize: 12,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  qrButton: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  cancelButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  deleteButton: {
    background: '#7f1d1d',
    color: '#fff',
    border: '1px solid #991b1b',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  message: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 11,
    fontSize: 13,
    fontWeight: 850,
    background: '#fff'
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 720,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 130px 100px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  row: {
    minWidth: 720,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 130px 100px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
    borderBottom: '1px solid #e5e7eb'
  },
  checkCell: {
    display: 'flex',
    alignItems: 'center'
  },
  checkbox: {
    width: 18,
    height: 18
  },
  personCell: {
    minWidth: 0
  },
  personName: {
    fontSize: 14,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: 'anywhere'
  },
  personMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: 700,
    color: '#6b7280',
    overflowWrap: 'anywhere'
  },
  choiceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 62,
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 950
  },
  roleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 900,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  sourceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
    background: '#eef2ff',
    color: '#3730a3'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  },
  inviteList: {
    display: 'grid',
    gap: 8
  },
  inviteItem: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  qrModal: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'grid',
    gap: 12
  },
  qrModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  qrCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: '#f3f4f6',
    color: '#111827',
    fontSize: 22,
    fontWeight: 900,
    lineHeight: 1,
    cursor: 'pointer'
  },
  cameraBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    background: '#111827',
    borderRadius: 16,
    overflow: 'hidden'
  },
  cameraVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  cameraFrame: {
    position: 'absolute',
    inset: 28,
    border: '4px solid',
    borderRadius: 18,
    pointerEvents: 'none',
    boxShadow: '0 0 0 999px rgba(0,0,0,0.22)'
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
    fontSize: 13,
    fontWeight: 900,
    background: 'rgba(17,24,39,0.55)'
  },
  cameraStatus: {
    fontSize: 12,
    fontWeight: 850
  },
  manualQrBox: {
    display: 'grid',
    gap: 6
  },
  manualQrLabel: {
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  manualQrRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8
  },
  qrInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 14,
    padding: '13px 12px',
    fontSize: 16,
    fontWeight: 850,
    outline: 'none'
  },
  qrHistoryBox: {
    display: 'grid',
    gap: 7
  },
  qrHistoryItem: {
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 2,
    fontSize: 12,
    fontWeight: 850
  },
  hiddenCanvas: {
    display: 'none'
  }
}
