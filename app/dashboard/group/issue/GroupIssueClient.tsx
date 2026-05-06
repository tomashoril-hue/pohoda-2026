'use client'

import { useMemo, useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { BrowserQRCodeReader } from '@zxing/browser'

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatDateTime(value: string | null) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatCountdown(ms: number) {
  const safeMs = Math.max(0, ms)
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function mealLabel(value: string) {
  if (value === 'OBED') return 'OBED'
  if (value === 'VECERA') return 'VEČERA'
  return value || '-'
}

function statusLabel(value: string) {
  if (value === 'READY') return 'Aktívna'
  if (value === 'WAITING') return 'Čaká na aktiváciu'
  if (value === 'CANCELLED') return 'Zrušená'
  return value || '-'
}

function choiceLabel(value: string | null) {
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  return 'NEZADANÉ'
}

function entitlementLabel(value: string | null | undefined) {
  if (value === 'YES') return 'ÁNO'
  if (value === 'NO') return 'NIE'
  return 'NEZNÁME'
}

function itemStatusLabel(item: any, selectedIds: string[], savedPreparedIds: string[]) {
  if (item.removeReason === 'IN_OTHER_ISSUE') return 'V INOM VÝDAJI'

  if (item.status === 'INDIVIDUAL_ISSUED') return 'PREVZAL OSOBNE'
  if (item.status === 'BULK_ISSUED') return 'PREVZATÉ HROMADNE'

  if (item.status === 'REMOVED' && item.removeReason === 'REMOVED_FROM_GROUP') {
    return 'ODSTRÁNENÝ ZO SKUPINY'
  }

  if (item.status === 'REMOVED' && item.removeReason === 'MOVED_TO_OTHER_GROUP') {
    return 'PRESUNUTÝ DO INEJ SKUPINY'
  }

  const wasPrepared = savedPreparedIds.includes(item.userId)
  const isSelectedNow = selectedIds.includes(item.userId)

  if (wasPrepared !== isSelectedNow) return 'UPRAVUJE SA'
  if (wasPrepared) return 'PRIPRAVENÝ'

  return 'NEPRIPRAVENÝ'
}

function canSelectRow(item: any, _currentIssue: any) {
  if (item.removeReason === 'IN_OTHER_ISSUE') return false
  if (item.status === 'INDIVIDUAL_ISSUED') return false
  if (item.status === 'BULK_ISSUED') return false

  if (item.status === 'REMOVED' && item.removeReason === 'REMOVED_FROM_GROUP') {
    return false
  }

  if (item.status === 'REMOVED' && item.removeReason === 'MOVED_TO_OTHER_GROUP') {
    return false
  }

  if (item.role === '—') return false

  return true
}

function getMemberEntitlement(member: any, datum: string, typJedla: string) {
  const byDate = member?.entitlementsByDate || {}
  const day = byDate[datum] || {}

  return day?.[typJedla] || 'UNKNOWN'
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false

  const setA = new Set(a)

  return b.every(item => setA.has(item))
}

export default function GroupIssueClient({
  group,
  myRole,
  myName,
  members,
  activeIssues
}: {
  group: {
    id: string
    name: string
  }
  myRole: string
  myName: string
  members: any[]
  activeIssues: any[]
}) {
  const router = useRouter()

  const qrInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const controlsRef = useRef<any>(null)
  const cancelledRef = useRef(false)
  const qrBusyRef = useRef(false)
  const lastScanRef = useRef('')
  const lastScanTimeRef = useRef(0)

  const [datum, setDatum] = useState(todayIsoDate())
  const [typJedla, setTypJedla] = useState('OBED')
  const [search, setSearch] = useState('')
  const [choiceFilter, setChoiceFilter] = useState<'ALL' | 'MASO' | 'VEGE' | 'UNKNOWN'>('ALL')
  const [selected, setSelected] = useState<string[]>(members.map(member => member.userId))
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [now, setNow] = useState(Date.now())

  const [qrOpen, setQrOpen] = useState(false)
  const [qrValue, setQrValue] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrMessage, setQrMessage] = useState('')
  const [qrMessageType, setQrMessageType] = useState<'ok' | 'error' | ''>('')
  const [cameraStatus, setCameraStatus] = useState('Spúšťam kameru...')
  const [cameraReady, setCameraReady] = useState(false)
  const [qrAddedRows, setQrAddedRows] = useState<any[]>([])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const stopCamera = () => {
    cancelledRef.current = true

    try {
      if (controlsRef.current) {
        controlsRef.current.stop()
        controlsRef.current = null
      }
    } catch {
      // ignorujeme
    }

    readerRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraReady(false)
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

      const reader = new BrowserQRCodeReader()
      readerRef.current = reader

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result) => {
          if (cancelledRef.current) return

          const text = String(result?.getText?.() || '').trim()

          if (!text) return

          const nowMs = Date.now()

          if (
            lastScanRef.current === text &&
            nowMs - lastScanTimeRef.current < 2500
          ) {
            return
          }

          if (qrBusyRef.current) return

          lastScanRef.current = text
          lastScanTimeRef.current = nowMs

          await submitExpressQr(text, true)
        }
      )

      controlsRef.current = controls

      setCameraReady(true)
      setCameraStatus('Kamera je zapnutá. Skenujte QR kódy postupne.')
    } catch (err: any) {
      setCameraReady(false)
      setCameraStatus(
        err?.message ||
          'Kamera sa nepodarila zapnúť. Skontrolujte povolenie kamery alebo použite manuálne pole.'
      )

      setTimeout(() => {
        qrInputRef.current?.focus()
      }, 100)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOpen])

  const selectedActiveIssue = activeIssues.find(issue => issue.id === selectedIssueId) || null

  const matchingIssue = activeIssues.find(issue => {
    return issue.datum === datum && issue.typ_jedla === typJedla
  }) || null

  const currentIssue = selectedActiveIssue || matchingIssue || null

  const savedPreparedIds: string[] = currentIssue ? (currentIssue.userIds || []) : []

  const validAfterMs = currentIssue?.valid_after
    ? new Date(currentIssue.valid_after).getTime()
    : null

  const remainingMs =
    currentIssue?.status === 'WAITING' && validAfterMs
      ? validAfterMs - now
      : 0

  const isWaiting = currentIssue?.status === 'WAITING' && remainingMs > 0
  const isActive = currentIssue?.status === 'READY' || (currentIssue?.status === 'WAITING' && remainingMs <= 0)

  const rows = useMemo(() => {
    const normalizeExtraRows = (existingUserIds: Set<string>) => {
      return qrAddedRows
        .filter((row: any) => !existingUserIds.has(row.userId))
        .map((row: any) => ({
          ...row,
          rowId: row.rowId || `qr-${row.userId}`,
          typStravy: row.typStravy || row.volba || '',
          addedByQr: true,
          isFromIssue: !!currentIssue
        }))
    }

    if (currentIssue) {
      const issueItems = currentIssue.items || []

      const issueItemByUserId = new Map(
        issueItems.map((item: any) => [item.userId, item])
      )

      const mergedRows = members.map((member: any) => {
        const issueItem: any = issueItemByUserId.get(member.userId)

        if (issueItem) {
          return {
            ...member,
            ...issueItem,
            rowId: issueItem.id || member.userId,
            userId: member.userId,
            fullName: issueItem.fullName || member.fullName,
            email: issueItem.email || member.email,
            telefon: issueItem.telefon || member.telefon,
            typStravy: issueItem.typStravy || issueItem.volba || member.typStravy || '',
            role: member.role || issueItem.role || '—',
            entitlementStatus:
              issueItem.entitlementStatus ||
              getMemberEntitlement(member, currentIssue.datum, currentIssue.typ_jedla),
            isFromIssue: true
          }
        }

        return {
          ...member,
          rowId: member.userId,
          status: 'NOT_PREPARED',
          removeReason: null,
          typStravy: member.typStravy || '',
          entitlementStatus: getMemberEntitlement(member, currentIssue.datum, currentIssue.typ_jedla),
          isFromIssue: false
        }
      })

      const removedOrSpecialItems = issueItems.filter((item: any) => {
        return !members.some((member: any) => member.userId === item.userId)
      })

      const baseRows = [
        ...mergedRows,
        ...removedOrSpecialItems.map((item: any) => ({
          ...item,
          rowId: item.id || item.userId,
          typStravy: item.typStravy || item.volba || '',
          role: item.role || '—',
          entitlementStatus: item.entitlementStatus || 'UNKNOWN',
          isFromIssue: true
        }))
      ]

      const existingUserIds = new Set(baseRows.map((row: any) => row.userId))

      return [
        ...baseRows,
        ...normalizeExtraRows(existingUserIds)
      ]
    }

    const baseRows = members.map((member: any) => ({
      ...member,
      rowId: member.userId,
      status: 'NOT_PREPARED',
      removeReason: null,
      entitlementStatus: getMemberEntitlement(member, datum, typJedla),
      isFromIssue: false
    }))

    const existingUserIds = new Set(baseRows.map((row: any) => row.userId))

    return [
      ...baseRows,
      ...normalizeExtraRows(existingUserIds)
    ]
  }, [currentIssue, members, datum, typJedla, qrAddedRows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = rows.filter((row: any) => {
      const rowChoice = String(row.typStravy || row.volba || '').toUpperCase()

      const matchesSearch =
        !q ||
        String(row.fullName || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.telefon || '').toLowerCase().includes(q)

      const matchesChoice =
        choiceFilter === 'ALL' ||
        (choiceFilter === 'MASO' && rowChoice === 'MASO') ||
        (choiceFilter === 'VEGE' && rowChoice === 'VEGE') ||
        (choiceFilter === 'UNKNOWN' && rowChoice !== 'MASO' && rowChoice !== 'VEGE')

      return matchesSearch && matchesChoice
    })

    return filtered.sort((a: any, b: any) => {
      const specialRank = (row: any) => {
        const isSpecial =
          row.status === 'INDIVIDUAL_ISSUED' ||
          row.status === 'BULK_ISSUED' ||
          row.removeReason === 'REMOVED_FROM_GROUP' ||
          row.removeReason === 'MOVED_TO_OTHER_GROUP' ||
          row.removeReason === 'IN_OTHER_ISSUE' ||
          row.role === '—'

        return isSpecial ? 2 : 1
      }

      const roleRank = (row: any) => {
        const role = String(row.role || '').toUpperCase()

        if (role === 'MANAGER') return 1
        if (role === 'POVERENY') return 2
        if (role === 'MEMBER') return 3

        return 9
      }

      const specialDiff = specialRank(a) - specialRank(b)
      if (specialDiff !== 0) return specialDiff

      const roleDiff = roleRank(a) - roleRank(b)
      if (roleDiff !== 0) return roleDiff

      return String(a.fullName || '').localeCompare(String(b.fullName || ''), 'sk')
    })
  }, [rows, search, choiceFilter])

  const selectableRows = filteredRows.filter((row: any) => canSelectRow(row, currentIssue))

  const allFilteredSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row: any) => selected.includes(row.userId))

  const selectedRows = rows.filter((row: any) => selected.includes(row.userId))

  const selectedMasoCount = selectedRows.filter((row: any) => {
    return String(row.typStravy || row.volba || '').toUpperCase() === 'MASO'
  }).length

  const selectedVegeCount = selectedRows.filter((row: any) => {
    return String(row.typStravy || row.volba || '').toUpperCase() === 'VEGE'
  }).length

  const selectedDietCount = selectedRows.filter((row: any) => {
    const choice = String(row.typStravy || row.volba || '').toUpperCase()
    return choice !== 'MASO' && choice !== 'VEGE'
  }).length

  const allRowsCount = rows.length

  const entitlementNoCount = rows.filter((row: any) => row.entitlementStatus === 'NO').length
  const entitlementUnknownCount = rows.filter((row: any) => row.entitlementStatus === 'UNKNOWN').length

  const removedCount = rows.filter((row: any) => {
    return !canSelectRow(row, currentIssue)
  }).length

  const hasSavedIssue = !!currentIssue
  const hasUnsavedChanges = currentIssue
    ? !sameStringSet(selected, savedPreparedIds)
    : selected.length > 0

  const saveStatusLabel = currentIssue
    ? hasUnsavedChanges
      ? 'ZMENY NEULOŽENÉ'
      : messageType === 'ok'
        ? 'ZMENY ULOŽENÉ'
        : 'ULOŽENÉ'
    : 'NEULOŽENÉ'

  const saveStatusColor = hasSavedIssue && !hasUnsavedChanges
    ? '#dcfce7'
    : '#ffedd5'

  const saveStatusBorder = hasSavedIssue && !hasUnsavedChanges
    ? '#22c55e'
    : '#fdba74'

  const saveStatusTextColor = hasSavedIssue && !hasUnsavedChanges
    ? '#166534'
    : '#9a3412'

  const loadIssueToEditor = (issue: any | null) => {
    setQrAddedRows([])

    if (!issue) {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
      return
    }

    setSelectedIssueId(issue.id)
    setDatum(issue.datum)
    setTypJedla(issue.typ_jedla)
    setSelected(issue.userIds || [])
  }

  const handleDateChange = (value: string) => {
    setDatum(value)
    setMessage('')
    setMessageType('')
    setQrAddedRows([])

    const issue = activeIssues.find(item => {
      return item.datum === value && item.typ_jedla === typJedla
    }) || null

    if (issue) {
      setSelectedIssueId(issue.id)
      setSelected(issue.userIds || [])
    } else {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
    }
  }

  const handleMealChange = (value: string) => {
    setTypJedla(value)
    setMessage('')
    setMessageType('')
    setQrAddedRows([])

    const issue = activeIssues.find(item => {
      return item.datum === datum && item.typ_jedla === value
    }) || null

    if (issue) {
      setSelectedIssueId(issue.id)
      setSelected(issue.userIds || [])
    } else {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
    }
  }

  const switchToActiveIssue = (issue: any) => {
    loadIssueToEditor(issue)
    setMessage('')
    setMessageType('')
  }

  const startNewPreparation = () => {
    setSelectedIssueId(null)
    setSelected(members.map(member => member.userId))
    setMessage('')
    setMessageType('')
    setQrAddedRows([])
  }

  const markAsChanged = () => {
    setMessage('')
    setMessageType('')
  }

  const toggleOne = (row: any) => {
    if (!canSelectRow(row, currentIssue)) return

    markAsChanged()

    setSelected(prev =>
      prev.includes(row.userId)
        ? prev.filter(id => id !== row.userId)
        : [...prev, row.userId]
    )
  }

  const toggleFiltered = () => {
    markAsChanged()

    if (allFilteredSelected) {
      setSelected(prev =>
        prev.filter(id => !selectableRows.some((row: any) => row.userId === id))
      )
      return
    }

    setSelected(prev => {
      const next = new Set(prev)
      selectableRows.forEach((row: any) => next.add(row.userId))
      return Array.from(next)
    })
  }

  const selectAll = () => {
    markAsChanged()
    setSelected(
      rows
        .filter((row: any) => canSelectRow(row, currentIssue))
        .map((row: any) => row.userId)
    )
  }

  const clearSelected = () => {
    markAsChanged()
    setSelected([])
  }

  const openQrModal = () => {
    setQrValue('')
    setQrMessage('')
    setQrMessageType('')
    setQrOpen(true)
  }

  const closeQrModal = () => {
    if (qrLoading) return

    setQrOpen(false)
    setQrValue('')
    setQrMessage('')
    setQrMessageType('')
    stopCamera()
  }

  const submitExpressQr = async (manualValue?: string, fromCamera = false) => {
    const cleanQr = String(manualValue ?? qrValue).trim()

    if (!cleanQr) {
      setQrMessage('Načítajte QR kód.')
      setQrMessageType('error')
      return
    }

    if (qrBusyRef.current) return

    qrBusyRef.current = true
    setQrLoading(true)
    setQrMessage('')
    setQrMessageType('')

    try {
      const res = await fetch('/api/group/issue/express-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: group.id,
          issueId: currentIssue?.id || '',
          datum,
          typJedla,
          qrCode: cleanQr
        })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setQrMessage('Server vrátil neplatnú odpoveď.')
        setQrMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setQrMessage(json.error || 'QR sa nepodarilo spracovať.')
        setQrMessageType('error')
        return
      }

      const member = json.member

      if (!member?.userId) {
        setQrMessage('Server nevrátil používateľa.')
        setQrMessageType('error')
        return
      }

      const row = {
        ...member,
        rowId: `qr-${member.userId}`,
        typStravy: member.typStravy || member.volba || '',
        addedByQr: true,
        isFromIssue: !!currentIssue
      }

      setQrAddedRows(prev => {
        const filtered = prev.filter((item: any) => item.userId !== member.userId)
        return [...filtered, row]
      })

      if (json.status === 'IN_OTHER_ISSUE') {
        setSelected(prev => prev.filter(id => id !== member.userId))
        setQrMessage(`V inom výdaji: ${member.fullName || member.email || cleanQr}`)
        setQrMessageType('error')
        setMessage(`Používateľ je už v inom hromadnom výdaji: ${member.fullName || member.email || cleanQr}`)
        setMessageType('error')
      } else {
        setSelected(prev => {
          if (prev.includes(member.userId)) return prev
          return [...prev, member.userId]
        })

        setQrMessage(`Pridaný: ${member.fullName || member.email || cleanQr}`)
        setQrMessageType('ok')
        setMessage(`Pridaný cez QR: ${member.fullName || member.email || cleanQr}`)
        setMessageType('ok')
      }

      setQrValue('')

      if (!fromCamera) {
        setTimeout(() => qrInputRef.current?.focus(), 60)
      }

      if (currentIssue?.id) {
        router.refresh()
      }
    } catch (err: any) {
      setQrMessage('Chyba spojenia so serverom: ' + err.message)
      setQrMessageType('error')
    } finally {
      setQrLoading(false)
      qrBusyRef.current = false
    }
  }

  const handleQrKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitExpressQr()
    }
  }

  const confirmPreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!selected.length) {
      setMessage('Nie sú vybrané žiadne osoby do hromadného výdaja.')
      setMessageType('error')
      return
    }

    if (currentIssue) {
      setMessage('Pre tento dátum a typ jedla už existuje príprava. Použite tlačidlo Potvrdiť úpravu.')
      setMessageType('error')
      return
    }

    const selectedRowsLocal = rows.filter((row: any) => selected.includes(row.userId))
    const warningCount = selectedRowsLocal.filter((row: any) => {
      return row.entitlementStatus === 'NO' || row.entitlementStatus === 'UNKNOWN'
    }).length

    const entitlementWarning =
      warningCount > 0
        ? `\n\nPozor: ${warningCount} vybraných osôb nemá potvrdený nárok alebo má nárok neznámy.`
        : ''

    const confirmText =
      myRole === 'POVERENY'
        ? `Potvrdiť prípravu hromadného výdaja pre ${selected.length} osôb? Príprava začne platiť o 15 minút.${entitlementWarning}`
        : `Potvrdiť prípravu hromadného výdaja pre ${selected.length} osôb?${entitlementWarning}`

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
  datum,
  typJedla,
  userIds: selected,
  qrExtraUserIds: qrAddedRows
    .filter((row: any) => selected.includes(row.userId))
    .map((row: any) => row.userId)
})
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
        setMessage(json.error || 'Prípravu hromadného výdaja sa nepodarilo potvrdiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Príprava hromadného výdaja bola potvrdená.')
      setMessageType('ok')
      setQrAddedRows([])
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const updatePreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!currentIssue) {
      setMessage('Nie je vybraná žiadna potvrdená príprava.')
      setMessageType('error')
      return
    }

    if (!selected.length) {
      setMessage('Príprava musí obsahovať aspoň jednu osobu.')
      setMessageType('error')
      return
    }

    const selectedRowsLocal = rows.filter((row: any) => selected.includes(row.userId))
    const warningCount = selectedRowsLocal.filter((row: any) => {
      return row.entitlementStatus === 'NO' || row.entitlementStatus === 'UNKNOWN'
    }).length

    const entitlementWarning =
      warningCount > 0
        ? `\n\nPozor: ${warningCount} vybraných osôb nemá potvrdený nárok alebo má nárok neznámy.`
        : ''

    const confirmText =
      myRole === 'POVERENY'
        ? `Potvrdiť úpravu prípravy pre ${selected.length} osôb? Po úprave začne znovu plynúť 15 minút.${entitlementWarning}`
        : `Potvrdiť úpravu prípravy pre ${selected.length} osôb?${entitlementWarning}`

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
  issueId: currentIssue.id,
  userIds: selected,
  qrExtraUserIds: qrAddedRows
    .filter((row: any) => selected.includes(row.userId))
    .map((row: any) => row.userId)
})
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
        setMessage(json.error || 'Úpravu prípravy sa nepodarilo potvrdiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Úprava prípravy bola potvrdená.')
      setMessageType('ok')
      setQrAddedRows([])
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const cancelPreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!currentIssue) {
      setMessage('Nie je vybraná žiadna príprava na zrušenie.')
      setMessageType('error')
      return
    }

    if (!confirm('Naozaj chcete zrušiť túto prípravu hromadného výdaja?')) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: currentIssue.id
        })
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
        setMessage(json.error || 'Prípravu sa nepodarilo zrušiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Príprava bola zrušená.')
      setMessageType('ok')
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
      setQrAddedRows([])
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const modeTitle = currentIssue
    ? 'Upravujete potvrdenú prípravu'
    : 'Pripravujete hromadný výdaj'

  const modeText = currentIssue
    ? `${formatDate(currentIssue.datum)} · ${mealLabel(currentIssue.typ_jedla)} · ${statusLabel(currentIssue.status)}`
    : `${formatDate(datum)} · ${mealLabel(typJedla)} · zatiaľ nepotvrdené`

  return (
    <div style={styles.screen}>
      <header style={styles.mobileHeader}>
        <div>
          <div style={styles.breadcrumb}>Moja skupina / Hromadný výdaj</div>
          <h1 style={styles.title}>Príprava výdaja</h1>
        </div>

        <a href="/dashboard/group" style={styles.closeButton}>
          Späť
        </a>
      </header>

      <section
        style={{
          ...styles.modeBar,
          background: currentIssue
            ? isWaiting
              ? '#fff7ed'
              : isActive
                ? '#ecfdf5'
                : '#fff'
            : '#eff6ff',
          borderColor: currentIssue
            ? isWaiting
              ? '#fed7aa'
              : isActive
                ? '#86efac'
                : '#e5e7eb'
            : '#bfdbfe'
        }}
      >
        <div style={styles.modeMain}>
          <b>{modeTitle}</b>
          <span>{modeText}</span>
        </div>

        {currentIssue && (
          <div style={styles.modeStatus}>
            {isWaiting ? (
              <>
                <strong>{formatCountdown(remainingMs)}</strong>
                <small>do aktivácie</small>
              </>
            ) : (
              <>
                <strong>Platná</strong>
                <small>príprava</small>
              </>
            )}
          </div>
        )}
      </section>

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Nastavenie prípravy</div>

          <div style={styles.formGrid}>
            <label style={styles.field}>
              <span>Dátum</span>

              <div style={styles.datePickerBox}>
                <span style={styles.datePickerText}>
                  {formatDate(datum)}
                </span>

                <span style={styles.datePickerIcon}>
                  ▾
                </span>

                <input
                  type="date"
                  value={datum}
                  onChange={e => handleDateChange(e.target.value)}
                  style={styles.hiddenDateInput}
                />
              </div>
            </label>

            <label style={styles.field}>
              <span>Jedlo</span>
              <select
                value={typJedla}
                onChange={e => handleMealChange(e.target.value)}
                style={styles.input}
              >
                <option value="OBED">OBED</option>
                <option value="VECERA">VEČERA</option>
              </select>
            </label>
          </div>

          <div style={styles.metaLine}>
            <span>{group.name}</span>
            <span>{myName ? `${myName} · ${myRole}` : myRole}</span>
          </div>

          {myRole === 'POVERENY' && (
            <div
              style={{
                ...styles.waitNotice,
                background: currentIssue && isWaiting ? '#fee2e2' : '#fff7ed',
                color: currentIssue && isWaiting ? '#991b1b' : '#9a3412',
                borderColor: currentIssue && isWaiting ? '#fecaca' : '#fed7aa'
              }}
            >
              {currentIssue ? (
                isWaiting ? (
                  <>
                    Úprava poverenej osoby ešte nie je platná. Ostáva: <b>{formatCountdown(remainingMs)}</b>
                  </>
                ) : (
                  <>
                    Príprava poverenej osoby je platná.
                  </>
                )
              ) : (
                <>
                  Poverená osoba: po potvrdení alebo úprave začne platiť 15 minútový odpočet.
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeaderRow}>
            <div style={styles.panelTitle}>Aktívne prípravy</div>

            <button
              type="button"
              style={styles.tinyButton}
              onClick={startNewPreparation}
            >
              Nová
            </button>
          </div>

          {!activeIssues.length ? (
            <div style={styles.emptySmall}>
              Žiadna aktívna príprava.
            </div>
          ) : (
            <div style={styles.activeList}>
              {activeIssues.map((item: any) => {
                const active = currentIssue?.id === item.id

                const plannedItems = (item.items || []).filter((row: any) => row.status === 'PLANNED')

                const activeMasoCount = plannedItems.filter((row: any) => {
                  return String(row.typStravy || row.volba || '').toUpperCase() === 'MASO'
                }).length

                const activeVegeCount = plannedItems.filter((row: any) => {
                  return String(row.typStravy || row.volba || '').toUpperCase() === 'VEGE'
                }).length

                const activeDietCount = plannedItems.filter((row: any) => {
                  const choice = String(row.typStravy || row.volba || '').toUpperCase()
                  return choice !== 'MASO' && choice !== 'VEGE'
                }).length

                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => switchToActiveIssue(item)}
                    style={{
                      ...styles.activeIssue,
                      borderColor: active ? '#22c55e' : '#e5e7eb',
                      background: active ? '#ecfdf5' : '#f9fafb'
                    }}
                  >
                    <div style={styles.activeIssueTop}>
                      <b>{formatDate(item.datum)}</b>
                      <b>{mealLabel(item.typ_jedla)}</b>
                    </div>

                    <div style={styles.activeIssueBottom}>
                      <span>{statusLabel(item.status)}</span>
                      <span>{item.peopleCount || 0} osôb</span>
                    </div>

                    <div style={styles.activeIssueCounts}>
                      <small>SPOLU {plannedItems.length}</small>
                      <small>MASO {activeMasoCount}</small>
                      <small>VEGE {activeVegeCount}</small>
                      <small>Diéta {activeDietCount}</small>
                    </div>

                    {item.withoutEntitlementCount > 0 && (
                      <div style={styles.activeIssueWarning}>
                        Bez nároku: {item.withoutEntitlementCount}
                      </div>
                    )}

                    {item.valid_after && (
                      <div style={styles.activeIssueTime}>
                        Platné od: {formatDateTime(item.valid_after)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section style={styles.statsPanel}>
        <div style={styles.statsCaption}>
          Aktuálny návrh prípravy
        </div>

        <div style={styles.filterRow}>
          <button
            type="button"
            style={{
              ...styles.filterButton,
              ...(choiceFilter === 'ALL' ? styles.filterButtonActive : {})
            }}
            onClick={() => setChoiceFilter('ALL')}
          >
            <b>{selectedRows.length}/{allRowsCount}</b>
            <span>SPOLU</span>
          </button>

          <button
            type="button"
            style={{
              ...styles.filterButton,
              ...(choiceFilter === 'MASO' ? styles.filterButtonActive : {})
            }}
            onClick={() => setChoiceFilter('MASO')}
          >
            <b>{selectedMasoCount}</b>
            <span>MASO</span>
          </button>

          <button
            type="button"
            style={{
              ...styles.filterButton,
              ...(choiceFilter === 'VEGE' ? styles.filterButtonActive : {})
            }}
            onClick={() => setChoiceFilter('VEGE')}
          >
            <b>{selectedVegeCount}</b>
            <span>VEGE</span>
          </button>

          {selectedDietCount > 0 && (
            <button
              type="button"
              style={{
                ...styles.filterButton,
                ...(choiceFilter === 'UNKNOWN' ? styles.filterButtonActive : {})
              }}
              onClick={() => setChoiceFilter('UNKNOWN')}
            >
              <b>{selectedDietCount}</b>
              <span>Diéta</span>
            </button>
          )}
        </div>

        <div style={styles.statusCountRow}>
          <div
            style={{
              ...styles.saveStatusCard,
              background: saveStatusColor,
              borderColor: saveStatusBorder,
              color: saveStatusTextColor
            }}
          >
            <b>{saveStatusLabel}</b>
          </div>

          {(entitlementNoCount > 0 || entitlementUnknownCount > 0) && (
            <div style={styles.entitlementWarningCard}>
              <b>{entitlementNoCount + entitlementUnknownCount}</b>
              <span>BEZ NÁROKU</span>
            </div>
          )}

          {currentIssue && removedCount > 0 && (
            <div style={styles.removedCountCard}>
              <b>{removedCount}</b>
              <span>VYRADENÝCH</span>
            </div>
          )}
        </div>
      </section>

      <section style={styles.toolbar}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Hľadať osobu..."
          style={styles.searchInput}
        />

        <select
          value={choiceFilter}
          onChange={e => setChoiceFilter(e.target.value as any)}
          style={styles.select}
        >
          <option value="ALL">Všetci</option>
          <option value="MASO">MASO</option>
          <option value="VEGE">VEGE</option>
          <option value="UNKNOWN">Nezadané</option>
        </select>
      </section>

      <section style={styles.actionBar}>
        <div style={styles.actionLeft}>
          <button type="button" style={styles.darkButton} onClick={toggleFiltered}>
            {allFilteredSelected ? 'Zrušiť zobrazených' : 'Označiť zobrazených'}
          </button>

          <button type="button" style={styles.lightButton} onClick={selectAll}>
            Všetkých
          </button>

          <button type="button" style={styles.lightButton} onClick={clearSelected}>
            Vyčistiť
          </button>
        </div>

        <div style={styles.actionRight}>
          <button
            type="button"
            style={styles.qrButton}
            onClick={openQrModal}
          >
            Cez QR
          </button>

          {currentIssue ? (
            <>
              <button
                type="button"
                style={{
                  ...styles.confirmButton,
                  opacity: loading || selected.length === 0 ? 0.55 : 1
                }}
                disabled={loading || selected.length === 0}
                onClick={updatePreparation}
              >
                {loading ? 'Ukladám...' : 'Potvrdiť úpravu'}
              </button>

              <button
                type="button"
                style={{
                  ...styles.cancelButton,
                  opacity: loading ? 0.55 : 1
                }}
                disabled={loading}
                onClick={cancelPreparation}
              >
                Zrušiť prípravu
              </button>
            </>
          ) : (
            <button
              type="button"
              style={{
                ...styles.confirmButton,
                opacity: loading || selected.length === 0 ? 0.55 : 1
              }}
              disabled={loading || selected.length === 0}
              onClick={confirmPreparation}
            >
              {loading ? 'Potvrdzujem...' : 'Potvrdiť prípravu'}
            </button>
          )}
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

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
  <div></div>
  <div>Osoba</div>
  <div>Jedlo</div>
  <div>Rola</div>
  <div>Stav</div>
  <div>Pridal</div>
  <div>Nárok</div>
</div>

        {!filteredRows.length ? (
          <div style={styles.emptyState}>
            Nenašli sa žiadne osoby.
          </div>
        ) : (
          filteredRows.map((row: any) => {
            const isSelected = selected.includes(row.userId)
            const choice = String(row.typStravy || row.volba || '').toUpperCase()
            const selectable = canSelectRow(row, currentIssue)
            const statusText = itemStatusLabel(row, selected, savedPreparedIds)
            const entitlementText = entitlementLabel(row.entitlementStatus)
            const isInactiveRow = !selectable

            return (
              <div
                key={row.rowId}
                style={{
                  ...styles.row,
                  background: isInactiveRow
                    ? '#e5e7eb'
                    : isSelected
                      ? '#ecfdf5'
                      : '#fff',
                  borderColor: isInactiveRow
                    ? '#9ca3af'
                    : isSelected
                      ? '#22c55e'
                      : '#e5e7eb',
                  opacity: isInactiveRow ? 0.58 : 1,
                  cursor: selectable ? 'pointer' : 'not-allowed'
                }}
                onClick={() => toggleOne(row)}
              >
                <div style={styles.checkCell}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!selectable}
                    onChange={() => toggleOne(row)}
                    onClick={e => e.stopPropagation()}
                    style={styles.checkbox}
                  />
                </div>

                <div style={styles.personCell}>
                  <div style={styles.personName}>
                    {row.fullName || 'Bez mena'}
                  </div>

                  <div style={styles.personMeta}>
                    {row.email || '-'}
                    {row.telefon ? ` · ${row.telefon}` : ''}
                  </div>

                  {row.addedByQr && (
                    <div style={styles.qrBadge}>
                      CEZ QR
                    </div>
                  )}
                </div>

                <div>
                  <span
                    style={{
                      ...styles.choiceBadge,
                      background:
                        choice === 'MASO'
                          ? '#111827'
                          : choice === 'VEGE'
                            ? '#dcfce7'
                            : '#fef3c7',
                      color:
                        choice === 'MASO'
                          ? '#fff'
                          : choice === 'VEGE'
                            ? '#166534'
                            : '#92400e'
                    }}
                  >
                    {choiceLabel(choice)}
                  </span>
                </div>

                <div>
                  <span style={styles.roleBadge}>
                    {row.addedByQr || row.source === 'QR_EXTRA' ? '—' : row.role || '—'}
                  </span>
                </div>

                <div>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background: isInactiveRow
                        ? '#d1d5db'
                        : statusText === 'UPRAVUJE SA'
                          ? '#ffedd5'
                          : statusText === 'PRIPRAVENÝ'
                            ? '#dbeafe'
                            : '#f3f4f6',
                      color: isInactiveRow
                        ? '#374151'
                        : statusText === 'UPRAVUJE SA'
                          ? '#9a3412'
                          : statusText === 'PRIPRAVENÝ'
                            ? '#1d4ed8'
                            : '#374151'
                    }}
                  >
                    {statusText}
                  </span>
                </div>
<div>
  <span style={styles.sourceBadge}>
    {row.addedByQr || row.source === 'QR_EXTRA' ? 'QR scan' : 'SKUPINA'}
  </span>
</div>
                <div>
                  <span
                    style={{
                      ...styles.entitlementBadge,
                      background:
                        row.entitlementStatus === 'YES'
                          ? '#dcfce7'
                          : row.entitlementStatus === 'NO'
                            ? '#fee2e2'
                            : '#ffedd5',
                      color:
                        row.entitlementStatus === 'YES'
                          ? '#166534'
                          : row.entitlementStatus === 'NO'
                            ? '#991b1b'
                            : '#9a3412'
                    }}
                  >
                    {entitlementText}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </section>

      {qrOpen && (
        <div style={styles.modalOverlay} onClick={closeQrModal}>
          <div style={styles.qrModal} onClick={event => event.stopPropagation()}>
            <div style={styles.qrModalHeader}>
              <div>
                <b>Expres QR</b>
                <span>Skenujte QR kódy postupne. Okno zatvoríte krížikom.</span>
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
              <label style={styles.manualQrLabel}>
                Manuálne načítanie / scanner
              </label>

              <div style={styles.manualQrRow}>
                <input
                  ref={qrInputRef}
                  value={qrValue}
                  onChange={event => setQrValue(event.target.value)}
                  onKeyDown={handleQrKeyDown}
                  placeholder="Naskenujte alebo vložte QR..."
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
                  onClick={() => submitExpressQr()}
                  disabled={qrLoading}
                >
                  {qrLoading ? '...' : 'Pridať'}
                </button>
              </div>
            </div>

            {qrMessage && (
              <div
                style={{
                  ...styles.qrMessage,
                  background: qrMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                  color: qrMessageType === 'ok' ? '#166534' : '#991b1b',
                  borderColor: qrMessageType === 'ok' ? '#86efac' : '#fecaca'
                }}
              >
                {qrMessage}
              </div>
            )}
          </div>
        </div>
      )}

      <section style={styles.bottomSpace} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 10
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
    border: '1px solid',
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
  topGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
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
    fontWeight: 900
  },
  formGrid: {
    width: '100%',
    maxWidth: '100%',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 10,
    overflow: 'hidden'
  },
  field: {
    width: '100%',
    maxWidth: '100%',
    display: 'grid',
    gap: 4,
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    minWidth: 0,
    overflow: 'hidden'
  },
  input: {
    display: 'block',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    overflow: 'hidden',
    WebkitAppearance: 'none',
    appearance: 'none'
  },
  datePickerBox: {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 38px 10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    overflow: 'hidden',
    minHeight: 42,
    display: 'flex',
    alignItems: 'center'
  },
  datePickerText: {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  datePickerIcon: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 16,
    fontWeight: 900,
    color: '#111827',
    pointerEvents: 'none'
  },
  hiddenDateInput: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    border: 0,
    padding: 0,
    margin: 0,
    cursor: 'pointer'
  },
  metaLine: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 850,
    color: '#374151',
    flexWrap: 'wrap'
  },
  waitNotice: {
    marginTop: 9,
    border: '1px solid',
    borderRadius: 12,
    padding: 9,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.35
  },
  emptySmall: {
    background: '#f9fafb',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  activeList: {
    display: 'grid',
    gap: 7
  },
  activeIssue: {
    width: '100%',
    textAlign: 'left',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    color: '#111827',
    display: 'grid',
    gap: 5
  },
  activeIssueTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 13
  },
  activeIssueBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  activeIssueCounts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    fontSize: 10,
    fontWeight: 900,
    color: '#374151'
  },
  activeIssueTime: {
    fontSize: 11,
    fontWeight: 800,
    color: '#9a3412'
  },
  activeIssueWarning: {
    fontSize: 11,
    fontWeight: 900,
    color: '#9a3412'
  },
  statsPanel: {
    display: 'grid',
    gap: 8
  },
  statsCaption: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.3
  },
  filterRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
    gap: 8
  },
  filterButton: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '9px 6px',
    textAlign: 'center',
    color: '#111827',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
    display: 'grid',
    gap: 2,
    cursor: 'pointer'
  },
  filterButtonActive: {
    background: '#eff6ff',
    borderColor: '#93c5fd',
    color: '#1d4ed8'
  },
  statusCountRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8
  },
  saveStatusCard: {
    border: '1px solid',
    borderRadius: 14,
    padding: '10px 8px',
    textAlign: 'center',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
    display: 'grid',
    gap: 3
  },
  entitlementWarningCard: {
    background: '#ffedd5',
    border: '1px solid #fdba74',
    borderRadius: 14,
    padding: '10px 8px',
    textAlign: 'center',
    color: '#9a3412',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
    display: 'grid',
    gap: 3
  },
  removedCountCard: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: '10px 8px',
    textAlign: 'center',
    color: '#991b1b',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)',
    display: 'grid',
    gap: 3
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 130px',
    gap: 8
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 700,
    outline: 'none'
  },
  select: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
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
  actionRight: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap'
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 11px',
    fontSize: 12,
    fontWeight: 900
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 11px',
    fontSize: 12,
    fontWeight: 900
  },
  qrButton: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  cancelButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  message: {
    border: '1px solid',
    borderRadius: 14,
    padding: 11,
    fontSize: 13,
    fontWeight: 850
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 820,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 86px 150px 82px 92px',
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
    minWidth: 740,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 86px 150px 82px 92px',
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
  qrBadge: {
    display: 'inline-flex',
    marginTop: 4,
    borderRadius: 999,
    padding: '3px 7px',
    fontSize: 9,
    fontWeight: 950,
    background: '#dbeafe',
    color: '#1d4ed8'
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
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  entitlementBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  qrModal: {
    width: '100%',
    maxWidth: 420,
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
    lineHeight: 1
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
  qrMessage: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  bottomSpace: {
    height: 20
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

  
}