'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import jsQR from 'jsqr'

type GroupItem = {
  id: string
  name: string
}

type RegistrationGroupItem = {
  id: string
  name: string
}

type PersonGroup = {
  id: string
  name: string
  role: string
}

type PersonEntitlement = {
  datum: string
  obed: boolean
  vecera: boolean
}

type CalendarClaim = {
  obed: boolean
  vecera: boolean
}

type BulkEntitlementClaims = {
  obed: string[]
  vecera: string[]
}

type PersonItem = {
  id: string
  fullName: string
  meno: string
  priezvisko: string
  email: string
  telefon: string
  typStravy: string
  aktivny: string
  reviewStatus: string
  registrationGroupId: string
  registrationGroupName: string
  registrationGroupNote: string
  activeQrCount: number
  activeNfcCount: number
  globalRoles: string[]
  entitlementDays: number
  lunchClaims: number
  dinnerClaims: number
  mealClaims: number
  entitlements: PersonEntitlement[]
  groups: PersonGroup[]
}

function foodLabel(value: string) {
  const normalized = String(value || '').toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIÉTA'

  return 'NEZADANÉ'
}

function rolePriority(person: PersonItem) {
  if (person.groups.some(group => group.role === 'MANAGER')) return 0
  if (person.groups.some(group => group.role === 'POVERENY')) return 1
  return 2
}

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function dateRangeIso(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return []
  }

  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`)
  }

  return dates
}

function shortDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)

  return date.toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit'
  })
}

function entitlementBounds(entitlements: PersonEntitlement[], fallbackFrom: string, fallbackTo: string) {
  const dates = entitlements.map(item => item.datum).sort()

  if (dates.length === 0) {
    return {
      validFrom: fallbackFrom,
      validTo: fallbackTo
    }
  }

  return {
    validFrom: dates[0],
    validTo: dates[dates.length - 1]
  }
}

function calendarClaimsFromEntitlements(entitlements: PersonEntitlement[]) {
  return Object.fromEntries(
    entitlements.map(item => [
      item.datum,
      {
        obed: item.obed,
        vecera: item.vecera
      }
    ])
  )
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

export default function PersonalistaClient({
  people,
  groups,
  registrationGroups,
  fromDate,
  toDate,
  canManage,
  canAssignSensitiveRoles,
  canDeregisterUsers
}: {
  people: PersonItem[]
  groups: GroupItem[]
  registrationGroups: RegistrationGroupItem[]
  fromDate: string
  toDate: string
  canManage: boolean
  canAssignSensitiveRoles: boolean
  canDeregisterUsers: boolean
}) {
  const router = useRouter()
  const qrScannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrScannerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const qrScannerStreamRef = useRef<MediaStream | null>(null)
  const qrScannerLoopRef = useRef<number | null>(null)
  const qrScannerReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const qrScannerCancelledRef = useRef(false)
  const qrScannerAttemptRef = useRef(0)

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('ALL')
  const [foodFilter, setFoodFilter] = useState('ALL')
  const [qrFilter, setQrFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [pageSize, setPageSize] = useState(50)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedPersonId, setSelectedPersonId] = useState(people[0]?.id || '')
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createMessage, setCreateMessage] = useState('')
  const [createMessageType, setCreateMessageType] = useState<'ok' | 'error' | ''>('')
  const [createGroupSelectId, setCreateGroupSelectId] = useState('')
  const [registrationGroupsOpen, setRegistrationGroupsOpen] = useState(false)
  const [registrationGroupName, setRegistrationGroupName] = useState('')
  const [registrationGroupLoading, setRegistrationGroupLoading] = useState(false)
  const [registrationGroupMessage, setRegistrationGroupMessage] = useState('')
  const [registrationGroupMessageType, setRegistrationGroupMessageType] = useState<'ok' | 'error' | ''>('')
  const [registrationAssignmentOpen, setRegistrationAssignmentOpen] = useState(false)
  const [registrationAssignmentLoading, setRegistrationAssignmentLoading] = useState(false)
  const [registrationAssignmentMessage, setRegistrationAssignmentMessage] = useState('')
  const [registrationAssignmentMessageType, setRegistrationAssignmentMessageType] = useState<'ok' | 'error' | ''>('')
  const [registrationAssignmentSearch, setRegistrationAssignmentSearch] = useState('')
  const [bulkRegistrationEntitlementsOpen, setBulkRegistrationEntitlementsOpen] = useState(false)
  const [bulkRegistrationEntitlementsLoading, setBulkRegistrationEntitlementsLoading] = useState(false)
  const [bulkRegistrationEntitlementsMessage, setBulkRegistrationEntitlementsMessage] = useState('')
  const [bulkRegistrationEntitlementsMessageType, setBulkRegistrationEntitlementsMessageType] = useState<'ok' | 'error' | ''>('')
  const [detailMode, setDetailMode] = useState<'profile' | 'entitlements' | 'groups' | 'roles' | 'qr' | 'nfc' | ''>('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailMessage, setDetailMessage] = useState('')
  const [detailMessageType, setDetailMessageType] = useState<'ok' | 'error' | ''>('')
  const [createForm, setCreateForm] = useState({
    meno: '',
    priezvisko: '',
    email: '',
    telefon: '',
    typStravy: 'MASO',
    registrationGroupId: '',
    groupIds: [] as string[],
    validFrom: isoDateOffset(0),
    validTo: isoDateOffset(0),
    obed: true,
    vecera: false,
    assignQr: true
  })
  const [profileForm, setProfileForm] = useState({
    meno: '',
    priezvisko: '',
    email: '',
    telefon: '',
    typStravy: 'MASO',
    registrationGroupId: '',
    registrationGroupNote: ''
  })
  const [entitlementForm, setEntitlementForm] = useState({
    validFrom: fromDate,
    validTo: toDate,
    obed: false,
    vecera: false
  })
  const [bulkRegistrationEntitlementsForm, setBulkRegistrationEntitlementsForm] = useState({
    registrationGroupId: '',
    validFrom: fromDate,
    validTo: toDate,
    obed: true,
    vecera: false,
    activeOnly: true
  })
  const [registrationAssignmentForm, setRegistrationAssignmentForm] = useState({
    registrationGroupId: '',
    registrationGroupNote: '',
    userIds: [] as string[]
  })
  const [calendarClaims, setCalendarClaims] = useState<Record<string, CalendarClaim>>({})
  const [bulkEntitlementClaims, setBulkEntitlementClaims] = useState<BulkEntitlementClaims>({
    obed: [],
    vecera: []
  })
  const [qrForm, setQrForm] = useState({
    qrCode: ''
  })
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [qrScannerReady, setQrScannerReady] = useState(false)
  const [qrScannerStatus, setQrScannerStatus] = useState('Kamera je vypnutá.')
  const [groupForm, setGroupForm] = useState({
    groupId: '',
    role: 'MEMBER'
  })
  const [nfcForm, setNfcForm] = useState({
    tokenUid: ''
  })
  const [roleForm, setRoleForm] = useState({
    admin: false,
    personalista: false,
    adminVydaj: false,
    vydaj: false,
    groupCreator: false
  })

  const selectedPerson = selectedPersonId
    ? people.find(person => person.id === selectedPersonId) || null
    : null
  const printGroupHref =
    groupFilter !== 'ALL' && groupFilter !== 'UNGROUPED'
      ? `/dashboard/personalista/print-qr?groupId=${encodeURIComponent(groupFilter)}`
      : ''
  const printPersonHref = selectedPerson
    ? `/dashboard/personalista/print-qr?personId=${encodeURIComponent(selectedPerson.id)}`
    : ''

  useEffect(() => {
    if (!selectedPerson) return

    setProfileForm({
      meno: selectedPerson.meno || '',
      priezvisko: selectedPerson.priezvisko || '',
      email: selectedPerson.email || '',
      telefon: selectedPerson.telefon || '',
      typStravy: selectedPerson.typStravy || 'MASO',
      registrationGroupId: selectedPerson.registrationGroupId || '',
      registrationGroupNote: selectedPerson.registrationGroupNote || ''
    })

    const bounds = entitlementBounds(selectedPerson.entitlements, fromDate, toDate)
    const nextEntitlementForm = {
      validFrom: bounds.validFrom,
      validTo: bounds.validTo,
      obed: false,
      vecera: false
    }

    setEntitlementForm(nextEntitlementForm)
    setCalendarClaims(calendarClaimsFromEntitlements(selectedPerson.entitlements))
    setBulkEntitlementClaims({ obed: [], vecera: [] })

    setQrForm({ qrCode: '' })
    setGroupForm({ groupId: '', role: 'MEMBER' })
    setNfcForm({ tokenUid: '' })
    setRoleForm({
      admin: selectedPerson.globalRoles.includes('ADMIN'),
      personalista: selectedPerson.globalRoles.includes('PERSONALISTA'),
      adminVydaj: selectedPerson.globalRoles.includes('ADMIN_VYDAJ'),
      vydaj: selectedPerson.globalRoles.includes('VYDAJ'),
      groupCreator: selectedPerson.globalRoles.includes('GROUP_CREATOR')
    })
    setDetailMessage('')
    setDetailMessageType('')
  }, [selectedPerson, fromDate, toDate])

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase()

    return people
      .filter(person => {
        if (!q) return true

        return (
          person.fullName.toLowerCase().includes(q) ||
          person.email.toLowerCase().includes(q) ||
          person.telefon.toLowerCase().includes(q)
        )
      })
      .filter(person => {
        if (groupFilter === 'ALL') return true
        if (groupFilter === 'UNGROUPED') return person.groups.length === 0
        return person.groups.some(group => group.id === groupFilter)
      })
      .filter(person => {
        if (foodFilter === 'ALL') return true
        return foodLabel(person.typStravy) === foodFilter
      })
      .filter(person => {
        if (qrFilter === 'ALL') return true
        if (qrFilter === 'ACTIVE') return person.activeQrCount > 0
        return person.activeQrCount === 0
      })
      .filter(person => {
        const blocked = String(person.aktivny || '').toUpperCase() !== 'ANO'
        const pendingReview = String(person.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'

        if (statusFilter === 'ALL') return true
        if (statusFilter === 'PENDING_REVIEW') return pendingReview
        if (statusFilter === 'BLOCKED') return blocked
        return !blocked && !pendingReview
      })
      .sort((a, b) => {
        const aPendingReview = String(a.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'
        const bPendingReview = String(b.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'
        const aBlocked = String(a.aktivny || '').toUpperCase() !== 'ANO'
        const bBlocked = String(b.aktivny || '').toUpperCase() !== 'ANO'

        if (aPendingReview !== bPendingReview) return aPendingReview ? -1 : 1
        if (aBlocked !== bBlocked) return aBlocked ? 1 : -1

        const priority = rolePriority(a) - rolePriority(b)
        if (priority !== 0) return priority

        return a.fullName.localeCompare(b.fullName, 'sk')
      })
  }, [people, search, groupFilter, foodFilter, qrFilter, statusFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, groupFilter, foodFilter, qrFilter, statusFilter, pageSize])

  useEffect(() => {
    if (!filteredPeople.length) {
      if (selectedPersonId) setSelectedPersonId('')
      return
    }

    if (!filteredPeople.some(person => person.id === selectedPersonId)) {
      setSelectedPersonId(filteredPeople[0].id)
    }
  }, [filteredPeople, selectedPersonId])

  const pageCount = Math.max(1, Math.ceil(filteredPeople.length / pageSize))
  const safeCurrentPage = Math.min(currentPage, pageCount)
  const pageStart = (safeCurrentPage - 1) * pageSize
  const pageEnd = Math.min(pageStart + pageSize, filteredPeople.length)
  const pagedPeople = filteredPeople.slice(pageStart, pageEnd)

  const stats = useMemo(() => {
    const activeQr = people.filter(person => person.activeQrCount > 0).length
    const withoutQr = people.length - activeQr
    const blocked = people.filter(person => String(person.aktivny || '').toUpperCase() !== 'ANO').length
    const pendingReview = people.filter(person => String(person.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW').length
    const withDiet = people.filter(person => foodLabel(person.typStravy) === 'DIÉTA').length
    const totalClaims = people.reduce((sum, person) => sum + person.mealClaims, 0)
    const totalLunches = people.reduce((sum, person) => sum + person.lunchClaims, 0)
    const totalDinners = people.reduce((sum, person) => sum + person.dinnerClaims, 0)
    const totalDays = people.reduce((sum, person) => sum + person.entitlementDays, 0)

    return {
      activeQr,
      withoutQr,
      blocked,
      pendingReview,
      withDiet,
      totalClaims,
      totalLunches,
      totalDinners,
      totalDays
    }
  }, [people])

  const selectedCreateGroups = useMemo(() => {
    return groups.filter(group => createForm.groupIds.includes(group.id))
  }, [groups, createForm.groupIds])

  const availableCreateGroups = useMemo(() => {
    return groups.filter(group => !createForm.groupIds.includes(group.id))
  }, [groups, createForm.groupIds])

  const safeCreateGroupSelectId =
    availableCreateGroups.some(group => group.id === createGroupSelectId)
      ? createGroupSelectId
      : ''

  const availableDetailGroups = useMemo(() => {
    if (!selectedPerson) return []
    return groups.filter(group => !selectedPerson.groups.some(personGroup => personGroup.id === group.id))
  }, [groups, selectedPerson])

  const safeDetailGroupId =
    availableDetailGroups.some(group => group.id === groupForm.groupId)
      ? groupForm.groupId
      : ''

  const groupRoleOptions = canAssignSensitiveRoles
    ? ['MEMBER', 'POVERENY', 'MANAGER']
    : ['MEMBER', 'POVERENY']

  const entitlementCalendarDates = useMemo(() => {
    return dateRangeIso(entitlementForm.validFrom, entitlementForm.validTo)
  }, [entitlementForm.validFrom, entitlementForm.validTo])

  const entitlementByDate = useMemo(() => {
    return new Map((selectedPerson?.entitlements || []).map(item => [item.datum, item]))
  }, [selectedPerson])
  const selectedBulkRegistrationGroup = useMemo(() => {
    return registrationGroups.find(group => group.id === bulkRegistrationEntitlementsForm.registrationGroupId) || null
  }, [registrationGroups, bulkRegistrationEntitlementsForm.registrationGroupId])
  const selectedBulkRegistrationGroupPeopleCount = useMemo(() => {
    if (!bulkRegistrationEntitlementsForm.registrationGroupId) return 0

    return people.filter(person => {
      if (person.registrationGroupId !== bulkRegistrationEntitlementsForm.registrationGroupId) return false
      if (!bulkRegistrationEntitlementsForm.activeOnly) return true

      return String(person.aktivny || '').toUpperCase() === 'ANO'
    }).length
  }, [people, bulkRegistrationEntitlementsForm.registrationGroupId, bulkRegistrationEntitlementsForm.activeOnly])
  const selectedRegistrationAssignmentGroup = useMemo(() => {
    return registrationGroups.find(group => group.id === registrationAssignmentForm.registrationGroupId) || null
  }, [registrationGroups, registrationAssignmentForm.registrationGroupId])
  const selectedRegistrationAssignmentPeople = useMemo(() => {
    const selectedIds = new Set(registrationAssignmentForm.userIds)

    return people.filter(person => selectedIds.has(person.id))
  }, [people, registrationAssignmentForm.userIds])
  const registrationAssignmentFilteredPeople = useMemo(() => {
    const query = registrationAssignmentSearch.trim().toLowerCase()

    if (!query) return people

    return people.filter(person => {
      const haystack = [
        person.fullName,
        person.email,
        person.registrationGroupName,
        person.typStravy
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  }, [people, registrationAssignmentSearch])

  const updateCreateForm = (key: string, value: any) => {
    setCreateForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const addCreateGroup = () => {
    if (!safeCreateGroupSelectId) return

    setCreateForm(prev => ({
      ...prev,
      groupIds: prev.groupIds.includes(safeCreateGroupSelectId)
        ? prev.groupIds
        : [...prev.groupIds, safeCreateGroupSelectId]
    }))

    setCreateGroupSelectId('')
  }

  const removeCreateGroup = (groupId: string) => {
    setCreateForm(prev => ({
      ...prev,
      groupIds: prev.groupIds.filter(id => id !== groupId)
    }))

    setCreateGroupSelectId(groupId)
  }

  const clearCreateGroups = () => {
    setCreateForm(prev => ({
      ...prev,
      groupIds: []
    }))

    setCreateGroupSelectId('')
  }

  const resetCreateForm = () => {
    setCreateForm({
      meno: '',
      priezvisko: '',
      email: '',
      telefon: '',
      typStravy: 'MASO',
      registrationGroupId: '',
      groupIds: [] as string[],
      validFrom: isoDateOffset(0),
      validTo: isoDateOffset(0),
      obed: true,
      vecera: false,
      assignQr: true
    })
    setCreateGroupSelectId('')
  }

  const createPerson = async () => {
    setCreateMessage('')
    setCreateMessageType('')

    if (!canManage) {
      setCreateMessage('Nemáš oprávnenie vytvárať osoby.')
      setCreateMessageType('error')
      return
    }

    setCreateLoading(true)

    try {
      const res = await fetch('/api/personalista/people/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm)
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setCreateMessage('Server vrátil neplatnú odpoveď.')
        setCreateMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setCreateMessage(json.error || 'Osobu sa nepodarilo vytvoriť.')
        setCreateMessageType('error')
        return
      }

      setCreateMessage(json.message || 'Osoba bola vytvorená.')
      setCreateMessageType('ok')
      resetCreateForm()

      setTimeout(() => {
        setCreateOpen(false)
        router.refresh()
      }, 650)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCreateMessage('Chyba spojenia so serverom: ' + message)
      setCreateMessageType('error')
    } finally {
      setCreateLoading(false)
    }
  }

  const updateProfileForm = (key: string, value: any) => {
    setProfileForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const updateEntitlementForm = (key: string, value: any) => {
    const nextForm = {
      ...entitlementForm,
      [key]: value
    }

    setEntitlementForm(nextForm)

    if (key === 'validFrom' || key === 'validTo') {
      return
    }

    if (key === 'obed' || key === 'vecera') {
      const meal = key as 'obed' | 'vecera'

      if (value) {
        const next = { ...calendarClaims }
        const addedDates: string[] = []

        dateRangeIso(nextForm.validFrom, nextForm.validTo).forEach(date => {
          const current = next[date] || { obed: false, vecera: false }

          if (!current[meal]) {
            next[date] = {
              ...current,
              [meal]: true
            }
            addedDates.push(date)
          }
        })

        setCalendarClaims(next)
        setBulkEntitlementClaims(prev => ({
          ...prev,
          [meal]: Array.from(new Set([...prev[meal], ...addedDates]))
        }))
        return
      }

      const datesToRemove = new Set(bulkEntitlementClaims[meal])
      const next = { ...calendarClaims }

      datesToRemove.forEach(date => {
        const current = next[date]
        if (!current) return

        const updated = {
          ...current,
          [meal]: false
        }

        if (updated.obed || updated.vecera) {
          next[date] = updated
        } else {
          delete next[date]
        }
      })

      setCalendarClaims(next)
      setBulkEntitlementClaims(prev => ({
        ...prev,
        [meal]: []
      }))
    }
  }

  const updateBulkRegistrationEntitlementsForm = (key: string, value: any) => {
    setBulkRegistrationEntitlementsForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const updateRegistrationAssignmentForm = (key: string, value: any) => {
    setRegistrationAssignmentForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const toggleRegistrationAssignmentPerson = (userId: string) => {
    setRegistrationAssignmentForm(prev => ({
      ...prev,
      userIds: prev.userIds.includes(userId)
        ? prev.userIds.filter(id => id !== userId)
        : [...prev.userIds, userId]
    }))
  }

  const clearRegistrationAssignmentPeople = () => {
    setRegistrationAssignmentForm(prev => ({
      ...prev,
      userIds: []
    }))
  }

  const postDetailAction = async (url: string, payload: any, fallbackMessage: string) => {
    setDetailMessage('')
    setDetailMessageType('')

    if (!selectedPerson) return

    if (!canManage) {
      setDetailMessage('Nemáš oprávnenie upravovať osoby.')
      setDetailMessageType('error')
      return
    }

    setDetailLoading(true)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setDetailMessage('Server vrátil neplatnú odpoveď.')
        setDetailMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setDetailMessage(json.error || fallbackMessage)
        setDetailMessageType('error')
        return
      }

      setDetailMessage(json.message || 'Zmena bola uložená.')
      setDetailMessageType('ok')

      setTimeout(() => {
        router.refresh()
      }, 450)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDetailMessage('Chyba spojenia so serverom: ' + message)
      setDetailMessageType('error')
    } finally {
      setDetailLoading(false)
    }
  }

  const saveProfile = () => {
    if (!selectedPerson) return

    postDetailAction(
      '/api/personalista/people/update-profile',
      {
        userId: selectedPerson.id,
        ...profileForm
      },
      'Detail osoby sa nepodarilo uložiť.'
    )
  }

  const approveRegistration = () => {
    if (!selectedPerson) return

    if (!profileForm.registrationGroupId) {
      setDetailMessage('Vyber registracnu skupinu.')
      setDetailMessageType('error')
      return
    }

    const ok = window.confirm('Schvalit registraciu a priradit prvy volny QR kod?')
    if (!ok) return

    postDetailAction(
      '/api/personalista/people/approve-registration',
      {
        userId: selectedPerson.id,
        registrationGroupId: profileForm.registrationGroupId,
        registrationGroupNote: profileForm.registrationGroupNote
      },
      'Registraciu sa nepodarilo schvalit.'
    )
  }

  const createRegistrationGroup = async () => {
    const name = registrationGroupName.trim()

    if (!name) {
      setRegistrationGroupMessage('Zadaj nazov registracnej skupiny.')
      setRegistrationGroupMessageType('error')
      return
    }

    setRegistrationGroupLoading(true)
    setRegistrationGroupMessage('')
    setRegistrationGroupMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setRegistrationGroupMessage(json.error || 'Registracnu skupinu sa nepodarilo vytvorit.')
        setRegistrationGroupMessageType('error')
        return
      }

      setRegistrationGroupName('')
      setRegistrationGroupMessage(json.message || 'Registracna skupina bola vytvorena.')
      setRegistrationGroupMessageType('ok')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRegistrationGroupMessage('Chyba spojenia so serverom: ' + message)
      setRegistrationGroupMessageType('error')
    } finally {
      setRegistrationGroupLoading(false)
    }
  }

  const saveBulkRegistrationEntitlements = async () => {
    if (!bulkRegistrationEntitlementsForm.registrationGroupId) {
      setBulkRegistrationEntitlementsMessage('Vyber registracnu skupinu.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    if (!bulkRegistrationEntitlementsForm.validFrom || !bulkRegistrationEntitlementsForm.validTo) {
      setBulkRegistrationEntitlementsMessage('Vyber obdobie.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    if (bulkRegistrationEntitlementsForm.validTo < bulkRegistrationEntitlementsForm.validFrom) {
      setBulkRegistrationEntitlementsMessage('Datum do nemoze byt pred datumom od.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    if (!bulkRegistrationEntitlementsForm.obed && !bulkRegistrationEntitlementsForm.vecera) {
      setBulkRegistrationEntitlementsMessage('Vyber obed alebo veceru.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    const groupName = selectedBulkRegistrationGroup?.name || 'vybrana registracna skupina'
    const ok = window.confirm(
      `Prepise sa obdobie ${bulkRegistrationEntitlementsForm.validFrom} - ${bulkRegistrationEntitlementsForm.validTo} pre ${selectedBulkRegistrationGroupPeopleCount} osob v registracnej skupine ${groupName}. Pokracovat?`
    )

    if (!ok) return

    setBulkRegistrationEntitlementsLoading(true)
    setBulkRegistrationEntitlementsMessage('')
    setBulkRegistrationEntitlementsMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bulkRegistrationEntitlementsForm)
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setBulkRegistrationEntitlementsMessage(json.error || 'Hromadne naroky sa nepodarilo ulozit.')
        setBulkRegistrationEntitlementsMessageType('error')
        return
      }

      setBulkRegistrationEntitlementsMessage(json.message || 'Hromadne naroky boli ulozene.')
      setBulkRegistrationEntitlementsMessageType('ok')

      setTimeout(() => {
        router.refresh()
      }, 650)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBulkRegistrationEntitlementsMessage('Chyba spojenia so serverom: ' + message)
      setBulkRegistrationEntitlementsMessageType('error')
    } finally {
      setBulkRegistrationEntitlementsLoading(false)
    }
  }

  const saveRegistrationAssignment = async () => {
    if (!registrationAssignmentForm.registrationGroupId) {
      setRegistrationAssignmentMessage('Vyber registracnu skupinu.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    if (registrationAssignmentForm.userIds.length === 0) {
      setRegistrationAssignmentMessage('Vyber aspon jednu osobu.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    const groupName = selectedRegistrationAssignmentGroup?.name || 'vybrana registracna skupina'
    const ok = window.confirm(
      `Priradit ${registrationAssignmentForm.userIds.length} osob do registracnej skupiny ${groupName}? Povodna registracna skupina sa im prepise.`
    )

    if (!ok) return

    setRegistrationAssignmentLoading(true)
    setRegistrationAssignmentMessage('')
    setRegistrationAssignmentMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups/assign-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationAssignmentForm)
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setRegistrationAssignmentMessage(json.error || 'Priradenie do registracnej skupiny sa nepodarilo.')
        setRegistrationAssignmentMessageType('error')
        return
      }

      setRegistrationAssignmentMessage(json.message || 'Osoby boli priradene do registracnej skupiny.')
      setRegistrationAssignmentMessageType('ok')
      setRegistrationAssignmentForm(prev => ({
        ...prev,
        userIds: []
      }))

      setTimeout(() => {
        router.refresh()
      }, 650)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setRegistrationAssignmentMessage('Chyba spojenia so serverom: ' + message)
      setRegistrationAssignmentMessageType('error')
    } finally {
      setRegistrationAssignmentLoading(false)
    }
  }

  const toggleEntitlementClaim = (date: string, meal: 'obed' | 'vecera') => {
    setBulkEntitlementClaims(prev => ({
      ...prev,
      [meal]: prev[meal].filter(item => item !== date)
    }))

    setCalendarClaims(prev => {
      const current = prev[date] || { obed: false, vecera: false }
      const next = {
        ...current,
        [meal]: !current[meal]
      }

      if (!next.obed && !next.vecera) {
        const copy = { ...prev }
        delete copy[date]
        return copy
      }

      return {
        ...prev,
        [date]: next
      }
    })
  }

  const clearEntitlementCalendarSelection = () => {
    const visibleDates = new Set(entitlementCalendarDates)

    setBulkEntitlementClaims(prev => ({
      obed: prev.obed.filter(date => !visibleDates.has(date)),
      vecera: prev.vecera.filter(date => !visibleDates.has(date))
    }))

    setCalendarClaims(prev => {
      const next = { ...prev }

      entitlementCalendarDates.forEach(date => {
        delete next[date]
      })

      return next
    })
  }

  const restoreEntitlementCalendarSelection = () => {
    if (!selectedPerson) return

    const bounds = entitlementBounds(selectedPerson.entitlements, fromDate, toDate)

    setCalendarClaims(calendarClaimsFromEntitlements(selectedPerson.entitlements))
    setBulkEntitlementClaims({ obed: [], vecera: [] })
    setEntitlementForm({
      validFrom: bounds.validFrom,
      validTo: bounds.validTo,
      obed: false,
      vecera: false
    })
  }

  const saveSelectedEntitlementDates = () => {
    if (!selectedPerson) return

    const allowedDates = new Set(entitlementCalendarDates)
    const dayClaims = Object.entries(calendarClaims)
      .filter(([date]) => allowedDates.has(date))
      .map(([datum, claim]) => ({
        datum,
        obed: claim.obed,
        vecera: claim.vecera
      }))
      .filter(item => item.obed || item.vecera)
      .sort((a, b) => a.datum.localeCompare(b.datum))

    if (dayClaims.length === 0) {
      const ok = window.confirm('V období nie je vybraný žiadny nárok. Vymazať nároky v tomto období?')
      if (!ok) return

      postDetailAction(
        '/api/personalista/people/update-entitlements',
        {
          userId: selectedPerson.id,
          mode: 'CLEAR',
          validFrom: entitlementForm.validFrom,
          validTo: entitlementForm.validTo,
          obed: false,
          vecera: false
        },
        'Nároky sa nepodarilo vymazať.'
      )
      return
    }

    const today = isoDateOffset(0)
    const changesPastEntitlements = entitlementCalendarDates.some(date => {
      if (date >= today) return false

      const saved = entitlementByDate.get(date) || { obed: false, vecera: false }
      const claim = calendarClaims[date] || { obed: false, vecera: false }

      return claim.obed !== saved.obed || claim.vecera !== saved.vecera
    })

    if (changesPastEntitlements) {
      const ok = window.confirm('Pokúšaš sa uložiť nárok do minulosti. Naozaj chceš tieto nároky uložiť?')
      if (!ok) return
    }

    postDetailAction(
      '/api/personalista/people/update-entitlements',
      {
        userId: selectedPerson.id,
        mode: 'DATES',
        validFrom: entitlementForm.validFrom,
        validTo: entitlementForm.validTo,
        dayClaims
      },
      'Nároky podľa kalendára sa nepodarilo uložiť.'
    )
  }

  const updateGroupForm = (key: string, value: any) => {
    setGroupForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const postGroupAction = (payload: any, fallbackMessage: string) => {
    if (!selectedPerson) return

    postDetailAction(
      '/api/personalista/people/groups',
      {
        userId: selectedPerson.id,
        ...payload
      },
      fallbackMessage
    )
  }

  const addPersonGroup = () => {
    if (!safeDetailGroupId) {
      setDetailMessage('Vyber skupinu.')
      setDetailMessageType('error')
      return
    }

    postGroupAction(
      {
        action: 'ADD',
        groupId: safeDetailGroupId,
        role: groupForm.role
      },
      'Osobu sa nepodarilo pridať do skupiny.'
    )
  }

  const updatePersonGroupRole = (groupId: string, role: string) => {
    postGroupAction(
      {
        action: 'UPDATE_ROLE',
        groupId,
        role
      },
      'Rolu v skupine sa nepodarilo zmeniť.'
    )
  }

  const removePersonGroup = (groupId: string, groupName: string) => {
    const ok = window.confirm(`Odobrať osobu zo skupiny ${groupName}?`)
    if (!ok) return

    postGroupAction(
      {
        action: 'REMOVE',
        groupId
      },
      'Osobu sa nepodarilo odobrať zo skupiny.'
    )
  }

  const replaceQr = (mode: 'FREE' | 'SPECIFIC' | 'RESTORE') => {
    if (!selectedPerson) return

    if (mode === 'SPECIFIC' && !qrForm.qrCode.trim()) {
      setDetailMessage('Naskenuj alebo zadaj nový QR kód.')
      setDetailMessageType('error')
      return
    }

    const confirmText =
      mode === 'RESTORE'
        ? 'Obnoviť posledný rezervovaný databázový QR tejto osoby? Aktuálny QR sa deaktivuje.'
        : mode === 'FREE'
          ? 'Priradiť nový voľný QR z databázy? Aktuálny QR sa deaktivuje a databázový QR zostane pri osobe rezervovaný.'
          : selectedPerson.activeQrCount > 0
            ? 'Aktívny QR tejto osoby sa deaktivuje a nahradí načítaným QR. Ak bol pôvodný QR z databázy, zostane rezervovaný pre túto osobu. Pokračovať?'
            : 'Osobe sa priradí načítaný QR. Pokračovať?'

    const ok = window.confirm(confirmText)

    if (!ok) return

    postDetailAction(
      '/api/personalista/people/qr/replace',
      {
        userId: selectedPerson.id,
        mode,
        qrCode: mode === 'SPECIFIC' ? qrForm.qrCode : ''
      },
      'QR sa nepodarilo vymeniť.'
    )
  }

  const stopQrScanner = () => {
    qrScannerCancelledRef.current = true

    if (qrScannerLoopRef.current) {
      window.clearTimeout(qrScannerLoopRef.current)
      qrScannerLoopRef.current = null
    }

    qrScannerStreamRef.current?.getTracks().forEach(track => track.stop())
    qrScannerStreamRef.current = null
    qrScannerReaderRef.current = null

    if (qrScannerVideoRef.current) {
      qrScannerVideoRef.current.srcObject = null
    }

    setQrScannerReady(false)
    setQrScannerStatus('Kamera je vypnutá.')
  }

  const acceptScannedQr = (value: string) => {
    const cleanQr = value.trim()
    if (!cleanQr) return

    setQrForm({ qrCode: cleanQr })
    setQrScannerStatus('QR bol načítaný do poľa.')
    setDetailMessage('QR bol načítaný. Výmenu potvrď tlačidlom.')
    setDetailMessageType('ok')
    setQrScannerOpen(false)
    stopQrScanner()
  }

  const tryQrScannerZxing = () => {
    const video = qrScannerVideoRef.current
    if (!video || video.readyState < 2) return ''

    try {
      if (!qrScannerReaderRef.current) {
        qrScannerReaderRef.current = new BrowserQRCodeReader()
      }

      const result = qrScannerReaderRef.current.decode(video)
      return String(result?.getText?.() || '').trim()
    } catch {
      return ''
    }
  }

  const tryQrScannerPreprocessed = () => {
    const video = qrScannerVideoRef.current
    const canvas = qrScannerCanvasRef.current

    if (!video || !canvas || video.readyState < 2) return ''

    const image = makeCanvasImage(video, canvas)
    if (!image) return ''

    const processed = thresholdImage(image)
    const result = jsQR(processed, image.width, image.height, { inversionAttempts: 'attemptBoth' })

    return String(result?.data || '').trim()
  }

  const scanQrScannerFrame = () => {
    if (qrScannerCancelledRef.current || detailLoading) return

    qrScannerAttemptRef.current += 1

    const zxingValue = tryQrScannerZxing()
    if (zxingValue) {
      acceptScannedQr(zxingValue)
      return
    }

    if (qrScannerAttemptRef.current % 3 !== 0) return

    const processedValue = tryQrScannerPreprocessed()
    if (processedValue) {
      acceptScannedQr(processedValue)
    }
  }

  const scheduleQrScanner = () => {
    if (qrScannerCancelledRef.current) return

    qrScannerLoopRef.current = window.setTimeout(() => {
      scanQrScannerFrame()
      scheduleQrScanner()
    }, 80)
  }

  const startQrScanner = async () => {
    setQrScannerReady(false)
    setQrScannerStatus('Spúšťam kameru...')
    qrScannerCancelledRef.current = false

    try {
      if (!qrScannerVideoRef.current) {
        setQrScannerStatus('Video prvok nie je pripravený.')
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

      qrScannerStreamRef.current = stream
      qrScannerVideoRef.current.srcObject = stream
      await qrScannerVideoRef.current.play()

      qrScannerAttemptRef.current = 0
      setQrScannerReady(true)
      setQrScannerStatus('Kamera je zapnutá. Skenuj QR kód.')
      scheduleQrScanner()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Kameru sa nepodarilo zapnúť.'
      setQrScannerReady(false)
      setQrScannerStatus(text)
    }
  }

  useEffect(() => {
    if (!qrScannerOpen) {
      stopQrScanner()
      return
    }

    startQrScanner()

    return () => stopQrScanner()
  }, [qrScannerOpen])

  const updateStatus = (active: boolean) => {
    if (!selectedPerson) return

    const reason = active
      ? window.prompt('Poznamka k odblokovaniu:', 'Odblokovane personalistom.')
      : window.prompt('Dovod blokovania:', 'Blokovane personalistom.')

    if (reason === null) return

    const ok = window.confirm(
      active
        ? 'Odblokovat tuto osobu?'
        : 'Zablokovat tuto osobu? Blokovana osoba nebude moct pouzivat zakladne akcie.'
    )

    if (!ok) return

    postDetailAction(
      '/api/personalista/people/update-status',
      {
        userId: selectedPerson.id,
        active,
        reason
      },
      active ? 'Osobu sa nepodarilo odblokovat.' : 'Osobu sa nepodarilo zablokovat.'
    )
  }

  const resetUserForRegistration = () => {
    if (!selectedPerson) return

    const email = selectedPerson.email || ''
    const typedEmail = window.prompt(
      `Tato akcia odregistruje osobu a uvolni email pre novu registraciu.\n\nPre potvrdenie napis email osoby: ${email}`
    )

    if (typedEmail === null) return

    if (typedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      setDetailMessage('Email nesedi. Odregistrovanie nebolo spustene.')
      setDetailMessageType('error')
      return
    }

    const reason = window.prompt(
      'Dovod odregistrovania:',
      'Odregistrovanie pre novu registraciu.'
    )

    if (reason === null) return

    const ok = window.confirm(
      'Naozaj odregistrovat tuto osobu? Email sa uvolni pre novu registraciu, stare historicke zaznamy ostanu v audite.'
    )

    if (!ok) return

    postDetailAction(
      '/api/personalista/people/reset-registration',
      {
        userId: selectedPerson.id,
        reason
      },
      'Odregistrovanie sa nepodarilo.'
    )
  }

  const assignNfc = () => {
    if (!selectedPerson) return

    if (!nfcForm.tokenUid.trim()) {
      setDetailMessage('Naskenuj alebo zadaj NFC kód.')
      setDetailMessageType('error')
      return
    }

    postDetailAction(
      '/api/personalista/people/nfc',
      {
        userId: selectedPerson.id,
        action: 'ASSIGN',
        tokenUid: nfcForm.tokenUid
      },
      'NFC sa nepodarilo priradiť.'
    )
  }

  const invalidateNfc = () => {
    if (!selectedPerson) return

    const ok = window.confirm('Zneplatniť aktívne NFC tejto osoby?')
    if (!ok) return

    postDetailAction(
      '/api/personalista/people/nfc',
      {
        userId: selectedPerson.id,
        action: 'INVALIDATE'
      },
      'NFC sa nepodarilo zneplatniť.'
    )
  }

  const saveGlobalRoles = () => {
    if (!selectedPerson) return

    const roles = [
      ...(canAssignSensitiveRoles && roleForm.admin ? ['ADMIN'] : []),
      ...(roleForm.personalista ? ['PERSONALISTA'] : []),
      ...(roleForm.adminVydaj ? ['ADMIN_VYDAJ'] : []),
      ...(roleForm.vydaj ? ['VYDAJ'] : []),
      ...(roleForm.groupCreator ? ['GROUP_CREATOR'] : [])
    ]

    postDetailAction(
      '/api/personalista/people/roles',
      {
        userId: selectedPerson.id,
        roles
      },
      'Globálne role sa nepodarilo uložiť.'
    )
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Prehľad / Personalista</div>
          <h1 style={styles.title}>Personalista</h1>
          <p style={styles.subtitle}>
            Ľudia, skupiny, QR stav a nároky na stravu.
          </p>
        </div>

        <div style={styles.headerActions}>
          <a href="/dashboard/groups" style={styles.lightButton}>
            Skupiny
          </a>

          <a href="/dashboard" style={styles.darkButton}>
            Späť na prehľad
          </a>
        </div>
      </header>

      {!canManage && (
        <section style={styles.warningBox}>
          Na túto obrazovku potrebuješ rolu ADMIN alebo PERSONALISTA.
        </section>
      )}

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <b>{people.length}</b>
          <span>Ľudí</span>
        </div>

        <div style={styles.summaryCardRed}>
          <b>{stats.blocked}</b>
          <span>Blokovaní</span>
        </div>

        <div style={styles.summaryCardYellow}>
          <b>{stats.pendingReview}</b>
          <span>Na schvalenie</span>
        </div>

        <div style={styles.summaryCardBlue}>
          <b>{groups.length}</b>
          <span>Skupín</span>
        </div>

        <div style={styles.summaryCardGreen}>
          <b>{stats.activeQr}</b>
          <span>Aktívny QR</span>
        </div>

        <div style={styles.summaryCardOrange}>
          <b>{stats.totalClaims}</b>
          <span>Aktuálne nároky</span>
          <small>{stats.totalLunches} obed / {stats.totalDinners} večera / {stats.totalDays} dní</small>
        </div>

        <div style={styles.summaryCardPink}>
          <b>{stats.withDiet}</b>
          <span>DIÉTA</span>
        </div>
      </section>

      <section style={styles.actionPanel}>
        <button
          type="button"
          style={{
            ...styles.primaryAction,
            opacity: canManage ? 1 : 0.55,
            cursor: canManage ? 'pointer' : 'not-allowed'
          }}
          disabled={!canManage}
          onClick={() => {
            setCreateOpen(prev => !prev)
            setCreateMessage('')
            setCreateMessageType('')
          }}
        >
          Ručne pridať človeka
        </button>

        <a
          href="/dashboard/personalista/blank-qr"
          style={{
            ...styles.lightButton,
            textAlign: 'center'
          }}
        >
          Generovať prázdne QR
        </a>

        <a
          href="/dashboard/personalista/import"
          style={{
            ...styles.lightButton,
            textAlign: 'center'
          }}
        >
          Import Excel/CSV
        </a>

        <a
          href="/dashboard/personalista/google-sheets"
          style={{
            ...styles.lightButton,
            textAlign: 'center'
          }}
        >
          Google Sheets
        </a>

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            setRegistrationGroupsOpen(prev => !prev)
            setRegistrationGroupMessage('')
            setRegistrationGroupMessageType('')
          }}
        >
          Registracne skupiny
        </button>

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            setRegistrationAssignmentOpen(prev => !prev)
            setRegistrationAssignmentMessage('')
            setRegistrationAssignmentMessageType('')
          }}
        >
          Priradit reg. skupinu
        </button>

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            setBulkRegistrationEntitlementsOpen(prev => !prev)
            setBulkRegistrationEntitlementsMessage('')
            setBulkRegistrationEntitlementsMessageType('')
          }}
        >
          Naroky podla reg. skupiny
        </button>

        <button
          type="button"
          style={styles.lightButton}
          onClick={() => setStatusFilter('PENDING_REVIEW')}
        >
          Na schvalenie ({stats.pendingReview})
        </button>

        {printGroupHref ? (
          <a href={printGroupHref} style={styles.lightButton}>
            Tlač QR skupiny
          </a>
        ) : (
          <button type="button" style={styles.actionButton} disabled>
            Tlač QR skupiny
          </button>
        )}

        <button type="button" style={styles.actionButton} disabled>
          QR/NFC párovanie
        </button>
      </section>

      {registrationGroupsOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Registracne skupiny</b>
              <span>Samostatny administrativny zoznam pre registracie a reporty.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={registrationGroupLoading}
              onClick={() => setRegistrationGroupsOpen(false)}
            >
              x
            </button>
          </div>

          <div style={styles.registrationGroupList}>
            {registrationGroups.length === 0 ? (
              <span style={styles.emptyGroupSelection}>Zatial bez registracnych skupin</span>
            ) : (
              registrationGroups.map(group => (
                <span key={group.id} style={styles.selectedGroupPill}>
                  {group.name}
                </span>
              ))
            )}
          </div>

          <div style={styles.groupSelectRow}>
            <input
              value={registrationGroupName}
              onChange={event => setRegistrationGroupName(event.target.value)}
              style={styles.input}
              placeholder="Nazov novej registracnej skupiny"
              disabled={registrationGroupLoading}
            />
            <button
              type="button"
              style={styles.confirmButton}
              disabled={registrationGroupLoading}
              onClick={createRegistrationGroup}
            >
              {registrationGroupLoading ? 'Ukladam...' : 'Pridat'}
            </button>
          </div>

          {registrationGroupMessage && (
            <div
              style={{
                ...styles.message,
                background: registrationGroupMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: registrationGroupMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: registrationGroupMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {registrationGroupMessage}
            </div>
          )}
        </section>
      )}

      {registrationAssignmentOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Manualne priradenie do registracnej skupiny</b>
              <span>Vybranym osobam sa prepise registracna skupina a ulozi sa audit.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={registrationAssignmentLoading}
              onClick={() => setRegistrationAssignmentOpen(false)}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={registrationAssignmentForm.registrationGroupId}
                onChange={event => updateRegistrationAssignmentForm('registrationGroupId', event.target.value)}
                style={styles.input}
                disabled={registrationAssignmentLoading}
              >
                <option value="">Vyber registracnu skupinu</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.field}>
              <span>Poznamka</span>
              <input
                value={registrationAssignmentForm.registrationGroupNote}
                onChange={event => updateRegistrationAssignmentForm('registrationGroupNote', event.target.value)}
                style={styles.input}
                placeholder="Volitelne"
                disabled={registrationAssignmentLoading}
              />
            </label>
          </div>

          <div style={styles.optionBox}>
            <div style={styles.optionTitle}>
              Vybrane osoby ({registrationAssignmentForm.userIds.length})
            </div>

            {selectedRegistrationAssignmentPeople.length === 0 ? (
              <span style={styles.emptyGroupSelection}>Zatial nikto vybrany</span>
            ) : (
              <div style={styles.selectedGroupList}>
                {selectedRegistrationAssignmentPeople.map(person => (
                  <span key={person.id} style={styles.selectedGroupPill}>
                    {person.fullName || person.email || 'Bez mena'}
                    <button
                      type="button"
                      style={styles.removePillButton}
                      disabled={registrationAssignmentLoading}
                      onClick={() => toggleRegistrationAssignmentPerson(person.id)}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}

            {registrationAssignmentForm.userIds.length > 0 && (
              <button
                type="button"
                style={styles.tinyTextButton}
                disabled={registrationAssignmentLoading}
                onClick={clearRegistrationAssignmentPeople}
              >
                Zrusit vyber
              </button>
            )}
          </div>

          <label style={styles.field}>
            <span>Hladat osobu</span>
            <input
              value={registrationAssignmentSearch}
              onChange={event => setRegistrationAssignmentSearch(event.target.value)}
              style={styles.input}
              placeholder="Meno, email alebo cast nazvu skupiny"
              disabled={registrationAssignmentLoading}
            />
          </label>

          <div style={styles.personCheckList}>
            {registrationAssignmentFilteredPeople.length === 0 ? (
              <span style={styles.emptyGroupSelection}>Nenasli sa ziadne osoby</span>
            ) : (
              registrationAssignmentFilteredPeople.map(person => (
                <label key={person.id} style={styles.personCheckRow}>
                  <input
                    type="checkbox"
                    checked={registrationAssignmentForm.userIds.includes(person.id)}
                    onChange={() => toggleRegistrationAssignmentPerson(person.id)}
                    disabled={registrationAssignmentLoading}
                    style={styles.checkbox}
                  />
                  <span style={styles.personCheckText}>
                    <b>{person.fullName || 'Bez mena'}</b>
                    <small>
                      {person.email || 'bez emailu'} - {person.registrationGroupName || 'bez reg. skupiny'}
                    </small>
                  </span>
                </label>
              ))
            )}
          </div>

          <button
            type="button"
            style={styles.confirmButton}
            disabled={registrationAssignmentLoading}
            onClick={saveRegistrationAssignment}
          >
            {registrationAssignmentLoading ? 'Ukladam...' : 'Priradit vybranych'}
          </button>

          {registrationAssignmentMessage && (
            <div
              style={{
                ...styles.message,
                background: registrationAssignmentMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: registrationAssignmentMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: registrationAssignmentMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {registrationAssignmentMessage}
            </div>
          )}
        </section>
      )}

      {bulkRegistrationEntitlementsOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Hromadne naroky podla registracnej skupiny</b>
              <span>Vybrane obdobie sa prepise ludom v konkretnej registracnej skupine.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={bulkRegistrationEntitlementsLoading}
              onClick={() => setBulkRegistrationEntitlementsOpen(false)}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={bulkRegistrationEntitlementsForm.registrationGroupId}
                onChange={event => updateBulkRegistrationEntitlementsForm('registrationGroupId', event.target.value)}
                style={styles.input}
                disabled={bulkRegistrationEntitlementsLoading}
              >
                <option value="">Vyber registracnu skupinu</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.field}>
              <span>Od</span>
              <input
                type="date"
                value={bulkRegistrationEntitlementsForm.validFrom}
                onChange={event => updateBulkRegistrationEntitlementsForm('validFrom', event.target.value)}
                style={styles.input}
                disabled={bulkRegistrationEntitlementsLoading}
              />
            </label>

            <label style={styles.field}>
              <span>Do</span>
              <input
                type="date"
                value={bulkRegistrationEntitlementsForm.validTo}
                onChange={event => updateBulkRegistrationEntitlementsForm('validTo', event.target.value)}
                style={styles.input}
                disabled={bulkRegistrationEntitlementsLoading}
              />
            </label>
          </div>

          <div style={styles.createOptionsGrid}>
            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Strava</div>

              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={bulkRegistrationEntitlementsForm.obed}
                  onChange={event => updateBulkRegistrationEntitlementsForm('obed', event.target.checked)}
                  disabled={bulkRegistrationEntitlementsLoading}
                  style={styles.checkbox}
                />
                <span>Obed</span>
              </label>

              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={bulkRegistrationEntitlementsForm.vecera}
                  onChange={event => updateBulkRegistrationEntitlementsForm('vecera', event.target.checked)}
                  disabled={bulkRegistrationEntitlementsLoading}
                  style={styles.checkbox}
                />
                <span>Vecera</span>
              </label>
            </div>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Osoby</div>

              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={bulkRegistrationEntitlementsForm.activeOnly}
                  onChange={event => updateBulkRegistrationEntitlementsForm('activeOnly', event.target.checked)}
                  disabled={bulkRegistrationEntitlementsLoading}
                  style={styles.checkbox}
                />
                <span>Iba aktivne osoby</span>
              </label>

              <span style={styles.optionHint}>
                Vyber teraz obsahuje {selectedBulkRegistrationGroupPeopleCount} osob.
              </span>
            </div>
          </div>

          <button
            type="button"
            style={styles.confirmButton}
            disabled={bulkRegistrationEntitlementsLoading}
            onClick={saveBulkRegistrationEntitlements}
          >
            {bulkRegistrationEntitlementsLoading ? 'Ukladam...' : 'Pridelit naroky skupine'}
          </button>

          {bulkRegistrationEntitlementsMessage && (
            <div
              style={{
                ...styles.message,
                background: bulkRegistrationEntitlementsMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: bulkRegistrationEntitlementsMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: bulkRegistrationEntitlementsMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {bulkRegistrationEntitlementsMessage}
            </div>
          )}
        </section>
      )}

      {createOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Ručné vytvorenie osoby</b>
              <span>Email aj skupina sú voliteľné. Nárok sa vytvorí pre každý deň vo vybranom období.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={createLoading}
              onClick={() => {
                setCreateOpen(false)
                setCreateMessage('')
                setCreateMessageType('')
              }}
            >
              ×
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Meno</span>
              <input
                value={createForm.meno}
                onChange={event => updateCreateForm('meno', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
              />
            </label>

            <label style={styles.field}>
              <span>Priezvisko</span>
              <input
                value={createForm.priezvisko}
                onChange={event => updateCreateForm('priezvisko', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
              />
            </label>

            <label style={styles.field}>
              <span>Email</span>
              <input
                value={createForm.email}
                onChange={event => updateCreateForm('email', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
                inputMode="email"
              />
            </label>

            <label style={styles.field}>
              <span>Telefón</span>
              <input
                value={createForm.telefon}
                onChange={event => updateCreateForm('telefon', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
                inputMode="tel"
              />
            </label>

            <label style={styles.field}>
              <span>Typ stravy</span>
              <select
                value={createForm.typStravy}
                onChange={event => updateCreateForm('typStravy', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              >
                <option value="MASO">MASO</option>
                <option value="VEGE">VEGE</option>
                <option value="DIETA">DIÉTA</option>
              </select>
            </label>

            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={createForm.registrationGroupId}
                onChange={event => updateCreateForm('registrationGroupId', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              >
                <option value="">Bez registracnej skupiny</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={styles.field}>
              <span>Od</span>
              <input
                type="date"
                value={createForm.validFrom}
                onChange={event => updateCreateForm('validFrom', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              />
            </label>

            <label style={styles.field}>
              <span>Do</span>
              <input
                type="date"
                value={createForm.validTo}
                onChange={event => updateCreateForm('validTo', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              />
            </label>
          </div>

          <div style={styles.createOptionsGrid}>
            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Skupiny</div>
              <div style={styles.optionHint}>Ak neoznačíš skupinu, osoba vznikne bez skupiny.</div>

              <div style={styles.groupSelectRow}>
                <select
                  value={safeCreateGroupSelectId}
                  onChange={event => setCreateGroupSelectId(event.target.value)}
                  style={styles.input}
                  disabled={createLoading}
                >
                  <option value="">
                    {availableCreateGroups.length === 0 ? 'Žiadna ďalšia skupina' : 'Žiadna skupina'}
                  </option>

                  {availableCreateGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  style={styles.lightButton}
                  onClick={addCreateGroup}
                  disabled={createLoading || !safeCreateGroupSelectId}
                >
                  Pridať
                </button>
              </div>

              <div style={styles.selectedGroupList}>
                {selectedCreateGroups.length === 0 ? (
                  <span style={styles.emptyGroupSelection}>Bez skupiny</span>
                ) : (
                  selectedCreateGroups.map(group => (
                    <span key={group.id} style={styles.selectedGroupPill}>
                      {group.name}
                      <button
                        type="button"
                        style={styles.removePillButton}
                        onClick={() => removeCreateGroup(group.id)}
                        disabled={createLoading}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              {selectedCreateGroups.length > 0 && (
                <button
                  type="button"
                  style={styles.tinyTextButton}
                  onClick={clearCreateGroups}
                  disabled={createLoading}
                >
                  Vytvoriť bez skupiny
                </button>
              )}
            </div>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Nárok</div>

              <div style={styles.checkList}>
                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.obed}
                    onChange={event => updateCreateForm('obed', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Obed</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.vecera}
                    onChange={event => updateCreateForm('vecera', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Večera</span>
                </label>
              </div>
            </div>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Priraďovanie QR</div>
              <div style={styles.optionHint}>Použije sa voľný nepriradený QR z databázy.</div>

              <div style={styles.checkList}>
                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.assignQr}
                    onChange={event => updateCreateForm('assignQr', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Priradiť voľný QR</span>
                </label>
              </div>
            </div>
          </div>

          <div style={styles.createFooter}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={createLoading}
              onClick={resetCreateForm}
            >
              Vyčistiť
            </button>

            <button
              type="button"
              style={{
                ...styles.confirmButton,
                opacity: createLoading ? 0.6 : 1
              }}
              disabled={createLoading}
              onClick={createPerson}
            >
              {createLoading ? 'Ukladám...' : 'Vytvoriť osobu'}
            </button>
          </div>

          {createMessage && (
            <div
              style={{
                ...styles.message,
                background: createMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: createMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: createMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {createMessage}
            </div>
          )}
        </section>
      )}

      <section style={styles.layoutGrid}>
        <div style={styles.leftColumn}>
          <section style={styles.toolbar}>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Hľadať meno, email, telefón..."
              style={styles.searchInput}
              autoComplete="off"
            />

            <select
              value={groupFilter}
              onChange={event => setGroupFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky skupiny</option>
              <option value="UNGROUPED">Bez skupiny</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            <select
              value={foodFilter}
              onChange={event => setFoodFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetka strava</option>
              <option value="MASO">MASO</option>
              <option value="VEGE">VEGE</option>
              <option value="DIÉTA">DIÉTA</option>
              <option value="NEZADANÉ">NEZADANÉ</option>
            </select>

            <select
              value={qrFilter}
              onChange={event => setQrFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky QR</option>
              <option value="ACTIVE">Aktívny QR</option>
              <option value="MISSING">Bez QR</option>
            </select>

            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky stavy</option>
              <option value="ACTIVE">Aktívni</option>
              <option value="BLOCKED">Blokovaní</option>
              <option value="PENDING_REVIEW">Na schvalenie</option>
            </select>
          </section>

          <section style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <span>Osoba</span>
              <span>Stav</span>
              <span>Reg skupina</span>
              <span>Skupiny</span>
              <span>Strava</span>
              <span>QR</span>
              <span>Nároky</span>
            </div>

            {filteredPeople.length === 0 ? (
              <div style={styles.emptyState}>
                Nenašli sa žiadni ľudia.
              </div>
            ) : (
              pagedPeople.map(person => {
                const selected = selectedPerson?.id === person.id
                const blocked = String(person.aktivny || '').toUpperCase() !== 'ANO'
                const pendingReview = String(person.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'

                return (
                  <button
                    key={person.id}
                    type="button"
                    style={{
                      ...styles.personRow,
                      background: selected ? '#eff6ff' : blocked ? '#fef2f2' : pendingReview ? '#fffbeb' : '#fff',
                      borderColor: selected ? '#93c5fd' : blocked ? '#fecaca' : pendingReview ? '#fde68a' : '#e5e7eb'
                    }}
                    onClick={() => setSelectedPersonId(person.id)}
                  >
                    <div style={styles.personCell}>
                      <b>{person.fullName}</b>
                      <span>
                        {person.email || '-'}
                        {person.telefon ? ` · ${person.telefon}` : ''}
                      </span>
                    </div>

                    <div>
                      <span
                        style={{
                          ...styles.statusBadge,
                          background: blocked ? '#fee2e2' : pendingReview ? '#fef3c7' : '#dcfce7',
                          color: blocked ? '#991b1b' : pendingReview ? '#92400e' : '#166534'
                        }}
                      >
                        {blocked ? 'Blokovaný' : pendingReview ? 'Kontrola' : 'Aktívny'}
                      </span>
                    </div>

                    <div style={styles.groupBadges}>
                      {person.registrationGroupName ? (
                        <span style={styles.registrationGroupBadge}>
                          {person.registrationGroupName}
                        </span>
                      ) : (
                        <span style={styles.groupBadge}>-</span>
                      )}
                    </div>

                    <div style={styles.groupBadges}>
                      {person.groups.length === 0 && (
                        <span style={styles.groupBadge}>
                          Bez skupiny
                        </span>
                      )}

                      {person.groups.slice(0, 3).map(group => (
                        <span key={`${person.id}-${group.id}`} style={styles.groupBadge}>
                          {group.name}
                        </span>
                      ))}

                      {person.groups.length > 3 && (
                        <span style={styles.moreBadge}>+{person.groups.length - 3}</span>
                      )}
                    </div>

                    <div>
                      <span style={styles.foodBadge}>
                        {foodLabel(person.typStravy)}
                      </span>
                    </div>

                    <div>
                      <span
                        style={{
                          ...styles.qrBadge,
                          background: person.activeQrCount > 0 ? '#dcfce7' : '#fee2e2',
                          color: person.activeQrCount > 0 ? '#166534' : '#991b1b'
                        }}
                      >
                        {person.activeQrCount > 0 ? 'AKTÍVNY' : 'CHÝBA'}
                      </span>
                    </div>

                    <div style={styles.claimCell}>
                      <b>{person.mealClaims}</b>
                      <span>{person.lunchClaims} O / {person.dinnerClaims} V</span>
                      <span>{person.entitlementDays} dní</span>
                    </div>
                  </button>
                )
              })
            )}

            {filteredPeople.length > 0 && (
              <div style={styles.paginationBar}>
                <span>
                  {pageStart + 1}-{pageEnd} z {filteredPeople.length}
                </span>

                <select
                  value={pageSize}
                  onChange={event => setPageSize(Number(event.target.value))}
                  style={styles.pageSizeSelect}
                >
                  <option value={50}>50 / strana</option>
                  <option value={100}>100 / strana</option>
                  <option value={200}>200 / strana</option>
                </select>

                <button
                  type="button"
                  style={styles.pageButton}
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                >
                  Spat
                </button>

                <b>{safeCurrentPage} / {pageCount}</b>

                <button
                  type="button"
                  style={styles.pageButton}
                  disabled={safeCurrentPage >= pageCount}
                  onClick={() => setCurrentPage(prev => Math.min(pageCount, prev + 1))}
                >
                  Dalej
                </button>
              </div>
            )}
          </section>
        </div>

        <aside style={styles.detailPanel}>
          {selectedPerson ? (
            <>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.detailSmall}>Detail osoby</div>
                  <h2 style={styles.detailTitle}>{selectedPerson.fullName}</h2>
                </div>

                <div style={styles.detailHeaderBadges}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background: String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? '#fee2e2' : '#dcfce7',
                      color: String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? '#991b1b' : '#166534'
                    }}
                  >
                    {String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? 'Blokovaný' : 'Aktívny'}
                  </span>

                  <span style={styles.foodBadge}>
                    {foodLabel(selectedPerson.typStravy)}
                  </span>

                  {String(selectedPerson.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW' && (
                    <span style={styles.pendingBadge}>Na schvalenie</span>
                  )}

                  {selectedPerson.globalRoles.map(role => (
                    <span key={role} style={styles.globalRoleBadge}>
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              <div style={styles.detailRows}>
                <div style={styles.detailRow}>
                  <span>Stav</span>
                  <b>{String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? 'Blokovaný' : 'Aktívny'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Email</span>
                  <b>{selectedPerson.email || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Telefón</span>
                  <b>{selectedPerson.telefon || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Registracna skupina</span>
                  <b>{selectedPerson.registrationGroupName || '-'}</b>
                  {selectedPerson.registrationGroupNote && <small>{selectedPerson.registrationGroupNote}</small>}
                </div>

                <div style={styles.detailRow}>
                  <span>QR</span>
                  <b>{selectedPerson.activeQrCount > 0 ? 'Aktívny' : 'Chýba'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>NFC</span>
                  <b>{selectedPerson.activeNfcCount > 0 ? 'Aktívny' : 'Chýba'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Nároky</span>
                  <b>{selectedPerson.mealClaims} jedál / {selectedPerson.entitlementDays} dní</b>
                  <small>{selectedPerson.lunchClaims} obed / {selectedPerson.dinnerClaims} večera</small>
                </div>
              </div>

              <div style={styles.sectionTitle}>Skupiny</div>

              <div style={styles.detailGroups}>
                {selectedPerson.groups.length === 0 && (
                  <div style={styles.detailGroupRow}>
                    <b>Bez skupiny</b>
                    <span>-</span>
                  </div>
                )}

                {selectedPerson.groups.map(group => (
                  <div key={group.id} style={styles.detailGroupRow}>
                    <b>{group.name}</b>
                    <span>{group.role || 'MEMBER'}</span>
                  </div>
                ))}
              </div>

              <div style={styles.sectionTitle}>Všetky nároky</div>

              <div style={styles.entitlementList}>
                {selectedPerson.entitlements.length === 0 ? (
                  <span style={styles.emptyGroupSelection}>Bez nárokov</span>
                ) : (
                  selectedPerson.entitlements.map(item => (
                    <span key={item.datum} style={styles.entitlementPill}>
                      {item.datum}: {item.obed ? 'O' : '-'} / {item.vecera ? 'V' : '-'}
                    </span>
                  ))
                )}
              </div>

              <div style={styles.sectionTitle}>Akcie</div>

              {String(selectedPerson.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW' && (
                <div style={styles.pendingApprovalBox}>
                  <b>Registracia caka na kontrolu</b>
                  <span>Skontroluj profil, vyber registracnu skupinu a schval registraciu. QR sa prideli automaticky.</span>
                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading || !profileForm.registrationGroupId}
                    onClick={approveRegistration}
                  >
                    {detailLoading ? 'Schvalujem...' : 'Schvalit a priradit QR'}
                  </button>
                </div>
              )}

              <div style={styles.detailActions}>
                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    borderColor: detailMode === 'profile' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'profile' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'profile' ? '' : 'profile')}
                >
                  Detail a strava
                </button>

                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    borderColor: detailMode === 'entitlements' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'entitlements' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'entitlements' ? '' : 'entitlements')}
                >
                  Upraviť nároky
                </button>

                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    borderColor: detailMode === 'groups' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'groups' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'groups' ? '' : 'groups')}
                >
                  Upraviť skupiny
                </button>

                {canAssignSensitiveRoles && (
                  <button
                    type="button"
                    style={{
                      ...styles.actionButton,
                      borderColor: detailMode === 'roles' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'roles' ? '#eff6ff' : '#fff'
                    }}
                    disabled={detailLoading}
                    onClick={() => setDetailMode(detailMode === 'roles' ? '' : 'roles')}
                  >
                  Globálne role
                  </button>
                )}

                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    borderColor: detailMode === 'qr' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'qr' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'qr' ? '' : 'qr')}
                >
                  Vymeniť QR
                </button>

                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    borderColor: detailMode === 'nfc' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'nfc' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'nfc' ? '' : 'nfc')}
                >
                  Priradiť NFC
                </button>

                <button
                  type="button"
                  style={{
                    ...(String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO'
                      ? styles.confirmButton
                      : styles.dangerButton),
                    opacity: detailLoading ? 0.6 : 1
                  }}
                  disabled={detailLoading}
                  onClick={() => updateStatus(String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO')}
                >
                  {String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? 'Odblokovat' : 'Zablokovat'}
                </button>

                {canDeregisterUsers && (
                  <button
                    type="button"
                    style={{
                      ...styles.dangerButton,
                      opacity: detailLoading ? 0.6 : 1
                    }}
                    disabled={detailLoading}
                    onClick={resetUserForRegistration}
                  >
                    Odregistrovat pre novu registraciu
                  </button>
                )}

                {printPersonHref && (
                  <a
                    href={printPersonHref}
                    style={{
                      ...styles.lightButton,
                      textAlign: 'center'
                    }}
                  >
                    Tlačiť QR osoby
                  </a>
                )}
              </div>

              {detailMode === 'profile' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Detail osoby</div>

                  <div style={styles.detailEditGrid}>
                    <label style={styles.field}>
                      <span>Meno</span>
                      <input
                        value={profileForm.meno}
                        onChange={event => updateProfileForm('meno', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                        autoComplete="off"
                      />
                    </label>

                    <label style={styles.field}>
                      <span>Priezvisko</span>
                      <input
                        value={profileForm.priezvisko}
                        onChange={event => updateProfileForm('priezvisko', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                        autoComplete="off"
                      />
                    </label>

                    <label style={styles.fieldWarning}>
                      <span>Email</span>
                      <input
                        value={profileForm.email}
                        onChange={event => updateProfileForm('email', event.target.value)}
                        style={styles.inputWarning}
                        disabled={detailLoading}
                        autoComplete="off"
                        inputMode="email"
                      />
                    </label>

                    <label style={styles.field}>
                      <span>Telefón</span>
                      <input
                        value={profileForm.telefon}
                        onChange={event => updateProfileForm('telefon', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                        autoComplete="off"
                        inputMode="tel"
                      />
                    </label>

                    <label style={styles.field}>
                      <span>Typ stravy</span>
                      <select
                        value={profileForm.typStravy || 'MASO'}
                        onChange={event => updateProfileForm('typStravy', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      >
                        <option value="MASO">MASO</option>
                        <option value="VEGE">VEGE</option>
                        <option value="DIETA">DIÉTA</option>
                      </select>
                    </label>

                    <label style={styles.field}>
                      <span>Registracna skupina</span>
                      <select
                        value={profileForm.registrationGroupId}
                        onChange={event => updateProfileForm('registrationGroupId', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      >
                        <option value="">Vyber registracnu skupinu</option>
                        {registrationGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={styles.field}>
                      <span>Poznamka k registracnej skupine</span>
                      <input
                        value={profileForm.registrationGroupNote}
                        onChange={event => updateProfileForm('registrationGroupNote', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading}
                    onClick={saveProfile}
                  >
                    {detailLoading ? 'Ukladám...' : 'Uložiť detail'}
                  </button>
                </div>
              )}

              {detailMode === 'entitlements' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Nároky na stravu</div>

                  <div style={styles.detailEditGrid}>
                    <label style={styles.field}>
                      <span>Od</span>
                      <input
                        type="date"
                        value={entitlementForm.validFrom}
                        onChange={event => updateEntitlementForm('validFrom', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      />
                    </label>

                    <label style={styles.field}>
                      <span>Do</span>
                      <input
                        type="date"
                        value={entitlementForm.validTo}
                        onChange={event => updateEntitlementForm('validTo', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      />
                    </label>
                  </div>

                  <div style={styles.checkList}>
                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={entitlementForm.obed}
                        onChange={event => updateEntitlementForm('obed', event.target.checked)}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Obed</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={entitlementForm.vecera}
                        onChange={event => updateEntitlementForm('vecera', event.target.checked)}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Večera</span>
                    </label>
                  </div>

                  <div style={styles.calendarToolbar}>
                    <button
                      type="button"
                      style={styles.lightButton}
                      disabled={detailLoading}
                      onClick={clearEntitlementCalendarSelection}
                    >
                      Zrušiť výber dní
                    </button>

                    <button
                      type="button"
                      style={styles.lightButton}
                      disabled={detailLoading}
                      onClick={restoreEntitlementCalendarSelection}
                    >
                      Obnoviť aktuálne nároky
                    </button>
                  </div>

                  <div style={styles.entitlementCalendar}>
                    {entitlementCalendarDates.length === 0 ? (
                      <span style={styles.emptyGroupSelection}>Vyber platné obdobie</span>
                    ) : (
                      entitlementCalendarDates.map(date => {
                        const saved = entitlementByDate.get(date)
                        const claim = calendarClaims[date] || { obed: false, vecera: false }
                        const selected = claim.obed || claim.vecera
                        const changed = saved
                          ? claim.obed !== saved.obed || claim.vecera !== saved.vecera
                          : selected

                        return (
                          <div
                            key={date}
                            style={{
                              ...styles.calendarDay,
                              ...(saved ? styles.calendarDaySaved : {}),
                              ...(selected ? styles.calendarDaySelected : {}),
                              ...(changed ? styles.calendarDayChanged : {})
                            }}
                          >
                            <b>{shortDateLabel(date)}</b>
                            <div style={styles.calendarMealButtons}>
                              <button
                                type="button"
                                style={{
                                  ...styles.calendarMealButton,
                                  ...(claim.obed ? styles.calendarMealButtonActive : {})
                                }}
                                disabled={detailLoading}
                                onClick={() => toggleEntitlementClaim(date, 'obed')}
                              >
                                O
                              </button>

                              <button
                                type="button"
                                style={{
                                  ...styles.calendarMealButton,
                                  ...(claim.vecera ? styles.calendarMealButtonActive : {})
                                }}
                                disabled={detailLoading}
                                onClick={() => toggleEntitlementClaim(date, 'vecera')}
                              >
                                V
                              </button>
                            </div>
                            {saved && (
                              <span style={styles.calendarSavedText}>
                                {saved.obed ? 'O' : '-'} / {saved.vecera ? 'V' : '-'}
                              </span>
                            )}
                            {changed && (
                              <span style={styles.calendarChangedText}>
                                Zmena
                              </span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading}
                    onClick={saveSelectedEntitlementDates}
                  >
                    {detailLoading ? 'Ukladám...' : 'Uložiť nároky'}
                  </button>
                </div>
              )}

              {detailMode === 'groups' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Skupiny osoby</div>

                  <div style={styles.detailGroups}>
                    {selectedPerson.groups.length === 0 && (
                      <div style={styles.detailGroupRow}>
                        <b>Bez skupiny</b>
                        <span>-</span>
                      </div>
                    )}

                    {selectedPerson.groups.map(group => (
                      <div key={group.id} style={styles.detailGroupManageRow}>
                        <b>{group.name}</b>

                        <select
                          value={group.role || 'MEMBER'}
                          onChange={event => updatePersonGroupRole(group.id, event.target.value)}
                          style={styles.compactSelect}
                          disabled={detailLoading}
                        >
                          {groupRoleOptions.map(role => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          style={styles.dangerTinyButton}
                          disabled={detailLoading}
                          onClick={() => removePersonGroup(group.id, group.name)}
                        >
                          Odobrať
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={styles.detailEditGrid}>
                    <label style={styles.field}>
                      <span>Pridať do skupiny</span>
                      <select
                        value={safeDetailGroupId}
                        onChange={event => updateGroupForm('groupId', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      >
                        <option value="">
                          {availableDetailGroups.length === 0 ? 'Žiadna ďalšia skupina' : 'Vyber skupinu'}
                        </option>

                        {availableDetailGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={styles.field}>
                      <span>Rola</span>
                      <select
                        value={groupForm.role}
                        onChange={event => updateGroupForm('role', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                      >
                        {groupRoleOptions.map(role => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading || !safeDetailGroupId}
                    onClick={addPersonGroup}
                  >
                    Pridať do skupiny
                  </button>
                </div>
              )}

              {detailMode === 'roles' && canAssignSensitiveRoles && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Globálne role</div>

                  <div style={styles.checkList}>
                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.admin}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          admin: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>ADMIN</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.personalista}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          personalista: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>PERSONALISTA</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.adminVydaj}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          adminVydaj: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>ADMIN_VYDAJ</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.vydaj}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          vydaj: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>VYDAJ</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.groupCreator}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          groupCreator: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Moze vytvarat skupiny</span>
                    </label>
                  </div>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading}
                    onClick={saveGlobalRoles}
                  >
                    {detailLoading ? 'Ukladám...' : 'Uložiť globálne role'}
                  </button>
                </div>
              )}

              {detailMode === 'qr' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>QR zo zoznamu</div>
                  <div style={styles.optionHint}>
                    Databázové QR zostáva po prepnutí na náramok rezervované pre tú istú osobu.
                  </div>

                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={detailLoading}
                    onClick={() => replaceQr('FREE')}
                  >
                    Priradiť nový voľný QR z databázy
                  </button>

                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={detailLoading}
                    onClick={() => replaceQr('RESTORE')}
                  >
                    Obnoviť pôvodný databázový QR
                  </button>

                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={detailLoading}
                    onClick={() => setQrScannerOpen(true)}
                  >
                    Spustiť scanner QR
                  </button>

                  <label style={styles.field}>
                    <span>Nový QR z náramku alebo zo zoznamu</span>
                    <input
                      value={qrForm.qrCode}
                      onChange={event => setQrForm({ qrCode: event.target.value })}
                      style={styles.input}
                      disabled={detailLoading}
                      autoComplete="off"
                      placeholder="Naskenuj nový QR"
                    />
                  </label>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading}
                    onClick={() => replaceQr('SPECIFIC')}
                  >
                    {detailLoading ? 'Ukladám...' : 'Prepnúť na načítaný QR'}
                  </button>
                </div>
              )}

              {detailMode === 'nfc' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>NFC kód</div>

                  <label style={styles.field}>
                    <span>Načítaný NFC kód</span>
                    <input
                      value={nfcForm.tokenUid}
                      onChange={event => setNfcForm({ tokenUid: event.target.value })}
                      style={styles.input}
                      disabled={detailLoading}
                      autoComplete="off"
                      placeholder="Prilož náramok alebo zadaj kód"
                    />
                  </label>

                  <button
                    type="button"
                    style={styles.confirmButton}
                    disabled={detailLoading}
                    onClick={assignNfc}
                  >
                    {detailLoading ? 'Ukladám...' : 'Priradiť NFC'}
                  </button>

                  <button
                    type="button"
                    style={styles.dangerButton}
                    disabled={detailLoading || selectedPerson.activeNfcCount === 0}
                    onClick={invalidateNfc}
                  >
                    Zneplatniť aktívne NFC
                  </button>
                </div>
              )}

              {detailMessage && (
                <div
                  style={{
                    ...styles.message,
                    background: detailMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                    color: detailMessageType === 'ok' ? '#166534' : '#991b1b',
                    borderColor: detailMessageType === 'ok' ? '#86efac' : '#fecaca'
                  }}
                >
                  {detailMessage}
                </div>
              )}
            </>
          ) : (
            <div style={styles.emptyState}>
              Vyber osobu zo zoznamu.
            </div>
          )}
        </aside>
      </section>

      {qrScannerOpen && (
        <div style={styles.qrScannerOverlay} onClick={() => setQrScannerOpen(false)}>
          <div style={styles.qrScannerModal} onClick={event => event.stopPropagation()}>
            <div style={styles.qrScannerHeader}>
              <div>
                <b>Načítať nový QR</b>
                <span>Skenuj QR kód z náramku alebo zo zoznamu.</span>
              </div>

              <button
                type="button"
                onClick={() => setQrScannerOpen(false)}
                style={styles.qrScannerCloseButton}
                disabled={detailLoading}
              >
                ×
              </button>
            </div>

            <div style={styles.qrScannerCameraBox}>
              <video
                ref={qrScannerVideoRef}
                style={styles.qrScannerVideo}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={qrScannerCanvasRef} style={styles.hiddenCanvas} />

              <div
                style={{
                  ...styles.qrScannerFrame,
                  borderColor: qrScannerReady ? '#22c55e' : '#f97316'
                }}
              />

              {!qrScannerReady && (
                <div style={styles.qrScannerCameraOverlay}>
                  {qrScannerStatus}
                </div>
              )}
            </div>

            <div
              style={{
                ...styles.qrScannerStatus,
                color: qrScannerReady ? '#166534' : '#9a3412'
              }}
            >
              {qrScannerStatus}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: 13,
    color: '#111827'
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
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
    fontSize: 26,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  warningBox: {
    background: '#ffedd5',
    color: '#9a3412',
    border: '1px solid #fdba74',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardBlue: {
    background: '#eff6ff',
    border: '1px solid #93c5fd',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#1d4ed8',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardGreen: {
    background: '#ecfdf5',
    border: '1px solid #86efac',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#166534',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardRed: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#991b1b',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardYellow: {
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#92400e',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardOrange: {
    background: '#fff7ed',
    border: '1px solid #fdba74',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#9a3412',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardPink: {
    background: '#fdf2f8',
    border: '1px solid #f9a8d4',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#9d174d',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  actionPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  layoutGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    gap: 12,
    alignItems: 'start'
  },
  leftColumn: {
    minWidth: 0,
    display: 'grid',
    gap: 10
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 16,
    fontWeight: 800,
    outline: 'none',
    background: '#fff',
    color: '#111827'
  },
  select: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 16,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 1020,
    display: 'grid',
    gridTemplateColumns: 'minmax(190px, 1.25fr) 78px minmax(150px, 0.9fr) minmax(160px, 1fr) 78px 78px 82px',
    gap: 8,
    alignItems: 'center',
    padding: '8px 10px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  personRow: {
    width: '100%',
    minWidth: 1020,
    border: '0 solid #e5e7eb',
    borderBottomWidth: 1,
    padding: '7px 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(190px, 1.25fr) 78px minmax(150px, 0.9fr) minmax(160px, 1fr) 78px 78px 82px',
    gap: 8,
    alignItems: 'center',
    textAlign: 'left',
    color: '#111827',
    cursor: 'pointer',
    fontSize: 12
  },
  personCell: {
    minWidth: 0,
    display: 'grid',
    gap: 3
  },
  groupBadges: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5
  },
  groupBadge: {
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '4px 7px',
    background: '#f3f4f6',
    color: '#374151',
    fontSize: 10,
    fontWeight: 900
  },
  registrationGroupBadge: {
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '4px 7px',
    background: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fde68a',
    fontSize: 10,
    fontWeight: 900
  },
  moreBadge: {
    borderRadius: 999,
    padding: '4px 7px',
    background: '#111827',
    color: '#fff',
    fontSize: 10,
    fontWeight: 900
  },
  foodBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 950,
    background: '#eef2ff',
    color: '#3730a3',
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
  pendingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
    background: '#fef3c7',
    color: '#92400e'
  },
  qrBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  claimCell: {
    display: 'grid',
    gap: 2,
    fontSize: 10,
    fontWeight: 800,
    color: '#6b7280'
  },
  detailPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  detailSmall: {
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280'
  },
  detailTitle: {
    margin: '3px 0 0 0',
    fontSize: 20,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  detailRows: {
    display: 'grid',
    gap: 7
  },
  detailRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 3,
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  detailGroups: {
    display: 'grid',
    gap: 7
  },
  detailGroupRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center'
  },
  detailActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8
  },
  pendingApprovalBox: {
    border: '1px solid #fde68a',
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 8,
    background: '#fffbeb',
    color: '#92400e'
  },
  detailHeaderBadges: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  globalRoleBadge: {
    borderRadius: 999,
    padding: '5px 8px',
    background: '#111827',
    color: '#fff',
    fontSize: 11,
    fontWeight: 950
  },
  detailEditBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'grid',
    gap: 10,
    background: '#f9fafb'
  },
  detailEditTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  detailEditGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 8
  },
  primaryAction: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  createPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  createHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10
  },
  createGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 10
  },
  createOptionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 10
  },
  optionBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'grid',
    gap: 8,
    background: '#f9fafb'
  },
  optionTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  optionHint: {
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  groupSelectRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center'
  },
  detailGroupManageRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 120px auto',
    gap: 8,
    alignItems: 'center'
  },
  entitlementList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  entitlementPill: {
    borderRadius: 999,
    padding: '6px 9px',
    background: '#eef2ff',
    color: '#3730a3',
    fontSize: 11,
    fontWeight: 950
  },
  calendarToolbar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8
  },
  entitlementCalendar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 6
  },
  calendarDay: {
    minHeight: 70,
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    background: '#fff',
    color: '#374151',
    display: 'grid',
    gap: 5,
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 900,
    padding: 5
  },
  calendarDaySaved: {
    background: '#dcfce7',
    borderColor: '#86efac',
    color: '#166534'
  },
  calendarDaySelected: {
    background: '#ecfdf5',
    borderColor: '#111827',
    color: '#052e16',
    boxShadow: '0 0 0 2px #111827 inset'
  },
  calendarDayChanged: {
    background: '#fff7ed',
    borderColor: '#fb923c',
    color: '#7c2d12',
    boxShadow: '0 0 0 2px #fb923c inset'
  },
  calendarMealButtons: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    width: '100%'
  },
  calendarMealButton: {
    minHeight: 28,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  calendarMealButtonActive: {
    background: '#22c55e',
    borderColor: '#166534',
    color: '#052e16'
  },
  calendarSavedText: {
    fontSize: 10,
    fontWeight: 900,
    color: '#166534'
  },
  calendarChangedText: {
    fontSize: 10,
    fontWeight: 950,
    color: '#c2410c'
  },
  selectedGroupList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 30
  },
  registrationGroupList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  emptyGroupSelection: {
    borderRadius: 999,
    padding: '7px 10px',
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 900
  },
  selectedGroupPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    padding: '6px 7px 6px 10px',
    background: '#eff6ff',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
    fontSize: 12,
    fontWeight: 900
  },
  removePillButton: {
    width: 22,
    height: 22,
    borderRadius: 999,
    border: '1px solid #bfdbfe',
    background: '#fff',
    color: '#1d4ed8',
    fontSize: 15,
    fontWeight: 950,
    lineHeight: 1,
    cursor: 'pointer'
  },
  tinyTextButton: {
    justifySelf: 'start',
    border: 0,
    background: 'transparent',
    color: '#1d4ed8',
    padding: 0,
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  checkList: {
    display: 'grid',
    gap: 7,
    maxHeight: 170,
    overflow: 'auto'
  },
  personCheckList: {
    display: 'grid',
    gap: 7,
    maxHeight: 280,
    overflow: 'auto',
    padding: 6,
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    background: '#f9fafb'
  },
  checkRow: {
    display: 'grid',
    gridTemplateColumns: '22px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 850,
    color: '#111827'
  },
  personCheckRow: {
    display: 'grid',
    gridTemplateColumns: '22px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 9,
    background: '#fff',
    cursor: 'pointer'
  },
  personCheckText: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 900,
    color: '#111827',
    overflowWrap: 'anywhere'
  },
  checkbox: {
    width: 18,
    height: 18
  },
  createFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap'
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  fieldWarning: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#b91c1c'
  },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 16,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  inputWarning: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '2px solid #ef4444',
    borderRadius: 12,
    padding: '10px 9px',
    fontSize: 16,
    fontWeight: 900,
    background: '#fff7f7',
    color: '#991b1b',
    outline: 'none'
  },
  compactSelect: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '8px 7px',
    fontSize: 12,
    fontWeight: 900,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  closeButton: {
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
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  dangerButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  dangerTinyButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '8px 9px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  paginationBar: {
    minWidth: 1020,
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    background: '#f9fafb',
    borderTop: '1px solid #e5e7eb',
    fontSize: 12,
    fontWeight: 900,
    color: '#374151'
  },
  pageButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 10,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer'
  },
  pageSizeSelect: {
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '7px 8px',
    fontSize: 12,
    fontWeight: 900,
    background: '#fff',
    color: '#111827'
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  actionButton: {
    background: '#f3f4f6',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'not-allowed',
    opacity: 0.65
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  qrScannerOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  qrScannerModal: {
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
  qrScannerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  qrScannerCloseButton: {
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
  qrScannerCameraBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    background: '#111827',
    borderRadius: 16,
    overflow: 'hidden'
  },
  qrScannerVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  qrScannerFrame: {
    position: 'absolute',
    inset: 28,
    border: '4px solid',
    borderRadius: 18,
    pointerEvents: 'none',
    boxShadow: '0 0 0 999px rgba(0,0,0,0.22)'
  },
  qrScannerCameraOverlay: {
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
  qrScannerStatus: {
    fontSize: 12,
    fontWeight: 850
  },
  hiddenCanvas: {
    display: 'none'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  }
}
