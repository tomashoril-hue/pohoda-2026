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

type QrWristbandRuleRange = {
  id?: string
  typeCode: string
  seriesFrom: number
  seriesTo: number
  active: boolean
}

type QrWristbandRules = {
  enabled: boolean
  ranges: QrWristbandRuleRange[]
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
  cancelledReason?: string
  cancelledAt?: string
}

type PersonRegistrationGroupPeriod = {
  id: string
  registrationGroupId: string
  registrationGroupName: string
  validFrom: string
  validTo: string
  note: string
}

type RegistrationGroupAccess = {
  id: string
  registrationGroupId: string
  registrationGroupName: string
}

type RegistrationPeriodSelectionRow =
  | { type: 'period'; key: string; period: PersonRegistrationGroupPeriod }
  | { type: 'gap'; key: string; id: string; validFrom: string; validTo: string }

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
  accountType: string
  reviewStatus: string
  registrationGroupId: string
  registrationGroupName: string
  registrationGroupNote: string
  currentRegistrationGroupId?: string
  currentRegistrationGroupName?: string
  currentRegistrationGroupNote?: string
  registrationGroupPeriods: PersonRegistrationGroupPeriod[]
  managedRegistrationGroups: RegistrationGroupAccess[]
  delegatedRegistrationGroups: RegistrationGroupAccess[]
  lastEditedAt: string
  lastEditedById: string
  lastEditedByName: string
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

type DetailMode = 'profile' | 'registrationPeriods' | 'entitlements' | 'groups' | 'roles' | 'accessCode' | 'qr' | 'nfc' | ''
type DetailMessageType = 'ok' | 'error' | ''
type PeopleScope = 'mine' | 'all'
type PersonnelTool = 'communication' | 'accessCodes' | 'registrationGroupManagers' | ''
type CommunicationLanguage = 'SK' | 'EN'
type CreateAccountType = 'PERSON' | 'TECHNICAL'

type CommunicationSummary = {
  total: number
  withEmail: number
  welcomeSent: number
  welcomePending: number
  selfOrderingTotal: number
  selfOrderingWithEmail: number
  selfOrderingSent: number
  selfOrderingPending: number
  withAccessCode: number
  withQr: number
  group?: {
    id: string
    name: string
  }
}

type PersonnelMealStats = {
  total: number
  MASO: number
  VEGE: number
  DIETA: number
}

type PersonnelStats = {
  today: string
  activePeople: number
  activeQr: number
  withoutQr: number
  registrationGroups: number
  pendingReview: number
  blocked: number
  meals: {
    obed: PersonnelMealStats
    vecera: PersonnelMealStats
  }
}

type RegistrationGroupManagerPerson = {
  id: string
  userId: string
  fullName: string
  email: string
  telefon: string
  aktivny: string
  createdAt: string
}

type RegistrationGroupManagersOverviewGroup = {
  id: string
  name: string
  managers: RegistrationGroupManagerPerson[]
  managerCount: number
}

type ManagerOverviewMode = 'all' | 'withManagers' | 'withoutManagers'

const ACCESS_CODES_NOTES: Record<CommunicationLanguage, string> = {
  SK: 'Ahoj, v prilohe posielam prihlasovacie udaje jednotlivych uzivatelov. Dobre si ich uchovaj a poskytni ich svojim kolegom.',
  EN: 'Hello, I am sending login details for individual users in the attachment. Please keep them safe and share them with your colleagues.'
}

function foodLabel(value: string) {
  const normalized = String(value || '').toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIÉTA'

  return 'NEZADANÉ'
}

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isoDateAdd(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''

  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function sortRegistrationPeriods(periods: PersonRegistrationGroupPeriod[]) {
  return [...periods].sort((a, b) => {
    const fromCompare = a.validFrom.localeCompare(b.validFrom)
    if (fromCompare !== 0) return fromCompare

    return (a.validTo || '9999-12-31').localeCompare(b.validTo || '9999-12-31')
  })
}

function registrationPeriodCompactParts(period: PersonRegistrationGroupPeriod) {
  const from = period.validFrom ? fullDateLabel(period.validFrom) : ''
  const to = period.validTo ? fullDateLabel(period.validTo) : 'bez konca'

  return {
    name: period.registrationGroupName || '-',
    range: from ? `${from} - ${to}` : ''
  }
}

function findRegistrationPeriodGaps(periods: PersonRegistrationGroupPeriod[]) {
  const sorted = sortRegistrationPeriods(periods)
  const gaps: Array<{ id: string; validFrom: string; validTo: string }> = []

  for (let index = 0; index < sorted.length - 1; index++) {
    const current = sorted[index]
    const next = sorted[index + 1]

    if (!current.validTo) continue

    const gapFrom = isoDateAdd(current.validTo, 1)
    const gapTo = isoDateAdd(next.validFrom, -1)

    if (gapFrom && gapTo && gapFrom <= gapTo) {
      gaps.push({
        id: `gap-${gapFrom}-${gapTo}`,
        validFrom: gapFrom,
        validTo: gapTo
      })
    }
  }

  return gaps
}

function defaultRegistrationPeriodForm(person: PersonItem | null) {
  const gaps = findRegistrationPeriodGaps(person?.registrationGroupPeriods || [])
  const firstGap = gaps[0]

  if (firstGap) {
    return {
      periodId: '',
      registrationGroupId: person?.registrationGroupId || '',
      validFrom: firstGap.validFrom,
      validTo: firstGap.validTo,
      note: person?.registrationGroupNote || ''
    }
  }

  const periods = sortRegistrationPeriods(person?.registrationGroupPeriods || [])
  const latest = periods[periods.length - 1]
  const nextFrom = latest?.validTo ? isoDateAdd(latest.validTo, 1) : isoDateOffset(0)

  return {
    periodId: '',
    registrationGroupId: person?.registrationGroupId || '',
    validFrom: nextFrom || isoDateOffset(0),
    validTo: '',
    note: person?.registrationGroupNote || ''
  }
}

function registrationPeriodsOverlap(
  periods: PersonRegistrationGroupPeriod[],
  validFrom: string,
  validTo: string,
  excludePeriodId = ''
) {
  const end = validTo || '9999-12-31'

  return periods.some(period => {
    if (period.id === excludePeriodId) return false

    const periodEnd = period.validTo || '9999-12-31'

    return validFrom <= periodEnd && period.validFrom <= end
  })
}

function canAutoCloseOpenEndedRegistrationPeriod(
  periods: PersonRegistrationGroupPeriod[],
  validFrom: string,
  validTo: string,
  excludePeriodId = ''
) {
  if (excludePeriodId) return false

  const end = validTo || '9999-12-31'
  const overlaps = periods.filter(period => {
    const periodEnd = period.validTo || '9999-12-31'

    return validFrom <= periodEnd && period.validFrom <= end
  })

  return overlaps.length === 1 && !overlaps[0].validTo && overlaps[0].validFrom < validFrom
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

function boundedRegistrationPeriods(periods: PersonRegistrationGroupPeriod[]) {
  return sortRegistrationPeriods(periods).filter(period => !!period.validFrom && !!period.validTo && period.validTo >= period.validFrom)
}

function datesFromRegistrationPeriods(periods: PersonRegistrationGroupPeriod[]) {
  const dates = new Set<string>()

  boundedRegistrationPeriods(periods).forEach(period => {
    dateRangeIso(period.validFrom, period.validTo || '').forEach(date => dates.add(date))
  })

  return Array.from(dates).sort()
}

function dateIsInRegistrationPeriods(date: string, periods: PersonRegistrationGroupPeriod[]) {
  return boundedRegistrationPeriods(periods).some(period => date >= period.validFrom && date <= (period.validTo || period.validFrom))
}

function boundsFromDates(dates: string[], fallbackFrom: string, fallbackTo: string) {
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

function shortDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`)

  return date.toLocaleDateString('sk-SK', {
    day: '2-digit',
    month: '2-digit'
  })
}

function fullDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '-'

  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function entitlementCancelLabel(reason?: string) {
  const normalized = String(reason || '').toUpperCase()
  if (normalized === 'BLOCKED') return 'Zrušené blokáciou'
  if (normalized === 'DEREGISTERED') return 'Zrušené odregistráciou'
  return ''
}

function compactDateTimeLabel(value: string) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
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

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M20.2 6.8v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 11.8a7.2 7.2 0 1 0-2.1 5.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function PersonalistaClient({
  people: initialPeople,
  pendingReviewPeople: initialPendingReviewPeople,
  groups,
  registrationGroups,
  personnelStats,
  qrWristbandRules,
  fromDate,
  toDate,
  canManage,
  canAssignSensitiveRoles,
  canDeregisterUsers,
  canViewAllPeople,
  peopleScope,
  currentUserId,
  currentUserName,
  currentUserRoleLabel,
  legacyFoodGroupsEnabled
}: {
  people: PersonItem[]
  pendingReviewPeople: PersonItem[]
  groups: GroupItem[]
  registrationGroups: RegistrationGroupItem[]
  personnelStats: PersonnelStats
  qrWristbandRules: QrWristbandRules
  fromDate: string
  toDate: string
  canManage: boolean
  canAssignSensitiveRoles: boolean
  canDeregisterUsers: boolean
  canViewAllPeople: boolean
  peopleScope: PeopleScope
  currentUserId: string
  currentUserName: string
  currentUserRoleLabel: string
  legacyFoodGroupsEnabled: boolean
}) {
  const router = useRouter()
  const initialPeopleSearchMessage = peopleScope === 'all'
    ? 'Vsetky posledne upravovane osoby'
    : 'Moje posledne upravovane osoby'
  const qrScannerVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrScannerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const qrScannerStreamRef = useRef<MediaStream | null>(null)
  const qrScannerLoopRef = useRef<number | null>(null)
  const qrScannerReaderRef = useRef<BrowserQRCodeReader | null>(null)
  const qrScannerCancelledRef = useRef(false)
  const qrScannerAttemptRef = useRef(0)
  const detailMessageRef = useRef<HTMLDivElement | null>(null)
  const communicationAutoLoadedRef = useRef(false)
  const preservedDetailMessageRef = useRef<{
    userId: string
    message: string
    type: DetailMessageType
    mode: DetailMode
  } | null>(null)

  const [isMobile, setIsMobile] = useState(false)
  const [people, setPeople] = useState(initialPeople)
  const [pendingReviewPeople, setPendingReviewPeople] = useState(initialPendingReviewPeople)
  const [refreshingPeople, setRefreshingPeople] = useState(false)
  const [peopleSearchLoading, setPeopleSearchLoading] = useState(false)
  const [peopleSearchMessage, setPeopleSearchMessage] = useState(initialPeopleSearchMessage)
  const [search, setSearch] = useState('')
  const [registrationGroupFilter, setRegistrationGroupFilter] = useState('ALL')
  const [emailFilter, setEmailFilter] = useState('ALL')
  const [foodFilter, setFoodFilter] = useState('ALL')
  const [qrFilter, setQrFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [pageSize, setPageSize] = useState(12)
  const [currentPage, setCurrentPage] = useState(1)
  const [peopleTotal, setPeopleTotal] = useState(initialPeople.length)
  const [serverPageCount, setServerPageCount] = useState(Math.max(1, Math.ceil(initialPeople.length / 12)))
  const [selectedPersonId, setSelectedPersonId] = useState('')
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
  const [personnelTool, setPersonnelTool] = useState<PersonnelTool>('')
  const [communicationLanguage, setCommunicationLanguage] = useState<CommunicationLanguage>('SK')
  const [communicationGroupId, setCommunicationGroupId] = useState('')
  const [communicationWelcomeResend, setCommunicationWelcomeResend] = useState(false)
  const [communicationSummary, setCommunicationSummary] = useState<CommunicationSummary | null>(null)
  const [selfOrderingGroupId, setSelfOrderingGroupId] = useState('')
  const [selfOrderingResend, setSelfOrderingResend] = useState(false)
  const [selfOrderingSummary, setSelfOrderingSummary] = useState<CommunicationSummary | null>(null)
  const [communicationLoading, setCommunicationLoading] = useState(false)
  const [communicationMessage, setCommunicationMessage] = useState('')
  const [communicationMessageType, setCommunicationMessageType] = useState<'ok' | 'error' | ''>('')
  const [welcomePersonQuery, setWelcomePersonQuery] = useState('')
  const [welcomePersonResults, setWelcomePersonResults] = useState<PersonItem[]>([])
  const [welcomeSelectedPerson, setWelcomeSelectedPerson] = useState<PersonItem | null>(null)
  const [communicationPersonQuery, setCommunicationPersonQuery] = useState('')
  const [communicationPersonResults, setCommunicationPersonResults] = useState<PersonItem[]>([])
  const [communicationSelectedPerson, setCommunicationSelectedPerson] = useState<PersonItem | null>(null)
  const [accessCodesGroupId, setAccessCodesGroupId] = useState('')
  const [accessCodesEmail, setAccessCodesEmail] = useState('')
  const [accessCodesLanguage, setAccessCodesLanguage] = useState<CommunicationLanguage>('SK')
  const [accessCodesIncludeCsv, setAccessCodesIncludeCsv] = useState(true)
  const [accessCodesIncludeQr, setAccessCodesIncludeQr] = useState(true)
  const [accessCodesNote, setAccessCodesNote] = useState(ACCESS_CODES_NOTES.SK)
  const [accessCodesSummary, setAccessCodesSummary] = useState<CommunicationSummary | null>(null)
  const [accessCodesLoading, setAccessCodesLoading] = useState(false)
  const [accessCodesMessage, setAccessCodesMessage] = useState('')
  const [accessCodesMessageType, setAccessCodesMessageType] = useState<'ok' | 'error' | ''>('')
  const [managerOverviewGroups, setManagerOverviewGroups] = useState<RegistrationGroupManagersOverviewGroup[]>([])
  const [managerOverviewLoading, setManagerOverviewLoading] = useState(false)
  const [managerOverviewActionLoading, setManagerOverviewActionLoading] = useState(false)
  const [managerOverviewMessage, setManagerOverviewMessage] = useState('')
  const [managerOverviewMessageType, setManagerOverviewMessageType] = useState<'ok' | 'error' | ''>('')
  const [managerOverviewFilter, setManagerOverviewFilter] = useState('')
  const [managerOverviewMode, setManagerOverviewMode] = useState<ManagerOverviewMode>('all')
  const [managerOverviewGroupId, setManagerOverviewGroupId] = useState('')
  const [managerOverviewPersonQuery, setManagerOverviewPersonQuery] = useState('')
  const [managerOverviewPersonResults, setManagerOverviewPersonResults] = useState<PersonItem[]>([])
  const [managerOverviewSelectedPerson, setManagerOverviewSelectedPerson] = useState<PersonItem | null>(null)
  const [printQrOpen, setPrintQrOpen] = useState(false)
  const [printQrForm, setPrintQrForm] = useState({
    type: 'REGISTRATION_GROUP',
    registrationGroupId: '',
    foodGroupId: ''
  })
  const [qrRulesOpen, setQrRulesOpen] = useState(false)
  const [legacyFoodGroupsOpen, setLegacyFoodGroupsOpen] = useState(false)
  const [qrRulesLoading, setQrRulesLoading] = useState(false)
  const [qrRulesMessage, setQrRulesMessage] = useState('')
  const [qrRulesMessageType, setQrRulesMessageType] = useState<'ok' | 'error' | ''>('')
  const [qrRulesForm, setQrRulesForm] = useState<QrWristbandRules>(qrWristbandRules)
  const [legacyFoodGroupsEnabledState, setLegacyFoodGroupsEnabledState] = useState(legacyFoodGroupsEnabled)
  const [legacyFoodGroupsLoading, setLegacyFoodGroupsLoading] = useState(false)
  const [legacyFoodGroupsMessage, setLegacyFoodGroupsMessage] = useState('')
  const [legacyFoodGroupsMessageType, setLegacyFoodGroupsMessageType] = useState<'ok' | 'error' | ''>('')
  const [registrationAssignmentOpen, setRegistrationAssignmentOpen] = useState(false)
  const [registrationAssignmentLoading, setRegistrationAssignmentLoading] = useState(false)
  const [registrationAssignmentMessage, setRegistrationAssignmentMessage] = useState('')
  const [registrationAssignmentMessageType, setRegistrationAssignmentMessageType] = useState<'ok' | 'error' | ''>('')
  const [registrationAssignmentSearch, setRegistrationAssignmentSearch] = useState('')
  const [bulkRegistrationEntitlementsOpen, setBulkRegistrationEntitlementsOpen] = useState(false)
  const [bulkRegistrationEntitlementsLoading, setBulkRegistrationEntitlementsLoading] = useState(false)
  const [bulkRegistrationEntitlementsMessage, setBulkRegistrationEntitlementsMessage] = useState('')
  const [bulkRegistrationEntitlementsMessageType, setBulkRegistrationEntitlementsMessageType] = useState<'ok' | 'error' | ''>('')
  const [bulkRegistrationCalendarClaims, setBulkRegistrationCalendarClaims] = useState<Record<string, CalendarClaim>>({})
  const [detailMode, setDetailMode] = useState<DetailMode>('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailMessage, setDetailMessage] = useState('')
  const [detailMessageType, setDetailMessageType] = useState<DetailMessageType>('')
  const [detailMessageMode, setDetailMessageMode] = useState<DetailMode>('')
  const [pendingReviewOpenStep, setPendingReviewOpenStep] = useState<1 | 2 | 3>(1)
  const [pendingReviewAction, setPendingReviewAction] = useState<'period' | 'prepare' | 'entitlements' | 'approve' | ''>('')
  const [createForm, setCreateForm] = useState({
    accountType: 'PERSON' as CreateAccountType,
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
    assignQr: true,
    generateAccessCode: false
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
  const [registrationPeriodForm, setRegistrationPeriodForm] = useState({
    periodId: '',
    registrationGroupId: '',
    validFrom: isoDateOffset(0),
    validTo: '',
    note: ''
  })
  const [registrationGroupAccessForm, setRegistrationGroupAccessForm] = useState({
    registrationGroupId: ''
  })
  const [selectedRegistrationPeriodKeys, setSelectedRegistrationPeriodKeys] = useState<string[]>([])
  const [entitlementForm, setEntitlementForm] = useState({
    validFrom: fromDate,
    validTo: toDate,
    obed: false,
    vecera: false
  })
  const [bulkRegistrationEntitlementsForm, setBulkRegistrationEntitlementsForm] = useState({
    registrationGroupId: '',
    mode: 'SET' as 'SET' | 'CLEAR' | 'DATES',
    validFrom: fromDate,
    validTo: toDate,
    obed: true,
    vecera: false,
    activeOnly: true
  })
  const [registrationAssignmentForm, setRegistrationAssignmentForm] = useState({
    registrationGroupId: '',
    registrationGroupNote: '',
    validFrom: isoDateOffset(0),
    validTo: '',
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
    role: 'MEMBER',
    newGroupName: ''
  })
  const [nfcForm, setNfcForm] = useState({
    tokenUid: ''
  })
  const [roleForm, setRoleForm] = useState({
    admin: false,
    personalista: false,
    adminVydaj: false,
    vydaj: false,
    groupCreator: false,
    wristbandKiosk: false,
    menuKiosk: false,
    offlineObsluha: false,
    selfOrderingMeal: false,
    adminRegSkupiny: false
  })
  const [accessCodeLoading, setAccessCodeLoading] = useState(false)
  const [accessCodeLoaded, setAccessCodeLoaded] = useState(false)
  const [accessCodeValue, setAccessCodeValue] = useState('')
  const [accessCodeCopied, setAccessCodeCopied] = useState(false)
  const [accessCodeRevealed, setAccessCodeRevealed] = useState(false)

  const setDetailFeedback = (message: string, type: DetailMessageType, mode: DetailMode = detailMode) => {
    setDetailMessage(message)
    setDetailMessageType(type)
    setDetailMessageMode(mode)
  }

  const closeTopPanels = () => {
    setCreateOpen(false)
    setRegistrationGroupsOpen(false)
    setPrintQrOpen(false)
    setQrRulesOpen(false)
    setLegacyFoodGroupsOpen(false)
    setPersonnelTool('')
  }

  const resetPersonalistaHome = () => {
    closeTopPanels()
    setSearch('')
    setRegistrationGroupFilter('ALL')
    setEmailFilter('ALL')
    setFoodFilter('ALL')
    setQrFilter('ALL')
    setStatusFilter('ALL')
    setSelectedPersonId('')
    setCurrentPage(1)
    setPeople(initialPeople)
    setPeopleSearchLoading(false)
    setPeopleSearchMessage(initialPeopleSearchMessage)
  }

  const refreshPersonalistaData = () => {
    setRefreshingPeople(true)
    router.refresh()
    window.setTimeout(() => setRefreshingPeople(false), 900)
  }

  const loadCommunicationSummary = async (registrationGroupId: string, target: 'communication' | 'selfOrdering' | 'accessCodes') => {
    if (target === 'accessCodes' && !registrationGroupId) {
      setAccessCodesMessage('Vyber registracnu skupinu.')
      setAccessCodesMessageType('error')
      return null
    }

    const loadingSetter = target === 'accessCodes' ? setAccessCodesLoading : setCommunicationLoading
    const messageSetter = target === 'accessCodes' ? setAccessCodesMessage : setCommunicationMessage
    const typeSetter = target === 'accessCodes' ? setAccessCodesMessageType : setCommunicationMessageType
    const summarySetter = target === 'accessCodes'
      ? setAccessCodesSummary
      : target === 'selfOrdering'
        ? setSelfOrderingSummary
        : setCommunicationSummary

    loadingSetter(true)
    messageSetter('')
    typeSetter('')

    try {
      const url = registrationGroupId
        ? `/api/personalista/communication/summary?registrationGroupId=${encodeURIComponent(registrationGroupId)}${target !== 'accessCodes' ? '&baseRegistrationGroup=1' : ''}`
        : '/api/personalista/communication/summary'
      const res = await fetch(url, {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        messageSetter(json.error || 'Prehlad sa nepodarilo nacitat.')
        typeSetter('error')
        summarySetter(null)
        return null
      }

      const summary = {
        total: Number(json.total || 0),
        withEmail: Number(json.withEmail || 0),
        welcomeSent: Number(json.welcomeSent || 0),
        welcomePending: Number(json.welcomePending || 0),
        selfOrderingTotal: Number(json.selfOrderingTotal || 0),
        selfOrderingWithEmail: Number(json.selfOrderingWithEmail || 0),
        selfOrderingSent: Number(json.selfOrderingSent || 0),
        selfOrderingPending: Number(json.selfOrderingPending || 0),
        withAccessCode: Number(json.withAccessCode || 0),
        withQr: Number(json.withQr || 0),
        group: json.group
      }

      summarySetter(summary)
      messageSetter(`Načítané: ${summary.group?.name || 'všetci aktívni ľudia'}.`)
      typeSetter('ok')
      return summary
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      messageSetter('Chyba spojenia so serverom: ' + message)
      typeSetter('error')
      summarySetter(null)
      return null
    } finally {
      loadingSetter(false)
    }
  }

  const sendWelcomeEmailsForGroup = async () => {
    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')

    try {
      const res = await fetch('/api/personalista/communication/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: communicationGroupId,
          resend: communicationWelcomeResend,
          language: communicationLanguage
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setCommunicationMessage(json.error || 'E-maily sa nepodarilo odoslat.')
        setCommunicationMessageType('error')
        return
      }

      setCommunicationMessage(
        `Odoslané: ${json.sent}, chyby: ${json.failed}.` +
        (json.remaining ? ` Zostáva ešte: ${json.remaining}. Spusti odoslanie znova pre ďalšiu dávku.` : '')
      )
      setCommunicationMessageType(json.failed ? 'error' : 'ok')
      await loadCommunicationSummary(communicationGroupId, 'communication')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCommunicationMessage('Chyba spojenia so serverom: ' + message)
      setCommunicationMessageType('error')
    } finally {
      setCommunicationLoading(false)
    }
  }

  const searchWelcomePeople = async () => {
    const query = welcomePersonQuery.trim()

    if (query.length < 2) {
      setCommunicationMessage('Zadaj aspon 2 znaky mena, priezviska alebo e-mailu.')
      setCommunicationMessageType('error')
      setWelcomePersonResults([])
      return
    }

    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')
    setWelcomeSelectedPerson(null)

    try {
      const res = await fetch(`/api/personalista/people/search?q=${encodeURIComponent(query)}`, {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setCommunicationMessage(json.error || 'Vyhladavanie osoby zlyhalo.')
        setCommunicationMessageType('error')
        setWelcomePersonResults([])
        return
      }

      const results = Array.isArray(json.people) ? json.people : []
      const candidates = results
        .filter((person: PersonItem) => (
          !!person.email &&
          !(person.globalRoles || []).includes('SAMOSTATNE_OBJEDNAVANIE_STRAVY') &&
          String(person.aktivny || '').toUpperCase() === 'ANO'
        ))
        .slice(0, 12)

      setWelcomePersonResults(candidates)
      setCommunicationMessage(candidates.length ? `Najdenych: ${candidates.length}.` : 'Nenasla sa aktivna osoba s e-mailom pre bezny uvitaci e-mail.')
      setCommunicationMessageType(candidates.length ? 'ok' : 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCommunicationMessage('Chyba spojenia so serverom: ' + message)
      setCommunicationMessageType('error')
      setWelcomePersonResults([])
    } finally {
      setCommunicationLoading(false)
    }
  }

  const sendWelcomeEmailToPerson = async () => {
    if (!welcomeSelectedPerson) {
      setCommunicationMessage('Vyber osobu zo zoznamu.')
      setCommunicationMessageType('error')
      return
    }

    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')

    try {
      const res = await fetch('/api/personalista/communication/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: welcomeSelectedPerson.id,
          resend: communicationWelcomeResend,
          language: communicationLanguage
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) throw new Error(json.error || 'Odoslanie zlyhalo.')
      if (json.failed || !json.sent) throw new Error('E-mail sa nepodarilo odoslat alebo uz bol odoslany.')

      await loadCommunicationSummary(communicationGroupId, 'communication')
      setCommunicationMessage(`Uvitaci e-mail odoslany: ${welcomeSelectedPerson.fullName || welcomeSelectedPerson.email}.`)
      setCommunicationMessageType('ok')
    } catch (err: any) {
      setCommunicationMessage(err?.message || 'Odoslanie zlyhalo.')
      setCommunicationMessageType('error')
    } finally {
      setCommunicationLoading(false)
    }
  }

  const sendSelfOrderingEmails = async () => {
    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')

    try {
      const res = await fetch('/api/personalista/communication/send-self-ordering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: selfOrderingGroupId,
          resend: selfOrderingResend,
          language: communicationLanguage
        })
      })
      const json = await res.json()

      if (!res.ok || json.error) throw new Error(json.error || 'Odoslanie zlyhalo.')

      setCommunicationMessage(`Samostatné objednávanie: odoslané ${json.sent}, chyby ${json.failed}, zostáva ${json.remaining}.`)
      setCommunicationMessageType(json.failed ? 'error' : 'ok')
      await loadCommunicationSummary(selfOrderingGroupId, 'selfOrdering')
    } catch (err: any) {
      setCommunicationMessage(err?.message || 'Odoslanie zlyhalo.')
      setCommunicationMessageType('error')
    } finally {
      setCommunicationLoading(false)
    }
  }

  const searchCommunicationPeople = async () => {
    const query = communicationPersonQuery.trim()

    if (query.length < 2) {
      setCommunicationMessage('Zadaj aspon 2 znaky mena, priezviska alebo e-mailu.')
      setCommunicationMessageType('error')
      setCommunicationPersonResults([])
      return
    }

    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')
    setCommunicationSelectedPerson(null)

    try {
      const res = await fetch(`/api/personalista/people/search?q=${encodeURIComponent(query)}`, {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setCommunicationMessage(json.error || 'Vyhladavanie osoby zlyhalo.')
        setCommunicationMessageType('error')
        setCommunicationPersonResults([])
        return
      }

      const results = Array.isArray(json.people) ? json.people : []
      const candidates = results
        .filter((person: PersonItem) => (
          !!person.email &&
          (person.globalRoles || []).includes('SAMOSTATNE_OBJEDNAVANIE_STRAVY') &&
          String(person.aktivny || '').toUpperCase() === 'ANO'
        ))
        .slice(0, 12)

      setCommunicationPersonResults(candidates)
      setCommunicationMessage(candidates.length ? `Najdenych: ${candidates.length}.` : 'Nenasla sa osoba s e-mailom a pravom Samostatne objednavanie stravy.')
      setCommunicationMessageType(candidates.length ? 'ok' : 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCommunicationMessage('Chyba spojenia so serverom: ' + message)
      setCommunicationMessageType('error')
      setCommunicationPersonResults([])
    } finally {
      setCommunicationLoading(false)
    }
  }

  const resendSelfOrderingEmail = async () => {
    if (!communicationSelectedPerson) {
      setCommunicationMessage('Vyber osobu zo zoznamu.')
      setCommunicationMessageType('error')
      return
    }

    setCommunicationLoading(true)
    setCommunicationMessage('')
    setCommunicationMessageType('')

    try {
      const res = await fetch('/api/personalista/communication/send-self-ordering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: communicationSelectedPerson.id,
          resend: true,
          language: communicationLanguage
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) throw new Error(json.error || 'Odoslanie zlyhalo.')
      if (json.failed || !json.sent) throw new Error('E-mail sa nepodarilo odoslat.')

      await loadCommunicationSummary(selfOrderingGroupId, 'selfOrdering')
      setCommunicationMessage(`Odoslane znova: ${communicationSelectedPerson.fullName || communicationSelectedPerson.email}.`)
      setCommunicationMessageType('ok')
    } catch (err: any) {
      setCommunicationMessage(err?.message || 'Odoslanie zlyhalo.')
      setCommunicationMessageType('error')
    } finally {
      setCommunicationLoading(false)
    }
  }

  useEffect(() => {
    if (personnelTool !== 'communication') {
      communicationAutoLoadedRef.current = false
      return
    }

    if (communicationAutoLoadedRef.current) return

    communicationAutoLoadedRef.current = true
    void loadCommunicationSummary('', 'communication')
    void loadCommunicationSummary('', 'selfOrdering')
  }, [personnelTool])

  const sendAccessCodesForGroup = async () => {
    if (!accessCodesGroupId) {
      setAccessCodesMessage('Vyber registracnu skupinu.')
      setAccessCodesMessageType('error')
      return
    }

    if (!accessCodesEmail.trim()) {
      setAccessCodesMessage('Zadaj e-mail prijemcu.')
      setAccessCodesMessageType('error')
      return
    }

    if (!accessCodesIncludeCsv && !accessCodesIncludeQr) {
      setAccessCodesMessage('Vyber aspon jednu prilohu.')
      setAccessCodesMessageType('error')
      return
    }

    setAccessCodesLoading(true)
    setAccessCodesMessage('')
    setAccessCodesMessageType('')

    try {
      const res = await fetch('/api/personalista/access-codes/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: accessCodesGroupId,
          email: accessCodesEmail,
          includeAccessCodes: accessCodesIncludeCsv,
          includeQrCodes: accessCodesIncludeQr,
          language: accessCodesLanguage,
          note: accessCodesNote
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setAccessCodesMessage(json.error || 'Pristupove kody sa nepodarilo odoslat.')
        setAccessCodesMessageType('error')
        return
      }

      setAccessCodesMessage(`E-mail odoslany na ${accessCodesEmail}. Pristupy: ${json.count || 0}, QR: ${json.qrCount || 0}.`)
      setAccessCodesMessageType('ok')
      setAccessCodesNote(ACCESS_CODES_NOTES[accessCodesLanguage])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setAccessCodesMessage('Chyba spojenia so serverom: ' + message)
      setAccessCodesMessageType('error')
    } finally {
      setAccessCodesLoading(false)
    }
  }

  const loadRegistrationGroupManagersOverview = async () => {
    setManagerOverviewLoading(true)
    setManagerOverviewMessage('')
    setManagerOverviewMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-group-managers', {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setManagerOverviewMessage(json.error || 'Prehlad managerov sa nepodarilo nacitat.')
        setManagerOverviewMessageType('error')
        setManagerOverviewGroups([])
        return
      }

      const groups = Array.isArray(json.groups) ? json.groups : []
      setManagerOverviewGroups(groups)
      setManagerOverviewMessage(`Nacitane: ${groups.length} registracnych skupin.`)
      setManagerOverviewMessageType('ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setManagerOverviewMessage('Chyba spojenia so serverom: ' + message)
      setManagerOverviewMessageType('error')
      setManagerOverviewGroups([])
    } finally {
      setManagerOverviewLoading(false)
    }
  }

  const searchManagerOverviewPeople = async () => {
    const query = managerOverviewPersonQuery.trim()

    if (query.length < 2) {
      setManagerOverviewMessage('Zadaj aspon 2 znaky mena, priezviska alebo e-mailu.')
      setManagerOverviewMessageType('error')
      setManagerOverviewPersonResults([])
      return
    }

    setManagerOverviewActionLoading(true)
    setManagerOverviewMessage('')
    setManagerOverviewMessageType('')
    setManagerOverviewSelectedPerson(null)

    try {
      const res = await fetch(`/api/personalista/people/search?q=${encodeURIComponent(query)}`, {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setManagerOverviewMessage(json.error || 'Vyhladavanie osoby zlyhalo.')
        setManagerOverviewMessageType('error')
        setManagerOverviewPersonResults([])
        return
      }

      const results = Array.isArray(json.people) ? json.people : []
      setManagerOverviewPersonResults(results.slice(0, 12))
      setManagerOverviewMessage(results.length ? `Najdenych: ${Math.min(results.length, 12)}.` : 'Nenasla sa ziadna osoba.')
      setManagerOverviewMessageType(results.length ? 'ok' : 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setManagerOverviewMessage('Chyba spojenia so serverom: ' + message)
      setManagerOverviewMessageType('error')
      setManagerOverviewPersonResults([])
    } finally {
      setManagerOverviewActionLoading(false)
    }
  }

  const addManagerFromOverview = async () => {
    if (!managerOverviewGroupId) {
      setManagerOverviewMessage('Vyber registracnu skupinu.')
      setManagerOverviewMessageType('error')
      return
    }

    if (!managerOverviewSelectedPerson) {
      setManagerOverviewMessage('Vyber osobu zo zoznamu vysledkov.')
      setManagerOverviewMessageType('error')
      return
    }

    const selectedManagerPerson = managerOverviewSelectedPerson

    setManagerOverviewActionLoading(true)
    setManagerOverviewMessage('')
    setManagerOverviewMessageType('')

    try {
      const res = await fetch('/api/personalista/people/registration-group-managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedManagerPerson.id,
          registrationGroupId: managerOverviewGroupId
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setManagerOverviewMessage(json.error || 'Managera sa nepodarilo pridat.')
        setManagerOverviewMessageType('error')
        return
      }

      setManagerOverviewPersonQuery('')
      setManagerOverviewPersonResults([])
      setManagerOverviewSelectedPerson(null)
      await loadRegistrationGroupManagersOverview()
      await reloadPersonDetail(selectedManagerPerson.id).catch(() => undefined)
      setManagerOverviewMessage(json.message || 'Manager registracnej skupiny bol pridany.')
      setManagerOverviewMessageType('ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setManagerOverviewMessage('Chyba spojenia so serverom: ' + message)
      setManagerOverviewMessageType('error')
    } finally {
      setManagerOverviewActionLoading(false)
    }
  }

  const removeManagerFromOverview = async (manager: RegistrationGroupManagerPerson, groupName: string) => {
    const ok = window.confirm(`Odobrat managera ${manager.fullName || manager.email || 'bez mena'} zo skupiny ${groupName}?`)
    if (!ok) return

    setManagerOverviewActionLoading(true)
    setManagerOverviewMessage('')
    setManagerOverviewMessageType('')

    try {
      const res = await fetch('/api/personalista/people/registration-group-managers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: manager.userId,
          managerId: manager.id
        })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setManagerOverviewMessage(json.error || 'Managera sa nepodarilo odobrat.')
        setManagerOverviewMessageType('error')
        return
      }

      await loadRegistrationGroupManagersOverview()
      await reloadPersonDetail(manager.userId).catch(() => undefined)
      setManagerOverviewMessage(json.message || 'Manager registracnej skupiny bol odobrany.')
      setManagerOverviewMessageType('ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setManagerOverviewMessage('Chyba spojenia so serverom: ' + message)
      setManagerOverviewMessageType('error')
    } finally {
      setManagerOverviewActionLoading(false)
    }
  }

  const clearDetailFeedback = () => {
    setDetailMessage('')
    setDetailMessageType('')
    setDetailMessageMode('')
  }

  const replacePersonInList = (person: PersonItem) => {
    setPeople(prev => {
      return [person, ...prev.filter(item => item.id !== person.id)]
    })
    setPendingReviewPeople(prev => {
      const personIsPending = String(person.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'

      if (!personIsPending) {
        return prev.filter(item => item.id !== person.id)
      }

      return [person, ...prev.filter(item => item.id !== person.id)]
    })
  }

  const applyUpdatedPersonEntitlements = (userId: string, entitlements: PersonEntitlement[]) => {
    const safeEntitlements = entitlements
      .map(item => ({
        datum: item.datum,
        obed: !!item.obed,
        vecera: !!item.vecera
      }))
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)))
    const lunchClaims = safeEntitlements.filter(item => item.obed).length
    const dinnerClaims = safeEntitlements.filter(item => item.vecera).length

    const updatePerson = (person: PersonItem): PersonItem => person.id === userId
      ? {
        ...person,
        entitlements: safeEntitlements,
        entitlementDays: safeEntitlements.length,
        lunchClaims,
        dinnerClaims,
        mealClaims: lunchClaims + dinnerClaims
      }
      : person

    setPeople(prev => prev.map(updatePerson))
    setPendingReviewPeople(prev => prev.map(updatePerson))
  }

  const reloadPersonDetail = async (userId: string) => {
    const res = await fetch(`/api/personalista/people/search?userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store'
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok || json.error) {
      throw new Error(json.error || 'Detail osoby sa nepodarilo obnovit.')
    }

    const person = Array.isArray(json.people) ? json.people[0] : null

    if (!person?.id) {
      throw new Error('Server nevratil aktualny detail osoby.')
    }

    replacePersonInList(person)
    setSelectedPersonId(person.id)

    return person as PersonItem
  }

  const displayPeople = people
  const selectedPerson = selectedPersonId
    ? displayPeople.find(person => person.id === selectedPersonId) || null
    : null
  const selectedPersonIsTechnical = String(selectedPerson?.accountType || '').toUpperCase() === 'TECHNICAL'
  const canUseSelectedPersonAccessCode = !!selectedPerson && (!selectedPersonIsTechnical || canAssignSensitiveRoles)
  const selectedPersonPendingReview = String(selectedPerson?.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'
  const pendingReviewPeriods = sortRegistrationPeriods(selectedPerson?.registrationGroupPeriods || [])
  const pendingReviewBoundedPeriods = boundedRegistrationPeriods(pendingReviewPeriods)
  const pendingReviewAssignmentDates = datesFromRegistrationPeriods(pendingReviewBoundedPeriods)
  const pendingReviewEntitlements = pendingReviewBoundedPeriods.length > 0
    ? selectedPerson?.entitlements.filter(item => (
      dateIsInRegistrationPeriods(item.datum, pendingReviewBoundedPeriods) &&
      (item.obed || item.vecera)
    )) || []
    : []
  const pendingReviewCanFinish = selectedPersonPendingReview && pendingReviewBoundedPeriods.length > 0 && pendingReviewEntitlements.length > 0

  const loadAccessCode = async () => {
    if (!selectedPerson) return

    setAccessCodeLoading(true)
    setAccessCodeCopied(false)
    setAccessCodeRevealed(false)

    try {
      const res = await fetch(`/api/personalista/people/access-code?userId=${encodeURIComponent(selectedPerson.id)}`, {
        cache: 'no-store'
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setDetailFeedback(json.error || 'Pristupovy kod sa nepodarilo nacitat.', 'error', 'accessCode')
        return
      }

      setAccessCodeLoaded(true)
      setAccessCodeValue(json.accessCode || '')
      setDetailFeedback(
        json.accessCode ? 'Pristupovy kod je nacitany. Podrz Zobrazit pre odhalenie.' : 'Osoba nema pristupovy kod.',
        json.accessCode ? 'ok' : 'error',
        'accessCode'
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDetailFeedback('Chyba nacitania pristupoveho kodu: ' + message, 'error', 'accessCode')
    } finally {
      setAccessCodeLoading(false)
    }
  }

  const generateAccessCodeForSelectedPerson = async () => {
    if (!selectedPerson) return

    if (accessCodeValue) {
      const ok = window.confirm('Vygenerovat novy pristupovy kod? Povodny aktivny kod sa zneplatni.')
      if (!ok) return
    }

    setAccessCodeLoading(true)
    setAccessCodeCopied(false)
    setAccessCodeRevealed(false)

    try {
      const res = await fetch('/api/personalista/people/access-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedPerson.id })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setDetailFeedback(json.error || 'Pristupovy kod sa nepodarilo vytvorit.', 'error', 'accessCode')
        return
      }

      setAccessCodeLoaded(true)
      setAccessCodeValue(json.accessCode || '')
      setAccessCodeRevealed(false)
      setDetailFeedback(json.message || 'Pristupovy kod bol vytvoreny.', 'ok', 'accessCode')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDetailFeedback('Chyba vytvorenia pristupoveho kodu: ' + message, 'error', 'accessCode')
    } finally {
      setAccessCodeLoading(false)
    }
  }

  const copyAccessCode = async () => {
    if (!accessCodeValue) return

    try {
      await navigator.clipboard.writeText(accessCodeValue)
      setAccessCodeCopied(true)
      setAccessCodeRevealed(false)
      setDetailFeedback('Pristupovy kod bol skopirovany.', 'ok', 'accessCode')

      window.setTimeout(() => {
        setAccessCodeCopied(false)
      }, 1800)
    } catch {
      setDetailFeedback('Kopirovanie sa nepodarilo. Kod oznac a skopiruj rucne.', 'error', 'accessCode')
    }
  }
  const selectedRegistrationPeriodRows = useMemo(() => {
    const periods = sortRegistrationPeriods(selectedPerson?.registrationGroupPeriods || [])
    const rows: RegistrationPeriodSelectionRow[] = []

    periods.forEach((period, index) => {
      rows.push({ type: 'period', key: `period-${period.id}`, period })

      const next = periods[index + 1]
      if (!next || !period.validTo) return

      const gapFrom = isoDateAdd(period.validTo, 1)
      const gapTo = isoDateAdd(next.validFrom, -1)
      const gapKey = `gap-${gapFrom}-${gapTo}`

      if (gapFrom && gapTo && gapFrom <= gapTo) {
        rows.push({
          type: 'gap',
          key: gapKey,
          id: gapKey,
          validFrom: gapFrom,
          validTo: gapTo
        })
      }
    })

    return rows
  }, [selectedPerson])
  const selectedRegistrationPeriodKeySet = useMemo(() => {
    return new Set(selectedRegistrationPeriodKeys)
  }, [selectedRegistrationPeriodKeys])
  const selectedRegistrationPeriodSelectionRows = useMemo(() => {
    return selectedRegistrationPeriodRows.filter(row => selectedRegistrationPeriodKeySet.has(row.key))
  }, [selectedRegistrationPeriodRows, selectedRegistrationPeriodKeySet])
  const selectedRegistrationPeriodCount = selectedRegistrationPeriodKeys.length
  const isBulkRegistrationPeriodEdit = selectedRegistrationPeriodCount > 1
  const showMobilePersonDetail = isMobile && !!selectedPerson
  const foodGroupsVisible = true
  const shouldShowPendingReviewMessage = Boolean(selectedPersonPendingReview && detailMessage && detailMessageMode === '')
  const shouldShowDetailMessage = Boolean(detailMessage && detailMessageMode === detailMode && !shouldShowPendingReviewMessage)
  const printPersonHref = selectedPerson
    ? `/dashboard/personalista/print-qr?personId=${encodeURIComponent(selectedPerson.id)}`
    : ''
  const tableColumns = isMobile
    ? foodGroupsVisible
      ? 'minmax(155px, 1.25fr) 64px minmax(115px, 0.85fr) minmax(150px, 1fr) minmax(120px, 1fr) 56px 52px 62px'
      : 'minmax(155px, 1.25fr) 64px minmax(125px, 0.9fr) minmax(160px, 1fr) 56px 52px 62px'
    : foodGroupsVisible
      ? 'minmax(180px, 1.25fr) 70px minmax(130px, 0.8fr) minmax(170px, 1fr) minmax(135px, 1fr) 62px 58px 68px'
      : 'minmax(180px, 1.25fr) 70px minmax(140px, 0.85fr) minmax(180px, 1fr) 62px 58px 68px'
  const tableMinWidth = foodGroupsVisible
    ? (isMobile ? 890 : 1100)
    : (isMobile ? 770 : 920)
  const peopleSearchHintStyle = peopleSearchLoading
    ? styles.toolbarHintLoading
    : peopleSearchMessage.startsWith('Vysledky hladania')
      ? styles.toolbarHintSuccess
      : peopleSearchMessage.toLowerCase().includes('chyba') || peopleSearchMessage.toLowerCase().includes('nepodarilo')
        ? styles.toolbarHintError
        : {}
  const filteredManagerOverviewGroups = useMemo(() => {
    const query = managerOverviewFilter.trim().toLowerCase()

    return managerOverviewGroups.filter(group => {
      if (managerOverviewMode === 'withManagers' && group.managers.length === 0) return false
      if (managerOverviewMode === 'withoutManagers' && group.managers.length > 0) return false

      if (!query) return true

      const groupMatch = group.name.toLowerCase().includes(query)
      const managerMatch = group.managers.some(manager => {
        return [
          manager.fullName,
          manager.email,
          manager.telefon
        ].some(value => String(value || '').toLowerCase().includes(query))
      })

      return groupMatch || managerMatch
    })
  }, [managerOverviewFilter, managerOverviewGroups, managerOverviewMode])
  const selectedManagerOverviewGroup = registrationGroups.find(group => group.id === managerOverviewGroupId) || null

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const updateMobile = () => setIsMobile(media.matches)

    updateMobile()
    media.addEventListener('change', updateMobile)

    return () => {
      media.removeEventListener('change', updateMobile)
    }
  }, [])

  useEffect(() => {
    if (!isMobile || !selectedPersonId) return

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [isMobile, selectedPersonId])

  useEffect(() => {
    if (personnelTool !== 'registrationGroupManagers') return
    if (managerOverviewGroups.length > 0 || managerOverviewLoading) return

    void loadRegistrationGroupManagersOverview()
  }, [personnelTool, managerOverviewGroups.length, managerOverviewLoading])

  useEffect(() => {
    if (!isMobile || !shouldShowDetailMessage) return

    const frame = window.requestAnimationFrame(() => {
      detailMessageRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isMobile, shouldShowDetailMessage, detailMessage])

  useEffect(() => {
    if (detailMode === 'accessCode') return

    setAccessCodeLoaded(false)
    setAccessCodeValue('')
    setAccessCodeCopied(false)
    setAccessCodeRevealed(false)
  }, [detailMode])

  useEffect(() => {
    if (detailMode !== 'accessCode') return
    if (!selectedPerson || !canUseSelectedPersonAccessCode) return
    if (accessCodeLoaded || accessCodeLoading) return

    void loadAccessCode()
  }, [
    detailMode,
    selectedPerson?.id,
    canUseSelectedPersonAccessCode,
    accessCodeLoaded,
    accessCodeLoading
  ])

  useEffect(() => {
    setPeople(initialPeople)
    setPeopleTotal(initialPeople.length)
    setServerPageCount(Math.max(1, Math.ceil(initialPeople.length / 12)))
  }, [initialPeople])

  useEffect(() => {
    setPendingReviewPeople(initialPendingReviewPeople)
  }, [initialPendingReviewPeople])

  useEffect(() => {
    setQrRulesForm(qrWristbandRules)
  }, [qrWristbandRules])

  useEffect(() => {
    const q = search.trim()
    const hasActiveFilters = (
      registrationGroupFilter !== 'ALL' ||
      emailFilter !== 'ALL' ||
      foodFilter !== 'ALL' ||
      qrFilter !== 'ALL' ||
      statusFilter !== 'ALL'
    )

    if (q && q.length < 2 && !hasActiveFilters) {
      setPeople(initialPeople)
      setPeopleTotal(initialPeople.length)
      setServerPageCount(Math.max(1, Math.ceil(initialPeople.length / pageSize)))
      setPeopleSearchLoading(false)
      setPeopleSearchMessage('Napis aspon 2 znaky pre hladanie v celej databaze')
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(async () => {
      setPeopleSearchLoading(true)
      setPeopleSearchMessage('Hladam v databaze...')

      try {
        const params = new URLSearchParams()

        if (!hasActiveFilters && q.length === 0) params.set('recentScope', peopleScope)
        if (q.length >= 2) params.set('q', q)
        if (registrationGroupFilter !== 'ALL') params.set('registrationGroupId', registrationGroupFilter)
        if (emailFilter !== 'ALL') params.set('emailFilter', emailFilter)
        if (foodFilter !== 'ALL') params.set('foodFilter', foodFilter)
        if (qrFilter !== 'ALL') params.set('qrFilter', qrFilter)
        if (statusFilter !== 'ALL') params.set('status', statusFilter)
        params.set('page', String(currentPage))
        params.set('pageSize', String(pageSize))

        const res = await fetch(`/api/personalista/people/search?${params.toString()}`, {
          cache: 'no-store'
        })
        const json = await res.json().catch(() => ({}))

        if (cancelled) return

        if (!res.ok || json.error) {
          setPeopleSearchMessage(json.error || 'Hladanie sa nepodarilo.')
          return
        }

        const nextPeople = Array.isArray(json.people) ? json.people : []
        const nextTotal = Number(json.total || nextPeople.length)
        const nextPage = Number(json.page || currentPage)
        const nextPageCount = Math.max(1, Number(json.pageCount || Math.ceil(nextTotal / pageSize) || 1))

        setPeople(nextPeople)
        setPeopleTotal(nextTotal)
        setServerPageCount(nextPageCount)
        if (nextPage !== currentPage) setCurrentPage(nextPage)
        setPeopleSearchMessage(`Najdene: ${nextTotal}. Strana ${nextPage} / ${nextPageCount}`)
      } catch (err) {
        if (cancelled) return

        const message = err instanceof Error ? err.message : String(err)
        setPeopleSearchMessage('Chyba hladania: ' + message)
      } finally {
        if (!cancelled) setPeopleSearchLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [search, registrationGroupFilter, emailFilter, foodFilter, qrFilter, statusFilter, currentPage, pageSize, initialPeople, peopleScope])

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

    setRegistrationPeriodForm(defaultRegistrationPeriodForm(selectedPerson))
    setRegistrationGroupAccessForm({ registrationGroupId: '' })
    setSelectedRegistrationPeriodKeys([])

    const pendingDates = String(selectedPerson.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW'
      ? datesFromRegistrationPeriods(selectedPerson.registrationGroupPeriods)
      : []
    const bounds = pendingDates.length > 0
      ? boundsFromDates(pendingDates, fromDate, toDate)
      : entitlementBounds(selectedPerson.entitlements, fromDate, toDate)
    const nextEntitlementForm = {
      validFrom: bounds.validFrom,
      validTo: bounds.validTo,
      obed: false,
      vecera: false
    }

    setEntitlementForm(nextEntitlementForm)
    const baseCalendarClaims = calendarClaimsFromEntitlements(selectedPerson.entitlements)
    const hasPendingEntitlements = pendingDates.some(date => !!baseCalendarClaims[date])
    const pendingDefaultDates = hasPendingEntitlements ? [] : pendingDates.filter(date => !baseCalendarClaims[date])

    pendingDefaultDates.forEach(date => {
      baseCalendarClaims[date] = {
        obed: true,
        vecera: true
      }
    })

    setCalendarClaims(baseCalendarClaims)
    setBulkEntitlementClaims({
      obed: pendingDefaultDates,
      vecera: pendingDefaultDates
    })
    setPendingReviewAction('')

    if (String(selectedPerson.reviewStatus || '').toUpperCase() === 'PENDING_REVIEW') {
      const boundedPeriods = boundedRegistrationPeriods(selectedPerson.registrationGroupPeriods)
      const savedEntitlements = boundedPeriods.length > 0
        ? selectedPerson.entitlements.filter(item => (
          dateIsInRegistrationPeriods(item.datum, boundedPeriods) &&
          (item.obed || item.vecera)
        ))
        : []

      setPendingReviewOpenStep(boundedPeriods.length === 0 ? 1 : savedEntitlements.length === 0 ? 2 : 3)
    } else {
      setPendingReviewOpenStep(1)
    }

    setQrForm({ qrCode: '' })
    setGroupForm({ groupId: '', role: 'MEMBER', newGroupName: '' })
    setNfcForm({ tokenUid: '' })
    setAccessCodeLoading(false)
    setAccessCodeLoaded(false)
    setAccessCodeValue('')
    setAccessCodeCopied(false)
    setAccessCodeRevealed(false)
    setRoleForm({
      admin: selectedPerson.globalRoles.includes('ADMIN'),
      personalista: selectedPerson.globalRoles.includes('PERSONALISTA'),
      adminVydaj: selectedPerson.globalRoles.includes('ADMIN_VYDAJ'),
      vydaj: selectedPerson.globalRoles.includes('VYDAJ'),
      groupCreator: selectedPerson.globalRoles.includes('GROUP_CREATOR'),
      wristbandKiosk: selectedPerson.globalRoles.includes('WRISTBAND_KIOSK'),
      menuKiosk: selectedPerson.globalRoles.includes('MENU_KIOSK'),
      offlineObsluha: selectedPerson.globalRoles.includes('OFFLINE_OBSLUHA'),
      selfOrderingMeal: selectedPerson.globalRoles.includes('SAMOSTATNE_OBJEDNAVANIE_STRAVY'),
      adminRegSkupiny: selectedPerson.globalRoles.includes('ADMIN_REG_SKUPINY')
    })
    const preservedMessage = preservedDetailMessageRef.current

    if (preservedMessage?.userId === selectedPerson.id) {
      setDetailMessage(preservedMessage.message)
      setDetailMessageType(preservedMessage.type)
      setDetailMessageMode(preservedMessage.mode)
      preservedDetailMessageRef.current = null
    } else {
      clearDetailFeedback()
    }
  }, [selectedPerson, fromDate, toDate])

  const peopleOrderById = useMemo(() => {
    return new Map(displayPeople.map((person, index) => [person.id, index]))
  }, [displayPeople])

  const filteredPeople = useMemo(() => {
    const orderedPeople = displayPeople
      .slice()
      .sort((a, b) => {
        return (peopleOrderById.get(a.id) ?? 0) - (peopleOrderById.get(b.id) ?? 0)
      })

    return orderedPeople
  }, [displayPeople, peopleOrderById])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, registrationGroupFilter, emailFilter, foodFilter, qrFilter, statusFilter, pageSize])

  useEffect(() => {
    if (!displayPeople.length) {
      if (selectedPersonId) setSelectedPersonId('')
      return
    }

    if (!displayPeople.some(person => person.id === selectedPersonId)) {
      setSelectedPersonId('')
    }
  }, [displayPeople, selectedPersonId])

  const pageCount = serverPageCount
  const safeCurrentPage = Math.min(currentPage, pageCount)
  const pageStart = (safeCurrentPage - 1) * pageSize
  const pageEnd = Math.min(pageStart + filteredPeople.length, peopleTotal)
  const pagedPeople = filteredPeople

  const _stats = useMemo(() => {
    const activeQr = people.filter(person => person.activeQrCount > 0).length
    const withoutQr = people.length - activeQr
    const blocked = people.filter(person => String(person.aktivny || '').toUpperCase() !== 'ANO').length
    const pendingReview = pendingReviewPeople.length
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
  }, [people, pendingReviewPeople.length])
  const stats = personnelStats

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
  const isTechnicalCreate = createForm.accountType === 'TECHNICAL'

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
  const visibleEntitlementCalendarDates = useMemo(() => {
    if (selectedPersonPendingReview && pendingReviewAssignmentDates.length > 0) {
      return pendingReviewAssignmentDates
    }

    return entitlementCalendarDates
  }, [entitlementCalendarDates, pendingReviewAssignmentDates, selectedPersonPendingReview])
  const bulkRegistrationCalendarDates = useMemo(() => {
    return dateRangeIso(bulkRegistrationEntitlementsForm.validFrom, bulkRegistrationEntitlementsForm.validTo)
  }, [bulkRegistrationEntitlementsForm.validFrom, bulkRegistrationEntitlementsForm.validTo])

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
  const selectedBulkRegistrationGroupAllPeopleCount = useMemo(() => {
    if (!bulkRegistrationEntitlementsForm.registrationGroupId) return 0

    return people.filter(person => person.registrationGroupId === bulkRegistrationEntitlementsForm.registrationGroupId).length
  }, [people, bulkRegistrationEntitlementsForm.registrationGroupId])
  const selectedRegistrationAssignmentGroup = useMemo(() => {
    return registrationGroups.find(group => group.id === registrationAssignmentForm.registrationGroupId) || null
  }, [registrationGroups, registrationAssignmentForm.registrationGroupId])
  const printQrHref = useMemo(() => {
    if (printQrForm.type === 'REGISTRATION_GROUP') {
      return printQrForm.registrationGroupId
        ? `/dashboard/personalista/print-qr?registrationGroupId=${encodeURIComponent(printQrForm.registrationGroupId)}`
        : ''
    }

    return printQrForm.foodGroupId
      ? `/dashboard/personalista/print-qr?groupId=${encodeURIComponent(printQrForm.foodGroupId)}`
      : ''
  }, [printQrForm])
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

  const updateCreateAccountType = (accountType: CreateAccountType) => {
    setCreateForm(prev => {
      if (accountType === 'TECHNICAL') {
        return {
          ...prev,
          accountType,
          typStravy: 'MASO',
          registrationGroupId: '',
          groupIds: [],
          validFrom: isoDateOffset(0),
          validTo: isoDateOffset(0),
          obed: false,
          vecera: false,
          assignQr: false,
          generateAccessCode: true
        }
      }

      return {
        ...prev,
        accountType,
        typStravy: prev.typStravy || 'MASO',
        validFrom: prev.validFrom || isoDateOffset(0),
        validTo: prev.validTo || isoDateOffset(0),
        obed: prev.obed || !prev.vecera ? true : prev.obed
      }
    })

    setCreateGroupSelectId('')
  }

  const addCreateGroup = () => {
    if (isTechnicalCreate || !safeCreateGroupSelectId) return

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
      accountType: 'PERSON',
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
      assignQr: true,
      generateAccessCode: false
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

      setCreateMessage(json.accessCode
        ? `${json.message || 'Osoba bola vytvorená.'} Prístupový kód: ${json.accessCode}`
        : json.message || 'Osoba bola vytvorená.'
      )
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

  const updateRegistrationPeriodForm = (key: string, value: any) => {
    setRegistrationPeriodForm(prev => ({
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

  const selectManagedRegistrationGroup = (groupId: string) => {
    setBulkRegistrationEntitlementsForm(prev => ({
      ...prev,
      registrationGroupId: groupId
    }))
    setRegistrationAssignmentForm(prev => ({
      ...prev,
      registrationGroupId: groupId
    }))
    setBulkRegistrationEntitlementsMessage('')
    setBulkRegistrationEntitlementsMessageType('')
    setRegistrationAssignmentMessage('')
    setRegistrationAssignmentMessageType('')
  }

  const toggleBulkRegistrationCalendarClaim = (date: string, meal: 'obed' | 'vecera') => {
    setBulkRegistrationCalendarClaims(prev => {
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

  const setBulkRegistrationCalendarMealForAll = (meal: 'obed' | 'vecera', active: boolean) => {
    setBulkRegistrationCalendarClaims(prev => {
      const next = { ...prev }

      bulkRegistrationCalendarDates.forEach(date => {
        const current = next[date] || { obed: false, vecera: false }
        const updated = {
          ...current,
          [meal]: active
        }

        if (updated.obed || updated.vecera) {
          next[date] = updated
        } else {
          delete next[date]
        }
      })

      return next
    })
  }

  const clearBulkRegistrationCalendarSelection = () => {
    setBulkRegistrationCalendarClaims(prev => {
      const visibleDates = new Set(bulkRegistrationCalendarDates)
      const next = { ...prev }

      visibleDates.forEach(date => {
        delete next[date]
      })

      return next
    })
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

  const updateQrRuleRange = (index: number, key: keyof QrWristbandRuleRange, value: any) => {
    setQrRulesForm(prev => ({
      ...prev,
      ranges: prev.ranges.map((range, rangeIndex) => {
        if (rangeIndex !== index) return range

        if (key === 'seriesFrom' || key === 'seriesTo') {
          const number = Number(String(value || '').replace(/\D/g, '').slice(0, 3))
          return {
            ...range,
            [key]: Number.isFinite(number) ? number : 0
          }
        }

        if (key === 'typeCode') {
          return {
            ...range,
            typeCode: String(value || '').replace(/\D/g, '').slice(0, 2)
          }
        }

        return {
          ...range,
          [key]: value
        }
      })
    }))
  }

  const addQrRuleRange = () => {
    setQrRulesForm(prev => ({
      ...prev,
      ranges: [
        ...prev.ranges,
        {
          typeCode: '',
          seriesFrom: 1,
          seriesTo: 1,
          active: true
        }
      ]
    }))
  }

  const removeQrRuleRange = (index: number) => {
    setQrRulesForm(prev => ({
      ...prev,
      ranges: prev.ranges.filter((_, rangeIndex) => rangeIndex !== index)
    }))
  }

  const saveQrWristbandRules = async () => {
    if (!canAssignSensitiveRoles) {
      setQrRulesMessage('Pravidla QR naramkov moze upravit iba ADMIN.')
      setQrRulesMessageType('error')
      return
    }

    setQrRulesLoading(true)
    setQrRulesMessage('')
    setQrRulesMessageType('')

    try {
      const res = await fetch('/api/personalista/qr-wristband-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: qrRulesForm.enabled,
          ranges: qrRulesForm.ranges
        })
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setQrRulesMessage(json.error || 'Pravidla QR naramkov sa nepodarilo ulozit.')
        setQrRulesMessageType('error')
        return
      }

      setQrRulesMessage(json.message || 'Pravidla QR naramkov boli ulozene.')
      setQrRulesMessageType('ok')

      setTimeout(() => {
        router.refresh()
      }, 450)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setQrRulesMessage('Chyba spojenia so serverom: ' + message)
      setQrRulesMessageType('error')
    } finally {
      setQrRulesLoading(false)
    }
  }

  const saveLegacyFoodGroupsSetting = async (enabled: boolean) => {
    if (!canAssignSensitiveRoles) {
      setLegacyFoodGroupsMessage('Toto nastavenie moze menit iba ADMIN.')
      setLegacyFoodGroupsMessageType('error')
      return
    }

    setLegacyFoodGroupsLoading(true)
    setLegacyFoodGroupsMessage('')
    setLegacyFoodGroupsMessageType('')

    try {
      const res = await fetch('/api/personalista/app-settings/legacy-bulk-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setLegacyFoodGroupsMessage(json.error || 'Nastavenie sa nepodarilo ulozit.')
        setLegacyFoodGroupsMessageType('error')
        return
      }

      setLegacyFoodGroupsEnabledState(json.enabled === true)
      setLegacyFoodGroupsMessage(json.message || 'Nastavenie bolo ulozene.')
      setLegacyFoodGroupsMessageType('ok')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLegacyFoodGroupsMessage('Chyba spojenia so serverom: ' + message)
      setLegacyFoodGroupsMessageType('error')
    } finally {
      setLegacyFoodGroupsLoading(false)
    }
  }

  const postDetailAction = async (url: string, payload: any, fallbackMessage: string, messageMode: DetailMode = detailMode, method = 'POST') => {
    clearDetailFeedback()
    setDetailMessageMode(messageMode)

    if (!selectedPerson) return false

    if (!canManage) {
      setDetailMessage('Nemáš oprávnenie upravovať osoby.')
      setDetailMessageType('error')
      return false
    }

    setDetailLoading(true)

    try {
      const res = await fetch(url, {
        method,
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
        return false
      }

      if (!res.ok || json.error) {
        setDetailMessage(json.error || fallbackMessage)
        setDetailMessageType('error')
        return false
      }

      const successMessage = json.message || 'Zmena bola uložená.'
      setDetailMessage(successMessage)
      setDetailMessageType('ok')
      if (Array.isArray(json.entitlements)) {
        applyUpdatedPersonEntitlements(selectedPerson.id, json.entitlements)
      }

      preservedDetailMessageRef.current = {
        userId: selectedPerson.id,
        message: successMessage,
        type: 'ok',
        mode: messageMode
      }

      try {
        await reloadPersonDetail(selectedPerson.id)
      } catch (reloadError) {
        const reloadMessage = reloadError instanceof Error ? reloadError.message : String(reloadError)
        setDetailMessage(`${successMessage} Detail sa nepodarilo automaticky obnovit: ${reloadMessage}`)
        setDetailMessageType('ok')
      }

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDetailMessage('Chyba spojenia so serverom: ' + message)
      setDetailMessageType('error')
      return false
    } finally {
      setDetailLoading(false)
    }
  }

  const saveProfile = () => {
    if (!selectedPerson) return

    const originalEmail = String(selectedPerson.email || '').trim().toLowerCase()
    const nextEmail = String(profileForm.email || '').trim().toLowerCase()

    if (originalEmail !== nextEmail) {
      const typedEmail = window.prompt(
        `Menis citlivy udaj - e-mail osoby.\n\nPovodny e-mail: ${selectedPerson.email || '-'}\nNovy e-mail: ${profileForm.email || '-'}\n\nPre potvrdenie napis novy e-mail presne: ${profileForm.email || ''}`
      )

      if (typedEmail === null) return

      if (typedEmail.trim().toLowerCase() !== nextEmail) {
        setDetailFeedback('Email nesedi. Zmena e-mailu nebola ulozena.', 'error', 'profile')
        return
      }

      const ok = window.confirm('Naozaj ulozit zmenu e-mailu? Zmena sa zapise do auditu.')
      if (!ok) return
    }

    postDetailAction(
      '/api/personalista/people/update-profile',
      {
        userId: selectedPerson.id,
        meno: profileForm.meno,
        priezvisko: profileForm.priezvisko,
        email: profileForm.email,
        telefon: profileForm.telefon,
        typStravy: profileForm.typStravy,
        emailChangeConfirmed: originalEmail !== nextEmail
      },
      'Detail osoby sa nepodarilo uložiť.'
    )
  }

  const saveRegistrationGroupPeriod = async () => {
    if (!selectedPerson) return

    if (!registrationPeriodForm.registrationGroupId) {
      setDetailFeedback('Vyber registracnu skupinu.', 'error', 'registrationPeriods')
      return
    }

    if (isBulkRegistrationPeriodEdit) {
      const items = selectedRegistrationPeriodSelectionRows.map(row => (
        row.type === 'period'
          ? {
            periodId: row.period.id,
            validFrom: row.period.validFrom,
            validTo: row.period.validTo || ''
          }
          : {
            periodId: '',
            validFrom: row.validFrom,
            validTo: row.validTo
          }
      ))

      if (items.length === 0) {
        setDetailFeedback('Oznac obdobia, ktore chces upravit.', 'error', 'registrationPeriods')
        return
      }

      const saved = await postDetailAction(
        '/api/personalista/people/registration-periods',
        {
          userId: selectedPerson.id,
          registrationGroupId: registrationPeriodForm.registrationGroupId,
          note: registrationPeriodForm.note,
          items
        },
        'Oznacene zaradenia sa nepodarilo ulozit.',
        'registrationPeriods',
        'PATCH'
      )

      if (saved) {
        setSelectedRegistrationPeriodKeys([])
        setRegistrationPeriodForm(defaultRegistrationPeriodForm(selectedPerson))
      }
      return
    }

    if (!registrationPeriodForm.validFrom) {
      setDetailFeedback('Vyber datum od.', 'error', 'registrationPeriods')
      return
    }

    if (registrationPeriodForm.validTo && registrationPeriodForm.validTo < registrationPeriodForm.validFrom) {
      setDetailFeedback('Datum do nemoze byt pred datumom od.', 'error', 'registrationPeriods')
      return
    }

    const overlapsRegistrationPeriod = registrationPeriodsOverlap(
      selectedPerson.registrationGroupPeriods,
      registrationPeriodForm.validFrom,
      registrationPeriodForm.validTo,
      registrationPeriodForm.periodId
    )

    if (overlapsRegistrationPeriod && !canAutoCloseOpenEndedRegistrationPeriod(
      selectedPerson.registrationGroupPeriods,
      registrationPeriodForm.validFrom,
      registrationPeriodForm.validTo,
      registrationPeriodForm.periodId
    )) {
      setDetailFeedback(
        'Obdobie sa prekryva s existujucim zaradenim. V jeden den moze platit iba jedna registracna skupina.',
        'error',
        'registrationPeriods'
      )
      return
    }

    const saved = await postDetailAction(
      '/api/personalista/people/registration-periods',
      {
        userId: selectedPerson.id,
        ...registrationPeriodForm
      },
      'Zaradenie sa nepodarilo ulozit.',
      'registrationPeriods',
      registrationPeriodForm.periodId ? 'PATCH' : 'POST'
    )

    if (saved) {
      setRegistrationPeriodForm(defaultRegistrationPeriodForm(selectedPerson))
    }
  }

  const editRegistrationGroupPeriod = (period: PersonRegistrationGroupPeriod) => {
    setSelectedRegistrationPeriodKeys([`period-${period.id}`])
    setRegistrationPeriodForm({
      periodId: period.id,
      registrationGroupId: period.registrationGroupId,
      validFrom: period.validFrom,
      validTo: period.validTo || '',
      note: period.note || ''
    })
    setDetailFeedback(
      `Upravujes zaradenie ${period.registrationGroupName || '-'} (${fullDateLabel(period.validFrom)} - ${period.validTo ? fullDateLabel(period.validTo) : 'bez konca'}).`,
      'ok',
      'registrationPeriods'
    )
  }

  const editPendingReviewRegistrationPeriod = (period: PersonRegistrationGroupPeriod) => {
    setSelectedRegistrationPeriodKeys([])
    setRegistrationPeriodForm({
      periodId: period.id,
      registrationGroupId: period.registrationGroupId,
      validFrom: period.validFrom,
      validTo: period.validTo || '',
      note: period.note || ''
    })
    setDetailFeedback(
      `Upravujes zaradenie ${period.registrationGroupName || '-'} (${fullDateLabel(period.validFrom)} - ${period.validTo ? fullDateLabel(period.validTo) : 'bez konca'}).`,
      'ok',
      ''
    )
  }

  const toggleRegistrationPeriodSelection = (row: RegistrationPeriodSelectionRow) => {
    const nextKeys = selectedRegistrationPeriodKeys.includes(row.key)
      ? selectedRegistrationPeriodKeys.filter(key => key !== row.key)
      : [...selectedRegistrationPeriodKeys, row.key]

    setSelectedRegistrationPeriodKeys(nextKeys)

    const nextRows = selectedRegistrationPeriodRows.filter(item => nextKeys.includes(item.key))

    if (nextRows.length === 0) {
      setRegistrationPeriodForm(defaultRegistrationPeriodForm(selectedPerson))
      clearDetailFeedback()
      return
    }

    if (nextRows.length === 1) {
      const selectedRow = nextRows[0]

      if (selectedRow.type === 'period') {
        setRegistrationPeriodForm({
          periodId: selectedRow.period.id,
          registrationGroupId: selectedRow.period.registrationGroupId,
          validFrom: selectedRow.period.validFrom,
          validTo: selectedRow.period.validTo || '',
          note: selectedRow.period.note || ''
        })
        setDetailFeedback('Oznacene je jedno zaradenie. Mozes upravit skupinu, datumy aj poznamku.', 'ok', 'registrationPeriods')
        return
      }

      setRegistrationPeriodForm({
        periodId: '',
        registrationGroupId: '',
        validFrom: selectedRow.validFrom,
        validTo: selectedRow.validTo,
        note: ''
      })
      setDetailFeedback('Nezaradene obdobie je pripravene. Vyber registracnu skupinu a uloz zaradenie.', 'ok', 'registrationPeriods')
      return
    }

    setRegistrationPeriodForm(prev => ({
      ...prev,
      periodId: '',
      validFrom: '',
      validTo: ''
    }))
    setDetailFeedback('Oznacenych je viac obdobi. Upravuje sa iba registracna skupina a poznamka, datumy ostanu povodne.', 'ok', 'registrationPeriods')
  }

  const resetRegistrationGroupPeriodForm = () => {
    setRegistrationPeriodForm(defaultRegistrationPeriodForm(selectedPerson))
    setSelectedRegistrationPeriodKeys([])
    clearDetailFeedback()
  }

  const deleteRegistrationGroupPeriod = (period: PersonRegistrationGroupPeriod) => {
    if (!selectedPerson) return

    const label = `${period.registrationGroupName || 'registracne zaradenie'} (${fullDateLabel(period.validFrom)} - ${period.validTo ? fullDateLabel(period.validTo) : 'bez konca'})`
    const ok = window.confirm(`Vymazat zaradenie ${label}? Naroky na stravu sa nezmenia.`)
    if (!ok) return

    postDetailAction(
      '/api/personalista/people/registration-periods',
      {
        userId: selectedPerson.id,
        periodId: period.id
      },
      'Zaradenie sa nepodarilo vymazat.',
      'registrationPeriods',
      'DELETE'
    )
  }

  const addRegistrationGroupManager = async () => {
    if (!selectedPerson) return

    if (!registrationGroupAccessForm.registrationGroupId) {
      setDetailFeedback('Vyber registracnu skupinu pre managera registracnej skupiny.', 'error', 'registrationPeriods')
      return
    }

    const saved = await postDetailAction(
      '/api/personalista/people/registration-group-managers',
      {
        userId: selectedPerson.id,
        registrationGroupId: registrationGroupAccessForm.registrationGroupId
      },
      'Managera registracnej skupiny sa nepodarilo pridat.',
      'registrationPeriods'
    )

    if (saved) {
      setRegistrationGroupAccessForm({ registrationGroupId: '' })
    }
  }

  const removeRegistrationGroupManager = (manager: RegistrationGroupAccess) => {
    if (!selectedPerson) return

    const ok = window.confirm(`Odobrat opravnenie na skupinovy vydaj pre ${manager.registrationGroupName || 'registracnu skupinu'}?`)
    if (!ok) return

    postDetailAction(
      '/api/personalista/people/registration-group-managers',
      {
        userId: selectedPerson.id,
        managerId: manager.id
      },
      'Managera registracnej skupiny sa nepodarilo odobrat.',
      'registrationPeriods',
      'DELETE'
    )
  }

  const addRegistrationGroupDelegate = async () => {
    if (!selectedPerson) return

    if (!registrationGroupAccessForm.registrationGroupId) {
      setDetailFeedback('Vyber registracnu skupinu pre poverenu osobu.', 'error', 'registrationPeriods')
      return
    }

    const saved = await postDetailAction(
      '/api/personalista/people/registration-group-delegates',
      {
        userId: selectedPerson.id,
        registrationGroupId: registrationGroupAccessForm.registrationGroupId
      },
      'Poverenu osobu sa nepodarilo pridat.',
      'registrationPeriods'
    )

    if (saved) {
      setRegistrationGroupAccessForm({ registrationGroupId: '' })
    }
  }

  const removeRegistrationGroupDelegate = (delegate: RegistrationGroupAccess) => {
    if (!selectedPerson) return

    const ok = window.confirm(`Odobrat poverenie pre ${delegate.registrationGroupName || 'registracnu skupinu'}?`)
    if (!ok) return

    postDetailAction(
      '/api/personalista/people/registration-group-delegates',
      {
        userId: selectedPerson.id,
        delegateId: delegate.id
      },
      'Poverenu osobu sa nepodarilo odobrat.',
      'registrationPeriods',
      'DELETE'
    )
  }

  const preparePendingReviewEntitlements = (periods: PersonRegistrationGroupPeriod[]) => {
    const dates = datesFromRegistrationPeriods(periods)

    if (dates.length === 0) {
      setDetailFeedback('Najprv ulož platné zaradenie od-do.', 'error', '')
      return
    }

    const bounds = boundsFromDates(dates, fromDate, toDate)
    const nextCalendarClaims = { ...calendarClaims }
    const addedObed: string[] = []
    const addedVecera: string[] = []

    dates.forEach(date => {
      const current = nextCalendarClaims[date] || { obed: false, vecera: false }

      if (!current.obed) addedObed.push(date)
      if (!current.vecera) addedVecera.push(date)

      nextCalendarClaims[date] = {
        obed: true,
        vecera: true
      }
    })

    setCalendarClaims(nextCalendarClaims)
    setBulkEntitlementClaims(prev => ({
      obed: Array.from(new Set([...prev.obed, ...addedObed])),
      vecera: Array.from(new Set([...prev.vecera, ...addedVecera]))
    }))
    setEntitlementForm({
      validFrom: bounds.validFrom,
      validTo: bounds.validTo,
      obed: true,
      vecera: true
    })
    setPendingReviewOpenStep(2)
    setDetailMode('')
    setDetailFeedback(`Nároky sú pripravené pre ${dates.length} dní. Skontroluj dni, obed a večeru, potom ulož nároky.`, 'ok', '')
  }

  const savePendingReviewRegistrationPeriod = async () => {
    if (!selectedPerson) return

    if (!registrationPeriodForm.registrationGroupId) {
      setDetailFeedback('Vyber registračnú skupinu.', 'error', '')
      return
    }

    if (!registrationPeriodForm.validFrom || !registrationPeriodForm.validTo) {
      setDetailFeedback('Pri kontrole registrácie musí byť vyplnený dátum od aj dátum do.', 'error', '')
      return
    }

    if (registrationPeriodForm.validTo < registrationPeriodForm.validFrom) {
      setDetailFeedback('Dátum do nemôže byť pred dátumom od.', 'error', '')
      return
    }

    if (registrationPeriodsOverlap(
      selectedPerson.registrationGroupPeriods,
      registrationPeriodForm.validFrom,
      registrationPeriodForm.validTo,
      registrationPeriodForm.periodId
    )) {
      setDetailFeedback(
        'Obdobie sa prekryva s existujucim zaradenim. V jeden den moze platit iba jedna registracna skupina.',
        'error',
        ''
      )
      return
    }

    setPendingReviewAction('period')

    const saved = await postDetailAction(
      '/api/personalista/people/registration-periods',
      {
        userId: selectedPerson.id,
        periodId: registrationPeriodForm.periodId,
        registrationGroupId: registrationPeriodForm.registrationGroupId,
        validFrom: registrationPeriodForm.validFrom,
        validTo: registrationPeriodForm.validTo,
        note: registrationPeriodForm.note
      },
      'Zaradenie pri kontrole registrácie sa nepodarilo uložiť.',
      '',
      registrationPeriodForm.periodId ? 'PATCH' : 'POST'
    )

    setPendingReviewAction('')

    if (saved) {
      const selectedRegistrationGroup = registrationGroups.find(group => group.id === registrationPeriodForm.registrationGroupId) || null
      const savedPeriod: PersonRegistrationGroupPeriod = {
        id: registrationPeriodForm.periodId || `pending-${registrationPeriodForm.validFrom}-${registrationPeriodForm.registrationGroupId}`,
        registrationGroupId: registrationPeriodForm.registrationGroupId,
        registrationGroupName: selectedRegistrationGroup?.name || '',
        validFrom: registrationPeriodForm.validFrom,
        validTo: registrationPeriodForm.validTo,
        note: registrationPeriodForm.note
      }
      const nextPeriods = [
        ...selectedPerson.registrationGroupPeriods.filter(period => period.id !== registrationPeriodForm.periodId),
        savedPeriod
      ]

      setRegistrationPeriodForm(defaultRegistrationPeriodForm({
        ...selectedPerson,
        registrationGroupPeriods: nextPeriods
      }))
      setPendingReviewOpenStep(2)
      preparePendingReviewEntitlements(nextPeriods)
    }
  }

  const approveRegistration = async () => {
    if (!selectedPerson) return

    if (pendingReviewBoundedPeriods.length === 0) {
      setDetailFeedback('Najprv ulož zaradenie do registračnej skupiny s dátumom od aj do.', 'error', '')
      return
    }

    if (pendingReviewEntitlements.length === 0) {
      setDetailFeedback('Najprv ulož nároky na stravu pre zadané obdobie.', 'error', '')
      return
    }

    const ok = window.confirm('Dokončiť kontrolu registrácie a priradiť prvý voľný QR kód?')
    if (!ok) return

    setPendingReviewAction('approve')

    await postDetailAction(
      '/api/personalista/people/approve-registration',
      {
        userId: selectedPerson.id
      },
      'Registráciu sa nepodarilo dokončiť.',
      ''
    )

    setPendingReviewAction('')
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
      if (json.group?.id) {
        selectManagedRegistrationGroup(json.group.id)
      }
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

    if (bulkRegistrationEntitlementsForm.mode === 'SET' && !bulkRegistrationEntitlementsForm.obed && !bulkRegistrationEntitlementsForm.vecera) {
      setBulkRegistrationEntitlementsMessage('Vyber obed alebo veceru.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    const dayClaims = Object.entries(bulkRegistrationCalendarClaims)
      .filter(([date]) => bulkRegistrationCalendarDates.includes(date))
      .map(([datum, claim]) => ({
        datum,
        obed: claim.obed,
        vecera: claim.vecera
      }))
      .filter(item => item.obed || item.vecera)
      .sort((a, b) => a.datum.localeCompare(b.datum))

    if (bulkRegistrationEntitlementsForm.mode === 'DATES' && dayClaims.length === 0) {
      setBulkRegistrationEntitlementsMessage('Vyber aspon jeden den v kalendari.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    const groupName = selectedBulkRegistrationGroup?.name || 'vybrana registracna skupina'
    const confirmMessage = bulkRegistrationEntitlementsForm.mode === 'CLEAR'
      ? `Vymazu sa naroky v obdobi ${bulkRegistrationEntitlementsForm.validFrom} - ${bulkRegistrationEntitlementsForm.validTo} pre ${selectedBulkRegistrationGroupPeopleCount} osob v registracnej skupine ${groupName}. Pokracovat?`
      : bulkRegistrationEntitlementsForm.mode === 'DATES'
        ? `Podla kalendara sa prepise obdobie ${bulkRegistrationEntitlementsForm.validFrom} - ${bulkRegistrationEntitlementsForm.validTo} pre ${selectedBulkRegistrationGroupPeopleCount} osob v registracnej skupine ${groupName}. Pokracovat?`
        : `Prepise sa obdobie ${bulkRegistrationEntitlementsForm.validFrom} - ${bulkRegistrationEntitlementsForm.validTo} pre ${selectedBulkRegistrationGroupPeopleCount} osob v registracnej skupine ${groupName}. Pokracovat?`
    const ok = window.confirm(confirmMessage)

    if (!ok) return

    setBulkRegistrationEntitlementsLoading(true)
    setBulkRegistrationEntitlementsMessage('')
    setBulkRegistrationEntitlementsMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...bulkRegistrationEntitlementsForm,
          dayClaims
        })
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

  const clearAllBulkRegistrationEntitlements = async () => {
    if (!bulkRegistrationEntitlementsForm.registrationGroupId) {
      setBulkRegistrationEntitlementsMessage('Vyber registracnu skupinu.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    const groupName = selectedBulkRegistrationGroup?.name || 'vybrana registracna skupina'
    const typedGroupName = window.prompt(
      `Tato akcia vymaze VSETKY existujuce naroky bez ohladu na datum pre ${selectedBulkRegistrationGroupAllPeopleCount} osob v registracnej skupine ${groupName}.\n\nPre potvrdenie napis nazov skupiny: ${groupName}`
    )

    if (typedGroupName === null) return

    if (typedGroupName.trim() !== groupName.trim()) {
      setBulkRegistrationEntitlementsMessage('Nazov skupiny nesedi. Vymazanie nebolo spustene.')
      setBulkRegistrationEntitlementsMessageType('error')
      return
    }

    const ok = window.confirm(
      `Naozaj vymazat vsetky existujuce naroky registracnej skupiny ${groupName}? Tato akcia nepouzije datumove obdobie.`
    )

    if (!ok) return

    setBulkRegistrationEntitlementsLoading(true)
    setBulkRegistrationEntitlementsMessage('')
    setBulkRegistrationEntitlementsMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: bulkRegistrationEntitlementsForm.registrationGroupId,
          mode: 'CLEAR_ALL',
          activeOnly: false
        })
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setBulkRegistrationEntitlementsMessage(json.error || 'Vsetky naroky skupiny sa nepodarilo vymazat.')
        setBulkRegistrationEntitlementsMessageType('error')
        return
      }

      setBulkRegistrationEntitlementsMessage(json.message || 'Vsetky naroky skupiny boli vymazane.')
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

    if (!registrationAssignmentForm.validFrom) {
      setRegistrationAssignmentMessage('Vyber datum od.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    if (registrationAssignmentForm.validTo && registrationAssignmentForm.validTo < registrationAssignmentForm.validFrom) {
      setRegistrationAssignmentMessage('Datum do nemoze byt pred datumom od.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    const groupName = selectedRegistrationAssignmentGroup?.name || 'vybrana registracna skupina'
    const periodLabel = registrationAssignmentForm.validTo
      ? `${registrationAssignmentForm.validFrom} - ${registrationAssignmentForm.validTo}`
      : `${registrationAssignmentForm.validFrom} - bez konca`
    const ok = window.confirm(
      `Priradit ${registrationAssignmentForm.userIds.length} osob do registracnej skupiny ${groupName} na obdobie ${periodLabel}? Ak maju otvorene predchadzajuce zaradenie, ukonci sa den pred novym zaciatkom. Naroky sa nezmenia.`
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

  const clearSelectedRegistrationAssignments = async () => {
    if (registrationAssignmentForm.userIds.length === 0) {
      setRegistrationAssignmentMessage('Vyber aspon jednu osobu.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    const typed = window.prompt(
      `Tato akcia vymaze vsetky casove zaradenia v registracnych skupinach pre ${registrationAssignmentForm.userIds.length} vybranych osob.\n\nNaroky na stravu sa nezmenia.\n\nPre potvrdenie napis VYMAZAT`
    )

    if (typed === null) return

    if (typed.trim().toUpperCase() !== 'VYMAZAT') {
      setRegistrationAssignmentMessage('Potvrdenie nesedi. Vymazanie nebolo spustene.')
      setRegistrationAssignmentMessageType('error')
      return
    }

    setRegistrationAssignmentLoading(true)
    setRegistrationAssignmentMessage('')
    setRegistrationAssignmentMessageType('')

    try {
      const res = await fetch('/api/personalista/registration-groups/assign-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CLEAR_PERIODS',
          userIds: registrationAssignmentForm.userIds
        })
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok || json.error) {
        setRegistrationAssignmentMessage(json.error || 'Zaradenia sa nepodarilo vymazat.')
        setRegistrationAssignmentMessageType('error')
        return
      }

      setRegistrationAssignmentMessage(json.message || 'Zaradenia boli vymazane.')
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
    const visibleDates = new Set(visibleEntitlementCalendarDates)

    setBulkEntitlementClaims(prev => ({
      obed: prev.obed.filter(date => !visibleDates.has(date)),
      vecera: prev.vecera.filter(date => !visibleDates.has(date))
    }))

    setCalendarClaims(prev => {
      const next = { ...prev }

      visibleEntitlementCalendarDates.forEach(date => {
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

  const openEntitlementsFromRegistrationPeriod = () => {
    if (!selectedPerson) return

    const today = isoDateOffset(0)
    const selectedRows = selectedRegistrationPeriodRows.filter(row => selectedRegistrationPeriodKeySet.has(row.key))

    if (selectedRows.length === 0) {
      setDetailFeedback('Najprv oznac jedno alebo viac obdobi.', 'error', 'registrationPeriods')
      return
    }

    let skippedPast = 0
    const datesToPrepare = new Set<string>()

    selectedRows.forEach(row => {
      const sourceFrom = row.type === 'period' ? row.period.validFrom : row.validFrom
      const sourceTo = row.type === 'period' ? row.period.validTo || toDate : row.validTo

      if (!sourceFrom || !sourceTo || sourceTo < sourceFrom) return

      if (sourceTo < today) {
        skippedPast += 1
        return
      }

      if (sourceFrom < today) skippedPast += 1

      dateRangeIso(sourceFrom < today ? today : sourceFrom, sourceTo)
        .forEach(date => datesToPrepare.add(date))
    })

    const dates = Array.from(datesToPrepare).sort()

    if (dates.length === 0) {
      setDetailFeedback('Medzi oznacenymi obdobiami nie je ziadne obdobie od dnes dalej. Minule obdobia nie je mozne zmenit.', 'error', 'registrationPeriods')
      return
    }

    const validFrom = dates[0]
    const validTo = dates[dates.length - 1]
    const addedObed: string[] = []
    const addedVecera: string[] = []
    const nextCalendarClaims = { ...calendarClaims }

    dates.forEach(date => {
      const current = nextCalendarClaims[date] || { obed: false, vecera: false }

      if (!current.obed) addedObed.push(date)
      if (!current.vecera) addedVecera.push(date)

      nextCalendarClaims[date] = {
        obed: true,
        vecera: true
      }
    })

    setCalendarClaims(nextCalendarClaims)
    setBulkEntitlementClaims(prev => ({
      obed: Array.from(new Set([...prev.obed, ...addedObed])),
      vecera: Array.from(new Set([...prev.vecera, ...addedVecera]))
    }))
    setEntitlementForm({
      validFrom,
      validTo,
      obed: true,
      vecera: true
    })
    setDetailFeedback(
      `${skippedPast > 0 ? 'Minule obdobia nie je mozne zmenit. ' : ''}Naroky boli pripravene pre ${dates.length} dni. Skontroluj oranzove zmeny a uloz naroky.`,
      'ok',
      'entitlements'
    )
    setDetailMode('entitlements')
  }

  const saveSelectedEntitlementDates = async () => {
    if (!selectedPerson) return

    const changedDates = visibleEntitlementCalendarDates.filter(date => {
      const saved = entitlementByDate.get(date) || { obed: false, vecera: false }
      const claim = calendarClaims[date] || { obed: false, vecera: false }

      return claim.obed !== saved.obed || claim.vecera !== saved.vecera
    })
    const dayClaims = changedDates
      .map(datum => {
        const claim = calendarClaims[datum] || { obed: false, vecera: false }

        return {
          datum,
          obed: claim.obed,
          vecera: claim.vecera
        }
      })
      .filter(item => item.obed || item.vecera)
      .sort((a, b) => a.datum.localeCompare(b.datum))

    if (changedDates.length === 0) {
      setDetailFeedback('Nie je ziadna zmena narokov na ulozenie.', 'ok', 'entitlements')
      return
    }

    if (dayClaims.length === 0) {
      const ok = window.confirm('V zmenenych dnoch nie je vybrany ziaden narok. Vymazat tieto zmenene dni?')
      if (!ok) return
    }

    const today = isoDateOffset(0)
    const changesPastEntitlements = changedDates.some(date => date < today)

    if (changesPastEntitlements) {
      const ok = window.confirm('Pokúšaš sa uložiť nárok do minulosti. Naozaj chceš tieto nároky uložiť?')
      if (!ok) return
    }

    const validFrom = changedDates[0]
    const validTo = changedDates[changedDates.length - 1]

    if (selectedPersonPendingReview) {
      setPendingReviewAction('entitlements')
    }

    const saved = await postDetailAction(
      '/api/personalista/people/update-entitlements',
      {
        userId: selectedPerson.id,
        mode: 'DATES',
        validFrom,
        validTo,
        dates: changedDates,
        dayClaims
      },
      'Nároky podľa kalendára sa nepodarilo uložiť.'
    )

    if (selectedPersonPendingReview) {
      setPendingReviewAction('')
      if (saved) setPendingReviewOpenStep(3)
    }
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
      setDetailFeedback('Vyber skupinu.', 'error', 'groups')
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

  const createGroupForSelectedPerson = async () => {
    if (!selectedPerson) return

    const name = String(groupForm.newGroupName || '').trim().replace(/\s+/g, ' ')

    if (name.length < 2) {
      setDetailFeedback('Zadaj názov stravovacej skupiny.', 'error', 'groups')
      return
    }

    if (name.length > 80) {
      setDetailFeedback('Názov stravovacej skupiny môže mať najviac 80 znakov.', 'error', 'groups')
      return
    }

    setDetailLoading(true)
    clearDetailFeedback()

    try {
      const createRes = await fetch('/api/group/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      const createJson = await createRes.json().catch(() => ({}))

      if (!createRes.ok || createJson.error || !createJson.group?.id) {
        setDetailFeedback(createJson.error || 'Stravovaciu skupinu sa nepodarilo vytvoriť.', 'error', 'groups')
        return
      }

      const addRes = await fetch('/api/personalista/people/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedPerson.id,
          action: selectedPerson.id === currentUserId ? 'UPDATE_ROLE' : 'ADD',
          groupId: createJson.group.id,
          role: groupForm.role
        })
      })
      const addJson = await addRes.json().catch(() => ({}))

      if (!addRes.ok || addJson.error) {
        setDetailFeedback(addJson.error || 'Osobu sa nepodarilo pridať do novej skupiny.', 'error', 'groups')
        return
      }

      setGroupForm(prev => ({
        ...prev,
        groupId: '',
        newGroupName: ''
      }))
      preservedDetailMessageRef.current = {
        userId: selectedPerson.id,
        message: `Stravovacia skupina ${name} bola vytvorená a osoba bola pridaná.`,
        type: 'ok',
        mode: 'groups'
      }
      await reloadPersonDetail(selectedPerson.id)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDetailFeedback('Chyba spojenia so serverom: ' + message, 'error', 'groups')
    } finally {
      setDetailLoading(false)
    }
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
      setDetailFeedback('Email nesedi. Odregistrovanie nebolo spustene.', 'error', 'roles')
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
      ...(roleForm.groupCreator ? ['GROUP_CREATOR'] : []),
      ...(roleForm.wristbandKiosk ? ['WRISTBAND_KIOSK'] : []),
      ...(roleForm.menuKiosk ? ['MENU_KIOSK'] : []),
      ...(roleForm.offlineObsluha ? ['OFFLINE_OBSLUHA'] : []),
      ...(roleForm.selfOrderingMeal ? ['SAMOSTATNE_OBJEDNAVANIE_STRAVY'] : []),
      ...(roleForm.adminRegSkupiny ? ['ADMIN_REG_SKUPINY'] : [])
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

  const renderDateInput = (
    value: string,
    onChange: (value: string) => void,
    disabled: boolean,
    placeholder = 'Vyber datum'
  ) => {
    if (!isMobile) {
      return (
        <input
          type="date"
          value={value}
          onChange={event => onChange(event.target.value)}
          style={styles.input}
          disabled={disabled}
        />
      )
    }

    return (
      <div style={styles.mobileDateControl}>
        <span style={styles.mobileDateValue}>
          {value ? fullDateLabel(value) : placeholder}
        </span>

        <input
          type="date"
          value={value}
          onChange={event => onChange(event.target.value)}
          style={styles.mobileDateNativeInput}
          disabled={disabled}
          aria-label={placeholder}
        />
      </div>
    )
  }

  return (
    <main className="personalista-page" style={styles.page}>
      <style jsx global>{`
        .personalista-page button,
        .personalista-page a[href] {
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(37, 99, 235, 0.22);
        }

        .personalista-page button:not(:disabled):active,
        .personalista-page a[href]:active {
          transform: scale(0.97);
          filter: brightness(0.93);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.22);
        }

        .personalista-page button:disabled {
          cursor: wait;
        }

      `}</style>
      <header style={{
        ...styles.header,
        ...(isMobile ? styles.mobileHeader : {}),
        ...(showMobilePersonDetail ? styles.mobileHiddenListColumn : {})
      }}>
        <div>
          <div style={styles.breadcrumb}>Prehlad / Personalistika</div>
          <h1 style={styles.title}>Personalistika</h1>
          <p style={styles.subtitle}>
            {peopleScope === 'all' ? 'Vsetky posledne upravene osoby' : 'Moje posledne upravene osoby'}, registracne skupiny, QR a naroky.
          </p>
        </div>

        <div style={{
          ...styles.headerActions,
          ...(isMobile ? styles.mobileActionStrip : {})
        }}>
          <div style={styles.currentUserPill}>
            <span style={styles.currentUserLabel}>Prihlaseny</span>
            <b style={styles.currentUserName}>{currentUserName}</b>
            <small style={styles.currentUserRole}>{currentUserRoleLabel}</small>
          </div>

          <a href="/dashboard" style={styles.darkButton}>
            Späť na prehľad
          </a>
        </div>
      </header>

      {!showMobilePersonDetail && !canManage && (
        <section style={styles.warningBox}>
          Na túto obrazovku potrebuješ rolu ADMIN alebo PERSONALISTA.
        </section>
      )}

      {!showMobilePersonDetail && (
      <section style={{
        ...styles.summaryGrid,
        ...(isMobile ? styles.mobileSummaryStrip : {})
      }}>
        <div style={styles.summaryCard}>
          <b>{stats.meals.obed.total + stats.meals.vecera.total}</b>
          <span>Dnešné nároky</span>
          <small>Obed {stats.meals.obed.total} / Večer {stats.meals.vecera.total}</small>
        </div>

        <div style={styles.summaryCardOrange}>
          <b>{stats.meals.obed.total}</b>
          <span>Obed dnes</span>
          <small>MASO {stats.meals.obed.MASO} / VEGE {stats.meals.obed.VEGE} / DIÉTA {stats.meals.obed.DIETA}</small>
        </div>

        <div style={styles.summaryCardPink}>
          <b>{stats.meals.vecera.total}</b>
          <span>Večera dnes</span>
          <small>MASO {stats.meals.vecera.MASO} / VEGE {stats.meals.vecera.VEGE} / DIÉTA {stats.meals.vecera.DIETA}</small>
        </div>

        <div style={styles.summaryCardBlue}>
          <b>{stats.activeQr}</b>
          <span>Aktívne QR</span>
          <small>Bez QR {stats.withoutQr}</small>
        </div>

        <div style={styles.summaryCardGreen}>
          <b>{stats.registrationGroups}</b>
          <span>Registračné skupiny</span>
        </div>

        <div style={styles.summaryCardYellow}>
          <b>{stats.pendingReview}</b>
          <span>Na schválenie</span>
        </div>

        <div style={styles.summaryCardRed}>
          <b>{stats.blocked}</b>
          <span>Blokovaní</span>
        </div>
      </section>
      )}

      {!showMobilePersonDetail && (
      <section style={{
        ...styles.actionPanel,
        ...(isMobile ? styles.mobileActionStripPanel : {})
      }}>
        <div style={styles.toolbarStartGroup}>
          <div style={styles.iconActionGroup}>
            <button
              type="button"
              style={styles.iconActionButton}
              title="Domov - posledné upravené osoby"
              aria-label="Domov - posledné upravené osoby"
              onClick={resetPersonalistaHome}
            >
              <HomeIcon />
            </button>

            <button
              type="button"
              style={{
                ...styles.iconActionButton,
                opacity: refreshingPeople ? 0.65 : 1,
                cursor: refreshingPeople ? 'wait' : 'pointer'
              }}
              title="Obnoviť personalistiku"
              aria-label="Obnoviť personalistiku"
              disabled={refreshingPeople}
              onClick={refreshPersonalistaData}
            >
              <RefreshIcon />
            </button>
          </div>

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
              setRegistrationGroupsOpen(false)
              setPrintQrOpen(false)
              setQrRulesOpen(false)
              setPersonnelTool('')
              setCreateMessage('')
              setCreateMessageType('')
            }}
          >
            Ručne pridať človeka
          </button>
        </div>

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

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            const next = personnelTool === 'communication' ? '' : 'communication'
            closeTopPanels()
            setPersonnelTool(next)
            setCommunicationMessage('')
            setCommunicationMessageType('')
          }}
        >
          Komunikacia
        </button>

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            const next = personnelTool === 'accessCodes' ? '' : 'accessCodes'
            closeTopPanels()
            setPersonnelTool(next)
            setAccessCodesMessage('')
            setAccessCodesMessageType('')
          }}
        >
          Pristupy a QR
        </button>

        <button
          type="button"
          style={styles.lightButton}
          disabled={!canManage}
          onClick={() => {
            const next = personnelTool === 'registrationGroupManagers' ? '' : 'registrationGroupManagers'
            closeTopPanels()
            setPersonnelTool(next)
            setManagerOverviewMessage('')
            setManagerOverviewMessageType('')
          }}
        >
          Manageri skupin
        </button>

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
            setCreateOpen(false)
            setPrintQrOpen(false)
            setQrRulesOpen(false)
            setPersonnelTool('')
            setRegistrationGroupMessage('')
            setRegistrationGroupMessageType('')
          }}
        >
          Registracne skupiny
        </button>

        <button
          type="button"
          style={{
            ...styles.lightButton,
            ...(stats.pendingReview > 0 ? styles.pendingReviewButton : {})
          }}
          onClick={() => {
            closeTopPanels()
            setSearch('')
            setRegistrationGroupFilter('ALL')
            setStatusFilter('PENDING_REVIEW')
            setSelectedPersonId('')
          }}
        >
          Na schvalenie ({stats.pendingReview})
        </button>

        <button
          type="button"
          style={{
            ...styles.lightButton,
            ...styles.blockedButton
          }}
          onClick={() => {
            closeTopPanels()
            setSearch('')
            setRegistrationGroupFilter('ALL')
            setStatusFilter('BLOCKED')
            setSelectedPersonId('')
          }}
        >
          Blokovaní ({stats.blocked})
        </button>

        <button
          type="button"
          style={styles.lightButton}
          onClick={() => {
            setPrintQrOpen(prev => !prev)
            setCreateOpen(false)
            setRegistrationGroupsOpen(false)
            setQrRulesOpen(false)
            setPersonnelTool('')
          }}
        >
          Tlac QR skupiny
        </button>

        {canAssignSensitiveRoles && (
          <button
            type="button"
            style={styles.lightButton}
            onClick={() => {
              setQrRulesOpen(prev => !prev)
              setCreateOpen(false)
              setRegistrationGroupsOpen(false)
              setPrintQrOpen(false)
              setLegacyFoodGroupsOpen(false)
              setPersonnelTool('')
              setQrRulesMessage('')
              setQrRulesMessageType('')
            }}
          >
            Pravidla QR naramkov
          </button>
        )}

        {canAssignSensitiveRoles && (
          <button
            type="button"
            style={styles.lightButton}
            disabled={legacyFoodGroupsLoading}
            onClick={() => {
              setLegacyFoodGroupsOpen(prev => !prev)
              setCreateOpen(false)
              setRegistrationGroupsOpen(false)
              setPrintQrOpen(false)
              setQrRulesOpen(false)
              setPersonnelTool('')
              setLegacyFoodGroupsMessage('')
              setLegacyFoodGroupsMessageType('')
            }}
          >
            Starý hromadný výdaj
          </button>
        )}

        {canViewAllPeople && (
          <div style={styles.scopeToggle}>
            <a
              href="/dashboard/personalista"
              style={{
                ...styles.scopeToggleButton,
                ...(peopleScope === 'mine' ? styles.scopeToggleButtonActive : {})
              }}
            >
              Moje upravy
            </a>

            <a
              href="/dashboard/personalista?scope=all"
              style={{
                ...styles.scopeToggleButton,
                ...(peopleScope === 'all' ? styles.scopeToggleButtonActive : {})
              }}
            >
              Vsetky
            </a>
          </div>
        )}

        <button type="button" style={{ display: 'none' }} disabled>
          QR/NFC párovanie
        </button>
      </section>
      )}

      {!showMobilePersonDetail && personnelTool === 'communication' && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Komunikácia</b>
              <span>Uvítacie e-maily sa posielajú postupne po dávkach 50 ľudí.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={communicationLoading}
              onClick={() => setPersonnelTool('')}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Jazyk e-mailu</span>
              <select
                value={communicationLanguage}
                onChange={event => setCommunicationLanguage(event.target.value === 'EN' ? 'EN' : 'SK')}
                style={styles.input}
                disabled={communicationLoading}
              >
                <option value="SK">Slovencina</option>
                <option value="EN">English</option>
              </select>
            </label>

            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={communicationGroupId}
                onChange={event => {
                  setCommunicationGroupId(event.target.value)
                  setCommunicationSummary(null)
                }}
                style={styles.input}
                disabled={communicationLoading}
              >
                <option value="">Vsetky registracne skupiny</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>

            <label style={{ ...styles.field, alignSelf: 'end' }}>
              <span>Rezim odoslania</span>
              <button
                type="button"
                style={communicationWelcomeResend ? styles.confirmButton : styles.lightButton}
                disabled={communicationLoading}
                onClick={() => setCommunicationWelcomeResend(prev => !prev)}
              >
                {communicationWelcomeResend ? 'Odoslat aj znova' : 'Len neposlane'}
              </button>
            </label>
          </div>

          <div style={styles.toolActionRow}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={communicationLoading}
              onClick={() => void loadCommunicationSummary(communicationGroupId, 'communication')}
            >
              Načítať stav
            </button>

            <button
              type="button"
              style={styles.confirmButton}
              disabled={communicationLoading || (!communicationWelcomeResend && !communicationSummary?.welcomePending) || (communicationWelcomeResend && !communicationSummary?.withEmail)}
              onClick={() => void sendWelcomeEmailsForGroup()}
            >
              Odoslať ďalšiu dávku 50
            </button>

          </div>

          <div style={styles.communicationResendBox}>
            <div style={styles.detailEditTitle}>Uvitaci e-mail pre jednotlivca</div>
            <div style={styles.createGrid}>
              <label style={styles.field}>
                <span>Vyhladat osobu</span>
                <input
                  value={welcomePersonQuery}
                  onChange={event => {
                    setWelcomePersonQuery(event.target.value)
                    setWelcomeSelectedPerson(null)
                    if (event.target.value.trim().length < 2) setWelcomePersonResults([])
                  }}
                  style={styles.input}
                  placeholder="Meno, priezvisko alebo e-mail"
                  disabled={communicationLoading}
                />
              </label>
            </div>

            <div style={styles.toolActionRow}>
              <button
                type="button"
                style={styles.lightButton}
                disabled={communicationLoading || welcomePersonQuery.trim().length < 2}
                onClick={() => void searchWelcomePeople()}
              >
                {communicationLoading ? 'Pracujem...' : 'Vyhladat osobu'}
              </button>

              <button
                type="button"
                style={styles.confirmButton}
                disabled={communicationLoading || !welcomeSelectedPerson}
                onClick={() => void sendWelcomeEmailToPerson()}
              >
                Odoslat uvitaci e-mail
              </button>

              {welcomeSelectedPerson && (
                <span style={styles.optionHint}>
                  {welcomeSelectedPerson.fullName || 'Bez mena'} | {welcomeSelectedPerson.email}
                </span>
              )}
            </div>

            {welcomePersonResults.length > 0 && (
              <div style={styles.managerResultList}>
                {welcomePersonResults.map(person => {
                  const isSelected = welcomeSelectedPerson?.id === person.id

                  return (
                    <button
                      key={person.id}
                      type="button"
                      style={{
                        ...styles.managerResultButton,
                        ...(isSelected ? styles.managerResultButtonActive : {})
                      }}
                      disabled={communicationLoading}
                      onClick={() => setWelcomeSelectedPerson(person)}
                    >
                      <b>{person.fullName || 'Bez mena'}</b>
                      <span>{person.email || 'Bez e-mailu'}</span>
                      <span>{person.registrationGroupName || 'Bez registracnej skupiny'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {communicationSummary && (
            <div style={styles.toolStatsGrid}>
              <div style={styles.toolStat}><b>{communicationSummary.withEmail}</b><span>S e-mailom</span></div>
              <div style={styles.toolStat}><b>{communicationSummary.welcomeSent}</b><span>Odoslane</span></div>
              <div style={styles.toolStatWarning}><b>{communicationSummary.welcomePending}</b><span>Caka</span></div>
            </div>
          )}

          <div style={styles.communicationResendBox}>
            <div style={styles.detailEditTitle}>Samostatne objednavanie stravy</div>
            <div style={styles.optionHint}>Tento e-mail sa posiela iba ludom so samostatnym objednavanim stravy.</div>

            <div style={styles.createGrid}>
              <label style={styles.field}>
                <span>Registracna skupina</span>
                <select
                  value={selfOrderingGroupId}
                  onChange={event => {
                    setSelfOrderingGroupId(event.target.value)
                    setSelfOrderingSummary(null)
                  }}
                  style={styles.input}
                  disabled={communicationLoading}
                >
                  <option value="">Vsetky registracne skupiny</option>
                  {registrationGroups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>

              <label style={{ ...styles.field, alignSelf: 'end' }}>
                <span>Rezim</span>
                <button
                  type="button"
                  style={selfOrderingResend ? styles.confirmButtonPurple : styles.lightButton}
                  disabled={communicationLoading}
                  onClick={() => setSelfOrderingResend(prev => !prev)}
                >
                  {selfOrderingResend ? 'Odoslat aj znova' : 'Len neposlane'}
                </button>
              </label>
            </div>

            <div style={styles.toolActionRow}>
              <button
                type="button"
                style={styles.lightButton}
                disabled={communicationLoading}
                onClick={() => void loadCommunicationSummary(selfOrderingGroupId, 'selfOrdering')}
              >
                Nacitat stav
              </button>

              <button
                type="button"
                style={styles.confirmButtonPurple}
                disabled={communicationLoading || (!selfOrderingResend && !selfOrderingSummary?.selfOrderingPending) || (selfOrderingResend && !selfOrderingSummary?.selfOrderingWithEmail)}
                onClick={() => void sendSelfOrderingEmails()}
              >
                Odoslat davku 50
              </button>
            </div>

            {selfOrderingSummary && (
              <div style={styles.toolStatsGrid}>
                <div style={styles.toolStatBlue}><b>{selfOrderingSummary.selfOrderingWithEmail}</b><span>S e-mailom</span></div>
                <div style={styles.toolStatGreen}><b>{selfOrderingSummary.selfOrderingSent}</b><span>Odoslane</span></div>
                <div style={styles.toolStatWarning}><b>{selfOrderingSummary.selfOrderingPending}</b><span>Caka</span></div>
              </div>
            )}

            <div style={styles.detailEditTitle}>Jednotlivec</div>
            <div style={styles.createGrid}>
              <label style={styles.field}>
                <span>Vyhladat osobu</span>
                <input
                  value={communicationPersonQuery}
                  onChange={event => {
                    setCommunicationPersonQuery(event.target.value)
                    setCommunicationSelectedPerson(null)
                    if (event.target.value.trim().length < 2) setCommunicationPersonResults([])
                  }}
                  style={styles.input}
                  placeholder="Meno, priezvisko alebo e-mail"
                  disabled={communicationLoading}
                />
              </label>
            </div>

            <div style={styles.toolActionRow}>
              <button
                type="button"
                style={styles.lightButton}
                disabled={communicationLoading || communicationPersonQuery.trim().length < 2}
                onClick={() => void searchCommunicationPeople()}
              >
                {communicationLoading ? 'Pracujem...' : 'Vyhladat osobu'}
              </button>

              <button
                type="button"
                style={styles.confirmButtonPurple}
                disabled={communicationLoading || !communicationSelectedPerson}
                onClick={() => void resendSelfOrderingEmail()}
              >
                Odoslat znova
              </button>

              {communicationSelectedPerson && (
                <span style={styles.optionHint}>
                  {communicationSelectedPerson.fullName || 'Bez mena'} | {communicationSelectedPerson.email}
                </span>
              )}
            </div>

            {communicationPersonResults.length > 0 && (
              <div style={styles.managerResultList}>
                {communicationPersonResults.map(person => {
                  const isSelected = communicationSelectedPerson?.id === person.id

                  return (
                    <button
                      key={person.id}
                      type="button"
                      style={{
                        ...styles.managerResultButton,
                        ...(isSelected ? styles.managerResultButtonActive : {})
                      }}
                      disabled={communicationLoading}
                      onClick={() => setCommunicationSelectedPerson(person)}
                    >
                      <b>{person.fullName || 'Bez mena'}</b>
                      <span>{person.email || 'Bez e-mailu'}</span>
                      <span>{person.registrationGroupName || 'Bez registracnej skupiny'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {communicationMessage && (
            <div
              style={{
                ...styles.message,
                background: communicationMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: communicationMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: communicationMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {communicationMessage}
            </div>
          )}
        </section>
      )}

      {!showMobilePersonDetail && personnelTool === 'accessCodes' && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Pristupy a QR</b>
              <span>Odoslanie pristupovych kodov a QR tlacovej prilohy pre zodpovednu osobu skupiny.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={accessCodesLoading}
              onClick={() => setPersonnelTool('')}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={accessCodesGroupId}
                onChange={event => {
                  setAccessCodesGroupId(event.target.value)
                  setAccessCodesSummary(null)
                  setAccessCodesMessage('')
                  setAccessCodesMessageType('')
                }}
                style={styles.input}
                disabled={accessCodesLoading}
              >
                <option value="">Vyber registracnu skupinu</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>

            <label style={styles.field}>
              <span>E-mail prijemcu</span>
              <input
                value={accessCodesEmail}
                onChange={event => setAccessCodesEmail(event.target.value)}
                style={styles.input}
                disabled={accessCodesLoading}
                type="email"
                placeholder="veduci@firma.sk"
              />
            </label>

            <label style={styles.field}>
              <span>Jazyk e-mailu</span>
              <select
                value={accessCodesLanguage}
                onChange={event => {
                  const nextLanguage = event.target.value === 'EN' ? 'EN' : 'SK'

                  setAccessCodesLanguage(nextLanguage)
                  setAccessCodesNote(ACCESS_CODES_NOTES[nextLanguage])
                }}
                style={styles.input}
                disabled={accessCodesLoading}
              >
                <option value="SK">Slovencina</option>
                <option value="EN">English</option>
              </select>
            </label>
          </div>

          <label style={styles.field}>
            <span>Sprava do e-mailu</span>
            <textarea
              value={accessCodesNote}
              onChange={event => setAccessCodesNote(event.target.value)}
              style={styles.textarea}
              disabled={accessCodesLoading}
              rows={3}
            />
          </label>

          <div style={styles.toolActionRow}>
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={accessCodesIncludeCsv}
                onChange={event => setAccessCodesIncludeCsv(event.target.checked)}
                disabled={accessCodesLoading}
                style={styles.checkbox}
              />
              <span>Excel pristupove kody</span>
            </label>

            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={accessCodesIncludeQr}
                onChange={event => setAccessCodesIncludeQr(event.target.checked)}
                disabled={accessCodesLoading}
                style={styles.checkbox}
              />
              <span>QR tlacova priloha</span>
            </label>
          </div>

          <div style={styles.toolActionRow}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={accessCodesLoading || !accessCodesGroupId}
              onClick={() => void loadCommunicationSummary(accessCodesGroupId, 'accessCodes')}
            >
              Nacitat prehlad
            </button>

            <button
              type="button"
              style={styles.confirmButton}
              disabled={accessCodesLoading || !accessCodesGroupId || !accessCodesEmail.trim() || (!accessCodesIncludeCsv && !accessCodesIncludeQr)}
              onClick={() => void sendAccessCodesForGroup()}
            >
              Odoslat vybrane prilohy
            </button>

            <a
              href={accessCodesGroupId ? `/dashboard/personalista/print-qr?registrationGroupId=${encodeURIComponent(accessCodesGroupId)}` : '#'}
              style={{
                ...styles.lightButton,
                pointerEvents: accessCodesGroupId ? 'auto' : 'none',
                opacity: accessCodesGroupId ? 1 : 0.55,
                textDecoration: 'none'
              }}
            >
              Otvorit tlac QR
            </a>
          </div>

          {accessCodesSummary && (
            <div style={styles.toolStatsGrid}>
              <div style={styles.toolStat}><b>{accessCodesSummary.total}</b><span>Aktivni ludia</span></div>
              <div style={styles.toolStat}><b>{accessCodesSummary.withAccessCode}</b><span>S pristupovym kodom</span></div>
              <div style={styles.toolStat}><b>{accessCodesSummary.withQr}</b><span>S QR kodom</span></div>
              <div style={styles.toolStatWarning}><b>{Math.max(0, accessCodesSummary.total - accessCodesSummary.withAccessCode)}</b><span>Bez kodu</span></div>
              <div style={styles.toolStatWarning}><b>{Math.max(0, accessCodesSummary.total - accessCodesSummary.withQr)}</b><span>Bez QR</span></div>
            </div>
          )}

          <div style={styles.optionHint}>
            Excel obsahuje iba ludi s aktivnym pristupovym kodom. QR priloha je tlacovy PDF subor pripraveny na otvorenie a tlac.
          </div>

          {accessCodesMessage && (
            <div
              style={{
                ...styles.message,
                background: accessCodesMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: accessCodesMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: accessCodesMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {accessCodesMessage}
            </div>
          )}
        </section>
      )}

      {!showMobilePersonDetail && personnelTool === 'registrationGroupManagers' && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Manageri registracnych skupin</b>
              <span>Prehlad, pridanie a odobratie managerov pre skupinovy vydaj.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={managerOverviewLoading || managerOverviewActionLoading}
              onClick={() => setPersonnelTool('')}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Hladat</span>
              <input
                value={managerOverviewFilter}
                onChange={event => setManagerOverviewFilter(event.target.value)}
                style={styles.input}
                placeholder="Skupina, meno, e-mail"
                disabled={managerOverviewLoading}
              />
            </label>

            <label style={styles.field}>
              <span>Zobrazenie</span>
              <select
                value={managerOverviewMode}
                onChange={event => setManagerOverviewMode(event.target.value as ManagerOverviewMode)}
                style={styles.input}
                disabled={managerOverviewLoading}
              >
                <option value="all">Vsetky skupiny</option>
                <option value="withManagers">Len s managerom</option>
                <option value="withoutManagers">Len bez managera</option>
              </select>
            </label>
          </div>

          <div style={styles.toolActionRow}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={managerOverviewLoading || managerOverviewActionLoading}
              onClick={() => void loadRegistrationGroupManagersOverview()}
            >
              {managerOverviewLoading ? 'Nacitavam...' : 'Obnovit prehlad'}
            </button>

            <span style={styles.optionHint}>
              Zobrazenych {filteredManagerOverviewGroups.length} z {managerOverviewGroups.length} skupin.
            </span>
          </div>

          <div style={styles.detailEditBoxSoft}>
            <div style={styles.detailEditTitle}>Pridat managera</div>

            <div style={styles.createGrid}>
              <label style={styles.field}>
                <span>Registracna skupina</span>
                <select
                  value={managerOverviewGroupId}
                  onChange={event => setManagerOverviewGroupId(event.target.value)}
                  style={styles.input}
                  disabled={managerOverviewActionLoading}
                >
                  <option value="">Vyber registracnu skupinu</option>
                  {registrationGroups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>

              <label style={styles.field}>
                <span>Osoba</span>
                <input
                  value={managerOverviewPersonQuery}
                  onChange={event => {
                    setManagerOverviewPersonQuery(event.target.value)
                    setManagerOverviewSelectedPerson(null)
                  }}
                  style={styles.input}
                  placeholder="Meno, priezvisko alebo e-mail"
                  disabled={managerOverviewActionLoading}
                />
              </label>
            </div>

            <div style={styles.toolActionRow}>
              <button
                type="button"
                style={styles.lightButton}
                disabled={managerOverviewActionLoading || managerOverviewPersonQuery.trim().length < 2}
                onClick={() => void searchManagerOverviewPeople()}
              >
                {managerOverviewActionLoading ? 'Pracujem...' : 'Vyhladat osobu'}
              </button>

              <button
                type="button"
                style={styles.confirmButton}
                disabled={managerOverviewActionLoading || !managerOverviewGroupId || !managerOverviewSelectedPerson}
                onClick={() => void addManagerFromOverview()}
              >
                Pridat managera
              </button>

              {selectedManagerOverviewGroup && managerOverviewSelectedPerson && (
                <span style={styles.optionHint}>
                  {managerOverviewSelectedPerson.fullName} {'->'} {selectedManagerOverviewGroup.name}
                </span>
              )}
            </div>

            {managerOverviewPersonResults.length > 0 && (
              <div style={styles.managerResultList}>
                {managerOverviewPersonResults.map(person => {
                  const isSelected = managerOverviewSelectedPerson?.id === person.id

                  return (
                    <button
                      key={person.id}
                      type="button"
                      style={{
                        ...styles.managerResultButton,
                        ...(isSelected ? styles.managerResultButtonActive : {})
                      }}
                      disabled={managerOverviewActionLoading}
                      onClick={() => setManagerOverviewSelectedPerson(person)}
                    >
                      <b>{person.fullName || 'Bez mena'}</b>
                      <span>{person.email || person.telefon || 'Bez kontaktu'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {managerOverviewMessage && (
            <div
              style={{
                ...styles.message,
                background: managerOverviewMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: managerOverviewMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: managerOverviewMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {managerOverviewMessage}
            </div>
          )}

          <div style={styles.managerOverviewGrid}>
            {filteredManagerOverviewGroups.map(group => (
              <article key={group.id} style={styles.managerGroupCard}>
                <header style={styles.managerGroupHeader}>
                  <div>
                    <b>{group.name}</b>
                    <span>{group.managers.length ? `${group.managers.length} manager` : 'Bez managera'}</span>
                  </div>
                </header>

                <div style={styles.managerList}>
                  {group.managers.length === 0 ? (
                    <div style={styles.managerEmpty}>Pre tuto registracnu skupinu nie je nastaveny manager.</div>
                  ) : (
                    group.managers.map(manager => (
                      <div key={manager.id} style={styles.managerRow}>
                        <div style={styles.managerPersonInfo}>
                          <b>{manager.fullName || 'Bez mena'}</b>
                          <span>{manager.email || manager.telefon || 'Bez kontaktu'}</span>
                        </div>

                        <button
                          type="button"
                          style={styles.smallRemoveButton}
                          disabled={managerOverviewActionLoading}
                          title="Odobrat managera"
                          onClick={() => void removeManagerFromOverview(manager, group.name)}
                        >
                          x
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!showMobilePersonDetail && printQrOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Tlac QR skupiny</b>
              <span>Vyber, či chceš tlačiť QR podľa registračnej alebo stravovacej skupiny.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              onClick={() => setPrintQrOpen(false)}
            >
              x
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Typ skupiny</span>
              <select
                value={printQrForm.type}
                onChange={event => setPrintQrForm(prev => ({
                  ...prev,
                  type: event.target.value
                }))}
                style={styles.input}
              >
                <option value="REGISTRATION_GROUP">Registracna skupina</option>
                <option value="FOOD_GROUP">Stravovacia skupina</option>
              </select>
            </label>

            {printQrForm.type === 'REGISTRATION_GROUP' ? (
              <label style={styles.field}>
                <span>Registracna skupina</span>
                <select
                  value={printQrForm.registrationGroupId}
                  onChange={event => setPrintQrForm(prev => ({
                    ...prev,
                    registrationGroupId: event.target.value
                  }))}
                  style={styles.input}
                >
                  <option value="">Vyber registracnu skupinu</option>
                  {registrationGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label style={styles.field}>
                <span>Stravovacia skupina</span>
                <select
                  value={printQrForm.foodGroupId}
                  onChange={event => setPrintQrForm(prev => ({
                    ...prev,
                    foodGroupId: event.target.value
                  }))}
                  style={styles.input}
                >
                  <option value="">Vyber stravovaciu skupinu</option>
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {printQrHref ? (
            <a href={printQrHref} style={{ ...styles.confirmButton, textAlign: 'center' }}>
              Pokracovat na tlac
            </a>
          ) : (
            <button type="button" style={styles.actionButton} disabled>
              Vyber skupinu
            </button>
          )}
        </section>
      )}

      {!showMobilePersonDetail && legacyFoodGroupsOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Starý hromadný výdaj</b>
              <span>Admin prepína starý systém stravovacích skupín a starý hromadný výdaj.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={legacyFoodGroupsLoading}
              onClick={() => setLegacyFoodGroupsOpen(false)}
            >
              x
            </button>
          </div>

          <div style={styles.detailEditBoxSoft}>
            <div style={styles.detailEditTitle}>
              Stav: {legacyFoodGroupsEnabledState ? 'zapnuté' : 'vypnuté'}
            </div>

            <div style={styles.optionHint}>
              Keď je vypnuté, používateľom sa nezobrazujú stravovacie skupiny na dashboarde a starý hromadný výdaj sa nepoužíva. Nový skupinový výdaj podľa registračných skupín ostáva zapnutý.
            </div>

            <div style={styles.toolActionRow}>
              <button
                type="button"
                style={{
                  ...styles.confirmButton,
                  opacity: legacyFoodGroupsLoading || legacyFoodGroupsEnabledState ? 0.55 : 1
                }}
                disabled={legacyFoodGroupsLoading || legacyFoodGroupsEnabledState}
                onClick={() => void saveLegacyFoodGroupsSetting(true)}
              >
                Zapnúť
              </button>

              <button
                type="button"
                style={{
                  ...styles.dangerButton,
                  opacity: legacyFoodGroupsLoading || !legacyFoodGroupsEnabledState ? 0.55 : 1
                }}
                disabled={legacyFoodGroupsLoading || !legacyFoodGroupsEnabledState}
                onClick={() => {
                  const ok = window.confirm('Naozaj vypnúť staré stravovacie skupiny a starý hromadný výdaj pre používateľov?')
                  if (ok) void saveLegacyFoodGroupsSetting(false)
                }}
              >
                Vypnúť
              </button>
            </div>
          </div>

          {legacyFoodGroupsMessage && (
            <div
              style={{
                ...styles.message,
                background: legacyFoodGroupsMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: legacyFoodGroupsMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: legacyFoodGroupsMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {legacyFoodGroupsMessage}
            </div>
          )}
        </section>
      )}

      {!showMobilePersonDetail && qrRulesOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Pravidla QR naramkov</b>
              <span>Kontrola sa pouzije pri priradeni nacitaneho QR naramku osobe.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={qrRulesLoading}
              onClick={() => setQrRulesOpen(false)}
            >
              x
            </button>
          </div>

          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={qrRulesForm.enabled}
              onChange={event => setQrRulesForm(prev => ({
                ...prev,
                enabled: event.target.checked
              }))}
              disabled={qrRulesLoading}
              style={styles.checkbox}
            />
            <span>Zapnut kontrolu pravidiel QR naramkov</span>
          </label>

          <div style={styles.optionHint}>
            QR kod naramku musi mat 14 cislic. Prve 2 cislice su typ, dalsie 3 cislice su seria.
          </div>

          <div style={styles.qrRuleList}>
            {qrRulesForm.ranges.map((range, index) => (
              <div
                key={`${range.id || 'new'}-${index}`}
                style={{
                  ...styles.qrRuleRow,
                  ...(isMobile ? styles.mobileQrRuleRow : {})
                }}
              >
                <label style={styles.field}>
                  <span>Typ</span>
                  <input
                    value={range.typeCode}
                    onChange={event => updateQrRuleRange(index, 'typeCode', event.target.value)}
                    style={styles.input}
                    disabled={qrRulesLoading}
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="42"
                  />
                </label>

                <label style={styles.field}>
                  <span>Seria od</span>
                  <input
                    value={String(range.seriesFrom || '')}
                    onChange={event => updateQrRuleRange(index, 'seriesFrom', event.target.value)}
                    style={styles.input}
                    disabled={qrRulesLoading}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="001"
                  />
                </label>

                <label style={styles.field}>
                  <span>Seria do</span>
                  <input
                    value={String(range.seriesTo || '')}
                    onChange={event => updateQrRuleRange(index, 'seriesTo', event.target.value)}
                    style={styles.input}
                    disabled={qrRulesLoading}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="520"
                  />
                </label>

                <label style={styles.compactCheck}>
                  <input
                    type="checkbox"
                    checked={range.active}
                    onChange={event => updateQrRuleRange(index, 'active', event.target.checked)}
                    disabled={qrRulesLoading}
                    style={styles.checkbox}
                  />
                  <span>Aktivne</span>
                </label>

                <button
                  type="button"
                  style={styles.dangerTinyButton}
                  disabled={qrRulesLoading || qrRulesForm.ranges.length <= 1}
                  onClick={() => removeQrRuleRange(index)}
                >
                  Zmazat
                </button>
              </div>
            ))}
          </div>

          <div style={styles.calendarToolbar}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={qrRulesLoading}
              onClick={addQrRuleRange}
            >
              Pridat typ
            </button>

            <button
              type="button"
              style={styles.confirmButton}
              disabled={qrRulesLoading}
              onClick={saveQrWristbandRules}
            >
              {qrRulesLoading ? 'Ukladam...' : 'Ulozit pravidla'}
            </button>
          </div>

          {qrRulesMessage && (
            <div
              style={{
                ...styles.message,
                background: qrRulesMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: qrRulesMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: qrRulesMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {qrRulesMessage}
            </div>
          )}
        </section>
      )}

      {!showMobilePersonDetail && registrationGroupsOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Registračné skupiny</b>
              <span>Najprv vyber skupinu. Zaradenia a nároky sú oddelené akcie, aby sa pri hromadnej práci nepomiešali.</span>
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

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Vybraná registračná skupina</span>
              <select
                value={bulkRegistrationEntitlementsForm.registrationGroupId}
                onChange={event => selectManagedRegistrationGroup(event.target.value)}
                style={styles.input}
                disabled={registrationGroupLoading || registrationAssignmentLoading || bulkRegistrationEntitlementsLoading}
              >
                <option value="">Vyber registračnú skupinu</option>
                {registrationGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Prehľad</div>
              <span style={styles.optionHint}>
                Registračných skupín: {registrationGroups.length}
              </span>
              <span style={styles.optionHint}>
                Osob vo vybranej skupine: {selectedBulkRegistrationGroupAllPeopleCount}
              </span>
            </div>
          </div>

          <div style={styles.groupSelectRow}>
            <input
              value={registrationGroupName}
              onChange={event => setRegistrationGroupName(event.target.value)}
              style={styles.input}
              placeholder="Názov novej registračnej skupiny"
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

          <div style={styles.registrationPeopleSection}>
            <div style={styles.registrationSectionHeader}>
              <span style={styles.registrationSectionBadgeBlue}>1</span>
              <div>
                <b>Zaradenia osôb</b>
                <span>Pridaj vybraným osobám časové zaradenie alebo im vymaž všetky registračné zaradenia. Nároky sa tu nemenia.</span>
              </div>
            </div>

            <div style={styles.createGrid}>
              <label style={styles.field}>
                <span>Od</span>
                <input
                  type="date"
                  value={registrationAssignmentForm.validFrom}
                  onChange={event => updateRegistrationAssignmentForm('validFrom', event.target.value)}
                  style={styles.input}
                  disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId}
                />
              </label>

              <label style={styles.field}>
                <span>Do</span>
                <input
                  type="date"
                  value={registrationAssignmentForm.validTo}
                  onChange={event => updateRegistrationAssignmentForm('validTo', event.target.value)}
                  style={styles.input}
                  disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId}
                />
              </label>

              <label style={styles.field}>
                <span>Poznámka</span>
                <input
                  value={registrationAssignmentForm.registrationGroupNote}
                  onChange={event => updateRegistrationAssignmentForm('registrationGroupNote', event.target.value)}
                  style={styles.input}
                  placeholder="Voliteľné"
                  disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId}
                />
              </label>
            </div>

            <div style={styles.infoNotice}>
              Ak necháš dátum <b>Do</b> prázdny, zaradenie ostane otvorené bez konca. Ak má osoba otvorené staršie zaradenie, systém ho ukončí deň pred novým dátumom <b>Od</b>. Pri inom konflikte sa nezmení nikto.
            </div>

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

            <label style={styles.field}>
              <span>Hľadať osobu</span>
              <input
                value={registrationAssignmentSearch}
                onChange={event => setRegistrationAssignmentSearch(event.target.value)}
                style={styles.input}
                placeholder="Meno, email alebo časť názvu skupiny"
                disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId}
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
                      disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId}
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
              disabled={registrationAssignmentLoading || !registrationAssignmentForm.registrationGroupId || !registrationAssignmentForm.validFrom || registrationAssignmentForm.userIds.length === 0}
              onClick={saveRegistrationAssignment}
            >
              {registrationAssignmentLoading ? 'Ukladám...' : 'Pridať zaradenie'}
            </button>

            <div style={styles.dangerSection}>
              <div style={styles.optionTitle}>Nebezpečná akcia</div>
              <span style={styles.optionHint}>
                Vymaže všetky časové zaradenia vybraným osobám bez ohľadu na dátum. Nároky na stravu ostanú nezmenené.
              </span>
              <button
                type="button"
                style={styles.dangerButton}
                disabled={registrationAssignmentLoading || registrationAssignmentForm.userIds.length === 0}
                onClick={clearSelectedRegistrationAssignments}
              >
                Vymazať zaradenia vybraným ({registrationAssignmentForm.userIds.length})
              </button>
            </div>

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
          </div>

          <div style={styles.registrationEntitlementSection}>
            <div style={styles.registrationSectionHeader}>
              <span style={styles.registrationSectionBadgeGreen}>2</span>
              <div>
                <b>Naroky na stravu</b>
                <span>Nastav cele obdobie, kalendar alebo zrus naroky vybranej skupine.</span>
              </div>
            </div>

            <div style={styles.createGrid}>
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
                <div style={styles.optionTitle}>Rezim upravy</div>

                <label style={styles.checkRow}>
                  <input
                    type="radio"
                    name="bulkRegistrationEntitlementsModeUnified"
                    checked={bulkRegistrationEntitlementsForm.mode === 'SET'}
                    onChange={() => updateBulkRegistrationEntitlementsForm('mode', 'SET')}
                    disabled={bulkRegistrationEntitlementsLoading}
                    style={styles.checkbox}
                  />
                  <span>Nastavit cele obdobie</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="radio"
                    name="bulkRegistrationEntitlementsModeUnified"
                    checked={bulkRegistrationEntitlementsForm.mode === 'DATES'}
                    onChange={() => updateBulkRegistrationEntitlementsForm('mode', 'DATES')}
                    disabled={bulkRegistrationEntitlementsLoading}
                    style={styles.checkbox}
                  />
                  <span>Upravit podla kalendara</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="radio"
                    name="bulkRegistrationEntitlementsModeUnified"
                    checked={bulkRegistrationEntitlementsForm.mode === 'CLEAR'}
                    onChange={() => updateBulkRegistrationEntitlementsForm('mode', 'CLEAR')}
                    disabled={bulkRegistrationEntitlementsLoading}
                    style={styles.checkbox}
                  />
                  <span>Zrusit naroky v obdobi</span>
                </label>
              </div>

              <div style={styles.optionBox}>
                <div style={styles.optionTitle}>Strava pre cele obdobie</div>

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={bulkRegistrationEntitlementsForm.obed}
                    onChange={event => updateBulkRegistrationEntitlementsForm('obed', event.target.checked)}
                    disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationEntitlementsForm.mode !== 'SET'}
                    style={styles.checkbox}
                  />
                  <span>Obed</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={bulkRegistrationEntitlementsForm.vecera}
                    onChange={event => updateBulkRegistrationEntitlementsForm('vecera', event.target.checked)}
                    disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationEntitlementsForm.mode !== 'SET'}
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

            {bulkRegistrationEntitlementsForm.mode === 'DATES' && (
              <>
                <div style={styles.calendarToolbar}>
                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationCalendarDates.length === 0}
                    onClick={() => setBulkRegistrationCalendarMealForAll('obed', true)}
                  >
                    Obed vsetky dni
                  </button>

                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationCalendarDates.length === 0}
                    onClick={() => setBulkRegistrationCalendarMealForAll('vecera', true)}
                  >
                    Vecera vsetky dni
                  </button>

                  <button
                    type="button"
                    style={styles.lightButton}
                    disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationCalendarDates.length === 0}
                    onClick={clearBulkRegistrationCalendarSelection}
                  >
                    Zrusit vyber dni
                  </button>
                </div>

                <div style={styles.entitlementCalendar}>
                  {bulkRegistrationCalendarDates.length === 0 ? (
                    <span style={styles.emptyGroupSelection}>Vyber platne obdobie</span>
                  ) : (
                    bulkRegistrationCalendarDates.map(date => {
                      const claim = bulkRegistrationCalendarClaims[date] || { obed: false, vecera: false }
                      const selected = claim.obed || claim.vecera

                      return (
                        <div
                          key={date}
                          style={{
                            ...styles.calendarDay,
                            ...(selected ? styles.calendarDaySelected : {})
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
                              disabled={bulkRegistrationEntitlementsLoading}
                              onClick={() => toggleBulkRegistrationCalendarClaim(date, 'obed')}
                            >
                              O
                            </button>

                            <button
                              type="button"
                              style={{
                                ...styles.calendarMealButton,
                                ...(claim.vecera ? styles.calendarMealButtonActive : {})
                              }}
                              disabled={bulkRegistrationEntitlementsLoading}
                              onClick={() => toggleBulkRegistrationCalendarClaim(date, 'vecera')}
                            >
                              V
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              style={styles.confirmButton}
              disabled={bulkRegistrationEntitlementsLoading || !bulkRegistrationEntitlementsForm.registrationGroupId}
              onClick={saveBulkRegistrationEntitlements}
            >
              {bulkRegistrationEntitlementsLoading
                ? 'Ukladam...'
                : bulkRegistrationEntitlementsForm.mode === 'CLEAR'
                  ? 'Zrusit naroky v obdobi'
                  : bulkRegistrationEntitlementsForm.mode === 'DATES'
                    ? 'Ulozit kalendar skupiny'
                    : 'Pridelit naroky skupine'}
            </button>

            <div style={styles.dangerSection}>
              <div style={styles.optionTitle}>Nebezpecna akcia</div>
              <span style={styles.optionHint}>
                Vymaze vsetky existujuce naroky v tejto registracnej skupine bez ohladu na datum. Pouzije vsetky osoby v skupine, nielen aktivne.
              </span>
              <button
                type="button"
                style={styles.dangerButton}
                disabled={bulkRegistrationEntitlementsLoading || !bulkRegistrationEntitlementsForm.registrationGroupId}
                onClick={clearAllBulkRegistrationEntitlements}
              >
                Vymazat vsetky naroky skupiny ({selectedBulkRegistrationGroupAllPeopleCount})
              </button>
            </div>

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
          </div>
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
              <div style={styles.optionTitle}>Rezim upravy</div>

              <label style={styles.checkRow}>
                <input
                  type="radio"
                  name="bulkRegistrationEntitlementsMode"
                  checked={bulkRegistrationEntitlementsForm.mode === 'SET'}
                  onChange={() => updateBulkRegistrationEntitlementsForm('mode', 'SET')}
                  disabled={bulkRegistrationEntitlementsLoading}
                  style={styles.checkbox}
                />
                <span>Nastavit / upravit naroky</span>
              </label>

              <label style={styles.checkRow}>
                <input
                  type="radio"
                  name="bulkRegistrationEntitlementsMode"
                  checked={bulkRegistrationEntitlementsForm.mode === 'CLEAR'}
                  onChange={() => updateBulkRegistrationEntitlementsForm('mode', 'CLEAR')}
                  disabled={bulkRegistrationEntitlementsLoading}
                  style={styles.checkbox}
                />
                <span>Zrusit naroky v obdobi</span>
              </label>

              <span style={styles.optionHint}>
                Zrusenie vymaze obed aj veceru pre vybrane dni.
              </span>
            </div>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Strava</div>

              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={bulkRegistrationEntitlementsForm.obed}
                  onChange={event => updateBulkRegistrationEntitlementsForm('obed', event.target.checked)}
                  disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationEntitlementsForm.mode === 'CLEAR'}
                  style={styles.checkbox}
                />
                <span>Obed</span>
              </label>

              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={bulkRegistrationEntitlementsForm.vecera}
                  onChange={event => updateBulkRegistrationEntitlementsForm('vecera', event.target.checked)}
                  disabled={bulkRegistrationEntitlementsLoading || bulkRegistrationEntitlementsForm.mode === 'CLEAR'}
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
            {bulkRegistrationEntitlementsLoading
              ? 'Ukladam...'
              : bulkRegistrationEntitlementsForm.mode === 'CLEAR'
                ? 'Zrusit naroky skupine'
                : 'Pridelit naroky skupine'}
          </button>

          <div style={styles.optionBox}>
            <div style={styles.optionTitle}>Nebezpecna akcia</div>
            <span style={styles.optionHint}>
              Vymaze vsetky existujuce naroky v tejto registracnej skupine bez ohladu na datum. Pouzije vsetky osoby v skupine, nielen aktivne.
            </span>
            <button
              type="button"
              style={styles.dangerButton}
              disabled={bulkRegistrationEntitlementsLoading || !bulkRegistrationEntitlementsForm.registrationGroupId}
              onClick={clearAllBulkRegistrationEntitlements}
            >
              Vymazat vsetky naroky skupiny ({selectedBulkRegistrationGroupAllPeopleCount})
            </button>
          </div>

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

      {!showMobilePersonDetail && createOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Ručné vytvorenie osoby</b>
              <span>
                {isTechnicalCreate
                  ? 'Technický účet slúži na servisný prístup bez stravovacích nárokov.'
                  : 'Email aj skupina sú voliteľné. Nárok sa vytvorí pre každý deň vo vybranom období.'}
              </span>
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

          {canAssignSensitiveRoles && (
            <div style={styles.accountTypeSwitch}>
              <button
                type="button"
                style={{
                  ...styles.accountTypeButton,
                  ...(createForm.accountType === 'PERSON' ? styles.accountTypeButtonActive : {})
                }}
                disabled={createLoading}
                onClick={() => updateCreateAccountType('PERSON')}
              >
                <b>Stravník</b>
                <span>Bežná osoba s nárokmi na stravu.</span>
              </button>

              <button
                type="button"
                style={{
                  ...styles.accountTypeButton,
                  ...(createForm.accountType === 'TECHNICAL' ? styles.accountTypeButtonActive : {})
                }}
                disabled={createLoading}
                onClick={() => updateCreateAccountType('TECHNICAL')}
              >
                <b>Technický účet</b>
                <span>Kiosk alebo servisný účet bez stravy.</span>
              </button>
            </div>
          )}

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

            {!isTechnicalCreate && (
              <>
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
              </>
            )}
          </div>

          <div style={styles.createOptionsGrid}>
            {!isTechnicalCreate && (
              <>
                <div style={styles.optionBox}>
                  <div style={styles.optionTitle}>Stravovacie skupiny</div>
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
              </>
            )}

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Priraďovanie prístupov</div>
              <div style={styles.optionHint}>
                {isTechnicalCreate
                  ? 'Technický účet môže mať QR aj prístupový kód. Prístupový kód použiješ na prihlásenie kiosku.'
                  : 'QR použije voľný kód z databázy. Prístupový kód umožní prihlásenie menom, priezviskom a kódom.'}
              </div>

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

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.generateAccessCode}
                    onChange={event => updateCreateForm('generateAccessCode', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Priradiť prístupový kód</span>
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

      <section
        style={{
          ...styles.layoutGrid,
          ...(!selectedPerson || showMobilePersonDetail ? styles.layoutGridFull : {})
        }}
      >
        <div style={{
          ...styles.leftColumn,
          ...(showMobilePersonDetail ? styles.mobileHiddenListColumn : {})
        }}>
          <section style={{
            ...styles.toolbar,
            ...(isMobile ? styles.mobileToolbar : {})
          }}>
            <div style={{
              ...(isMobile ? styles.mobileToolbarHint : styles.toolbarHint),
              ...peopleSearchHintStyle
            }}>
              {peopleSearchLoading ? 'Hladam...' : peopleSearchMessage} · zobrazených {pagedPeople.length} z {peopleTotal}
            </div>

            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Hľadať meno, email, telefón..."
              style={styles.searchInput}
              autoComplete="off"
            />

            <select
              value={registrationGroupFilter}
              onChange={event => {
                setRegistrationGroupFilter(event.target.value)
              }}
              style={styles.select}
            >
              <option value="ALL">Všetky registračné skupiny</option>
              {registrationGroups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            <>
            <select
              value={emailFilter}
              onChange={event => setEmailFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky e-maily</option>
              <option value="WITH">S e-mailom</option>
              <option value="MISSING">Bez e-mailu</option>
            </select>

            <select
              value={foodFilter}
              onChange={event => setFoodFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetka strava</option>
              <option value="MASO">MASO</option>
              <option value="VEGE">VEGE</option>
              <option value="DIETA">DIÉTA</option>
              <option value="NEZADANE">NEZADANÉ</option>
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
            </>
          </section>

          <section style={styles.tableCard}>
            <div style={{
              ...styles.tableHeader,
              minWidth: tableMinWidth,
              gridTemplateColumns: tableColumns
            }}>
              <span>Osoba</span>
              <span>Stav</span>
              <span>Registracna skupina</span>
              <span>Aktualne zaradenie</span>
              {foodGroupsVisible && <span>Stravovacie skupiny</span>}
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
                const lastEditedLabel = compactDateTimeLabel(person.lastEditedAt)
                const showLastEditedBy = Boolean(
                  person.lastEditedByName &&
                  (canViewAllPeople || (person.lastEditedById && person.lastEditedById !== currentUserId))
                )
                const lastEditedText = [
                  lastEditedLabel ? `upr. ${lastEditedLabel}` : '',
                  showLastEditedBy ? person.lastEditedByName : ''
                ].filter(Boolean).join(' · ')

                return (
                  <button
                    key={person.id}
                    type="button"
                    style={{
                      ...styles.personRow,
                      minWidth: tableMinWidth,
                      gridTemplateColumns: tableColumns,
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
                      {lastEditedText && (
                        <small style={styles.personMeta}>{lastEditedText}</small>
                      )}
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

                    <div style={styles.assignmentStack}>
                      {person.registrationGroupPeriods.length > 0 ? (
                        sortRegistrationPeriods(person.registrationGroupPeriods).map(period => {
                          const assignment = registrationPeriodCompactParts(period)

                          return (
                            <span key={`${person.id}-${period.id}`} style={styles.assignmentLine}>
                              <span style={styles.assignmentName}>{assignment.name}</span>
                              {assignment.range && <span style={styles.assignmentRange}>{assignment.range}</span>}
                            </span>
                          )
                        })
                      ) : (
                        <span style={styles.assignmentFallback}>
                          {person.registrationGroupName || '-'}
                        </span>
                      )}
                    </div>

                    {foodGroupsVisible && (
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
                    )}

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

            {peopleTotal > 0 && (
              <div style={{
                ...styles.paginationBar,
                minWidth: tableMinWidth
              }}>
                <span>
                  {pageStart + 1}-{pageEnd} z {peopleTotal}
                </span>

                <select
                  value={pageSize}
                  onChange={event => setPageSize(Number(event.target.value))}
                  style={styles.pageSizeSelect}
                >
                  <option value={12}>12 / strana</option>
                  <option value={25}>25 / strana</option>
                  <option value={50}>50 / strana</option>
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

        {selectedPerson && (
          <aside style={{
            ...styles.detailPanel,
            ...(isMobile ? styles.mobileDetailPanel : {})
          }}>
            <>
              <div style={{
                ...styles.detailHeader,
                ...(isMobile ? styles.mobileDetailHeader : {})
              }}>
                <div>
                  <div style={styles.detailSmall}>Detail osoby</div>
                  <h2 style={styles.detailTitle}>{selectedPerson.fullName}</h2>
                </div>

                <button
                  type="button"
                  style={{
                    ...styles.collapseDetailButton,
                    ...(isMobile ? styles.mobileBackToListButton : {})
                  }}
                  onClick={() => setSelectedPersonId('')}
                  title="Skryt detail"
                >
                  {isMobile ? '← Zoznam' : '×'}
                </button>

                <div style={{
                  ...styles.detailHeaderBadges,
                  ...(isMobile ? styles.mobileDetailHeaderBadges : {})
                }}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background: selectedPersonPendingReview
                        ? '#fef3c7'
                        : String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO'
                          ? '#fee2e2'
                          : '#dcfce7',
                      color: selectedPersonPendingReview
                        ? '#92400e'
                        : String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO'
                          ? '#991b1b'
                          : '#166534'
                    }}
                  >
                    {selectedPersonPendingReview ? 'Kontrola' : String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? 'Blokovaný' : 'Aktívny'}
                  </span>

                  <span style={styles.foodBadge}>
                    {foodLabel(selectedPerson.typStravy)}
                  </span>

                  {selectedPerson.globalRoles.map(role => (
                    <span key={role} style={styles.globalRoleBadge}>
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              <div style={styles.detailRows}>
                {selectedPersonPendingReview && (
                  <div style={styles.pendingApprovalBox}>
                    <div style={styles.pendingApprovalHeader}>
                      <div style={styles.pendingApprovalHeaderText}>
                        <b>Registrácia čaká na kontrolu</b>
                      </div>
                    </div>

                    <div style={styles.pendingStepGrid}>
                      <div style={styles.pendingStepBox}>
                        <button
                          type="button"
                          style={styles.pendingStepTitleButton}
                          onClick={() => setPendingReviewOpenStep(1)}
                        >
                          <b>Zaradenie</b>
                        </button>

                        {pendingReviewOpenStep === 1 ? (
                          <>
                        {pendingReviewBoundedPeriods.length > 0 && (
                          <div style={styles.pendingPeriodList}>
                            {pendingReviewBoundedPeriods.map(period => (
                              <div key={period.id} style={styles.pendingPeriodRow}>
                                <div style={styles.registrationPeriodInfo}>
                                  <b>{period.registrationGroupName || '-'}</b>
                                  <span>{fullDateLabel(period.validFrom)} - {period.validTo ? fullDateLabel(period.validTo) : '-'}</span>
                                  {period.note && <small>{period.note}</small>}
                                </div>

                                <div style={styles.registrationPeriodActions}>
                                  <button
                                    type="button"
                                    style={styles.smallEditButton}
                                    disabled={detailLoading}
                                    onClick={() => editPendingReviewRegistrationPeriod(period)}
                                    title="Zmenit zaradenie"
                                  >
                                    Z
                                  </button>

                                  <button
                                    type="button"
                                    style={styles.smallRemoveButton}
                                    disabled={detailLoading}
                                    onClick={() => deleteRegistrationGroupPeriod(period)}
                                    title="Vymazat zaradenie"
                                  >
                                    x
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                            <div style={styles.detailEditGridWide}>
                              <label style={styles.field}>
                                <span>Registračná skupina</span>
                                <select
                                  value={registrationPeriodForm.registrationGroupId}
                                  onChange={event => updateRegistrationPeriodForm('registrationGroupId', event.target.value)}
                                  style={styles.input}
                                  disabled={detailLoading}
                                >
                                  <option value="">Vyber registračnú skupinu</option>
                                  {registrationGroups.map(group => (
                                    <option key={group.id} value={group.id}>
                                      {group.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label style={styles.field}>
                                <span>Od</span>
                                {renderDateInput(
                                  registrationPeriodForm.validFrom,
                                  value => updateRegistrationPeriodForm('validFrom', value),
                                  detailLoading,
                                  'Vyber od'
                                )}
                              </label>

                              <label style={styles.field}>
                                <span>Do</span>
                                {renderDateInput(
                                  registrationPeriodForm.validTo,
                                  value => updateRegistrationPeriodForm('validTo', value),
                                  detailLoading,
                                  'Vyber do'
                                )}
                              </label>

                              <label style={styles.field}>
                                <span>Poznámka</span>
                                <input
                                  value={registrationPeriodForm.note}
                                  onChange={event => updateRegistrationPeriodForm('note', event.target.value)}
                                  style={styles.input}
                                  disabled={detailLoading}
                                  autoComplete="off"
                                />
                              </label>
                            </div>

                            <button
                              type="button"
                              style={{
                                ...styles.confirmButton,
                                opacity: detailLoading || !registrationPeriodForm.registrationGroupId || !registrationPeriodForm.validFrom || !registrationPeriodForm.validTo ? 0.55 : 1,
                                cursor: detailLoading || !registrationPeriodForm.registrationGroupId || !registrationPeriodForm.validFrom || !registrationPeriodForm.validTo ? 'not-allowed' : 'pointer'
                              }}
                              disabled={detailLoading || !registrationPeriodForm.registrationGroupId || !registrationPeriodForm.validFrom || !registrationPeriodForm.validTo}
                              onClick={() => void savePendingReviewRegistrationPeriod()}
                            >
                              {pendingReviewAction === 'period' ? 'Ukladám...' : 'Uložiť zaradenie'}
                            </button>
                        </>
                        ) : (
                          <div style={styles.pendingStepSummary}>
                            <b>{pendingReviewBoundedPeriods.length > 0 ? `${pendingReviewBoundedPeriods.length} zaradení` : 'Čaká'}</b>
                          </div>
                        )}
                      </div>

                      <div style={styles.pendingStepBox}>
                        <button
                          type="button"
                          style={styles.pendingStepTitleButton}
                          onClick={() => setPendingReviewOpenStep(2)}
                        >
                          <b>Nároky</b>
                        </button>

                        {pendingReviewOpenStep === 2 ? (
                          <>
                        {pendingReviewBoundedPeriods.length === 0 ? (
                          <div style={styles.optionHint}>Zaradenie chýba.</div>
                        ) : (
                          <>
                            <div style={styles.pendingStepSummary}>
                              <b>{pendingReviewEntitlements.length > 0 ? 'Nároky uložené' : 'Nároky čakajú'}</b>
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
                            </div>

                            <div style={styles.entitlementCalendar}>
                              {visibleEntitlementCalendarDates.length === 0 ? (
                                <span style={styles.emptyGroupSelection}>Načítaj nároky podľa zaradenia</span>
                              ) : (
                                visibleEntitlementCalendarDates.map(date => {
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
                              disabled={detailLoading || visibleEntitlementCalendarDates.length === 0}
                              onClick={saveSelectedEntitlementDates}
                            >
                              {pendingReviewAction === 'entitlements' ? 'Ukladám...' : 'Uložiť nároky'}
                            </button>
                          </>
                        )}
                          </>
                        ) : (
                          <div style={styles.pendingStepSummary}>
                            <b>{pendingReviewEntitlements.length > 0 ? 'Nároky uložené' : 'Nároky čakajú'}</b>
                          </div>
                        )}
                      </div>

                      <div style={styles.pendingStepBox}>
                        <button
                          type="button"
                          style={styles.pendingStepTitleButton}
                          onClick={() => setPendingReviewOpenStep(3)}
                        >
                          <b>Dokončenie</b>
                        </button>

                        {pendingReviewOpenStep === 3 ? (
                          <>
                        <div style={styles.pendingStepSummary}>
                          <b>{pendingReviewCanFinish ? 'Pripravené na dokončenie' : 'Ešte nie je pripravené'}</b>
                        </div>

                        <button
                          type="button"
                          style={{
                            ...styles.confirmButton,
                            opacity: detailLoading || !pendingReviewCanFinish ? 0.55 : 1,
                            cursor: detailLoading || !pendingReviewCanFinish ? 'not-allowed' : 'pointer'
                          }}
                          disabled={detailLoading || !pendingReviewCanFinish}
                          onClick={() => void approveRegistration()}
                        >
                          {pendingReviewAction === 'approve' ? 'Dokončujem...' : 'Dokončiť registráciu'}
                        </button>
                          </>
                        ) : (
                          <div style={styles.pendingStepSummary}>
                            <b>{pendingReviewCanFinish ? 'Pripravené' : 'Ešte nie je pripravené'}</b>
                          </div>
                        )}
                      </div>
                    </div>

                    {shouldShowPendingReviewMessage && (
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
                  </div>
                )}

                <div style={styles.detailRow}>
                  <span>Stav</span>
                  <b>{selectedPersonPendingReview ? 'Kontrola' : String(selectedPerson.aktivny || '').toUpperCase() !== 'ANO' ? 'Blokovaný' : 'Aktívny'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Email</span>
                  <b style={styles.detailEmailValue}>{selectedPerson.email || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Telefón</span>
                  <b>{selectedPerson.telefon || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Registračná skupina</span>
                  <b>{selectedPerson.registrationGroupName || '-'}</b>
                  {selectedPerson.registrationGroupNote && <small>{selectedPerson.registrationGroupNote}</small>}
                </div>

                <div style={styles.detailRow}>
                  <span>Aktuálna registračná skupina dnes</span>
                  <b>{selectedPerson.currentRegistrationGroupName || selectedPerson.registrationGroupName || '-'}</b>
                  {selectedPerson.currentRegistrationGroupNote && <small>{selectedPerson.currentRegistrationGroupNote}</small>}
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

              <div style={styles.sectionTitle}>Stravovacie skupiny</div>

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
                  selectedPerson.entitlements.map(item => {
                    const cancelLabel = entitlementCancelLabel(item.cancelledReason)

                    return (
                      <span
                        key={item.datum}
                        style={{
                          ...styles.entitlementPill,
                          ...(cancelLabel ? styles.cancelledEntitlementPill : {})
                        }}
                      >
                        {fullDateLabel(item.datum)}: {cancelLabel || `${item.obed ? 'O' : '-'} / ${item.vecera ? 'V' : '-'}`}
                      </span>
                    )
                  })
                )}
              </div>

              <div style={styles.sectionTitle}>Akcie</div>

              <div style={{
                ...styles.detailActions,
                ...(isMobile ? styles.mobileDetailActions : {})
              }}>
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
                    borderColor: detailMode === 'registrationPeriods' ? '#93c5fd' : '#e5e7eb',
                    background: detailMode === 'registrationPeriods' ? '#eff6ff' : '#fff'
                  }}
                  disabled={detailLoading}
                  onClick={() => setDetailMode(detailMode === 'registrationPeriods' ? '' : 'registrationPeriods')}
                >
                  Zaradenie
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
                  Stravovacie skupiny
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

                {canUseSelectedPersonAccessCode && (
                  <button
                    type="button"
                    style={{
                      ...styles.actionButton,
                      borderColor: detailMode === 'accessCode' ? '#93c5fd' : '#e5e7eb',
                      background: detailMode === 'accessCode' ? '#eff6ff' : '#fff'
                    }}
                    disabled={detailLoading}
                    onClick={() => setDetailMode(detailMode === 'accessCode' ? '' : 'accessCode')}
                  >
                    Pristupovy kod
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

                    <label style={{ ...styles.fieldWarning, ...styles.detailEditFullRow }}>
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

                    <label style={{ ...styles.field, ...styles.detailEditFullRow }}>
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

              {detailMode === 'registrationPeriods' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Zaradenie do registracnych skupin</div>

                  <div style={styles.optionHint}>
                    Zmena zaradenia nemeni naroky na stravu. Ak treba zmenit stravu, otvor samostatne Upravit naroky.
                  </div>

                  <div style={styles.detailGroups}>
                    {selectedPerson.registrationGroupPeriods.length === 0 ? (
                      <div style={styles.detailGroupRow}>
                        <b>Bez casoveho zaradenia</b>
                        <span>{selectedPerson.currentRegistrationGroupName || selectedPerson.registrationGroupName || '-'}</span>
                      </div>
                    ) : (
                      selectedRegistrationPeriodRows.map(row => {
                        if (row.type === 'gap') {
                          const isSelected = selectedRegistrationPeriodKeySet.has(row.key)

                          return (
                            <div
                              key={row.id}
                              style={{
                                ...styles.registrationPeriodGapRow,
                                ...(isSelected ? styles.registrationPeriodGapRowSelected : styles.registrationPeriodGapRowIdle)
                              }}
                              onClick={() => toggleRegistrationPeriodSelection(row)}
                            >
                              <div style={styles.registrationPeriodInfo}>
                                <b>Nezaradene obdobie</b>
                                <span>{fullDateLabel(row.validFrom)} - {fullDateLabel(row.validTo)}</span>
                              </div>
                            </div>
                          )
                        }

                        const period = row.period
                        const isSelected = selectedRegistrationPeriodKeySet.has(row.key)

                        return (
                          <div
                            key={period.id}
                            style={{
                              ...styles.registrationPeriodRow,
                              ...(isSelected ? styles.registrationPeriodRowSelected : styles.registrationPeriodRowIdle)
                            }}
                            onClick={() => toggleRegistrationPeriodSelection(row)}
                          >
                            <div style={styles.registrationPeriodInfo}>
                              <b>{period.registrationGroupName || '-'}</b>
                              <span>{fullDateLabel(period.validFrom)} - {period.validTo ? fullDateLabel(period.validTo) : 'bez konca'}</span>
                              {period.note && <small>{period.note}</small>}
                            </div>

                            <div style={styles.registrationPeriodActions}>
                              <button
                                type="button"
                                style={styles.smallEditButton}
                                disabled={detailLoading}
                                onClick={event => {
                                  event.stopPropagation()
                                  editRegistrationGroupPeriod(period)
                                }}
                                title="Zmenit zaradenie"
                              >
                                Z
                              </button>

                              <button
                                type="button"
                                style={styles.smallRemoveButton}
                                disabled={detailLoading}
                                onClick={event => {
                                  event.stopPropagation()
                                  deleteRegistrationGroupPeriod(period)
                                }}
                                title="Vymazat zaradenie"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>

                  {registrationPeriodForm.periodId && (
                    <div style={styles.optionHint}>
                      Upravujes existujuce zaradenie. Ak chces pridat nove obdobie, zrus upravu.
                    </div>
                  )}

                  {isBulkRegistrationPeriodEdit && (
                    <div style={styles.optionHint}>
                      Oznacenych je {selectedRegistrationPeriodCount} obdobi. Datumy ostanu zachovane, zmeni sa iba registracna skupina a poznamka.
                    </div>
                  )}

                  <div style={styles.detailEditGridWide}>
                    <label style={styles.field}>
                      <span>Registracna skupina</span>
                      <select
                        value={registrationPeriodForm.registrationGroupId}
                        onChange={event => updateRegistrationPeriodForm('registrationGroupId', event.target.value)}
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

                    {!isBulkRegistrationPeriodEdit && (
                      <>
                        <label style={styles.field}>
                          <span>Od</span>
                          {renderDateInput(
                            registrationPeriodForm.validFrom,
                            value => updateRegistrationPeriodForm('validFrom', value),
                            detailLoading,
                            'Vyber od'
                          )}
                        </label>

                        <label style={styles.field}>
                          <span>Do</span>
                          {renderDateInput(
                            registrationPeriodForm.validTo,
                            value => updateRegistrationPeriodForm('validTo', value),
                            detailLoading,
                            'Bez konca'
                          )}
                        </label>
                      </>
                    )}

                    <label style={styles.field}>
                      <span>Poznamka</span>
                      <input
                        value={registrationPeriodForm.note}
                        onChange={event => updateRegistrationPeriodForm('note', event.target.value)}
                        style={styles.input}
                        disabled={detailLoading}
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <div style={styles.calendarToolbar}>
                    <button
                      type="button"
                      style={styles.confirmButton}
                      disabled={detailLoading || !registrationPeriodForm.registrationGroupId}
                      onClick={saveRegistrationGroupPeriod}
                    >
                      {detailLoading ? 'Ukladam...' : isBulkRegistrationPeriodEdit ? 'Ulozit oznacene' : registrationPeriodForm.periodId ? 'Ulozit zmenu' : 'Ulozit zaradenie'}
                    </button>

                    {(registrationPeriodForm.periodId || isBulkRegistrationPeriodEdit) && (
                      <button
                        type="button"
                        style={styles.lightButton}
                        disabled={detailLoading}
                        onClick={resetRegistrationGroupPeriodForm}
                      >
                        Zrusit vyber
                      </button>
                    )}

                    <button
                      type="button"
                      style={styles.lightButton}
                      disabled={detailLoading}
                      onClick={openEntitlementsFromRegistrationPeriod}
                    >
                      Otvorit naroky ({selectedRegistrationPeriodCount})
                    </button>
                  </div>

                  <div style={styles.detailEditBoxSoft}>
                    <div style={styles.detailEditTitle}>Skupinovy vydaj - opravnenia</div>
                    <div style={styles.optionHint}>
                      Manager plati hned. Povereny moze vytvorit alebo upravit skupinovy vydaj, ale zmena zacne platit az po 15 minutach.
                    </div>

                    <div style={styles.detailGroups}>
                      {(selectedPerson.managedRegistrationGroups || []).length === 0 ? (
                        <div style={styles.detailGroupRow}>
                          <b>Bez manager opravnenia</b>
                          <span>Osoba nie je manager ziadnej registracnej skupiny.</span>
                        </div>
                      ) : (
                        (selectedPerson.managedRegistrationGroups || []).map(manager => (
                          <div key={manager.id} style={styles.registrationPeriodRow}>
                            <div style={styles.registrationPeriodInfo}>
                              <b>{manager.registrationGroupName || '-'}</b>
                              <span>Manager registracnej skupiny</span>
                            </div>

                            <div style={styles.registrationPeriodActions}>
                              <button
                                type="button"
                                style={styles.smallRemoveButton}
                                disabled={detailLoading}
                                onClick={() => removeRegistrationGroupManager(manager)}
                                title="Odobrat managera"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        ))
                      )}

                      {(selectedPerson.delegatedRegistrationGroups || []).length === 0 ? (
                        <div style={styles.detailGroupRow}>
                          <b>Bez poverenia</b>
                          <span>Osoba nie je poverena pre ziadnu registracnu skupinu.</span>
                        </div>
                      ) : (
                        (selectedPerson.delegatedRegistrationGroups || []).map(delegate => (
                          <div key={delegate.id} style={styles.registrationPeriodRow}>
                            <div style={styles.registrationPeriodInfo}>
                              <b>{delegate.registrationGroupName || '-'}</b>
                              <span>Povereny skupinovy vydaj s 15 minutovym cakanim</span>
                            </div>

                            <div style={styles.registrationPeriodActions}>
                              <button
                                type="button"
                                style={styles.smallRemoveButton}
                                disabled={detailLoading}
                                onClick={() => removeRegistrationGroupDelegate(delegate)}
                                title="Odobrat poverenie"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={styles.detailEditGridWide}>
                      <label style={{ ...styles.field, ...styles.detailEditFullRow }}>
                        <span>Registracna skupina</span>
                        <select
                          value={registrationGroupAccessForm.registrationGroupId}
                          onChange={event => setRegistrationGroupAccessForm({ registrationGroupId: event.target.value })}
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
                    </div>

                    <div style={styles.calendarToolbar}>
                      <button
                        type="button"
                        style={styles.confirmButton}
                        disabled={detailLoading || !registrationGroupAccessForm.registrationGroupId || (selectedPerson.managedRegistrationGroups || []).some(manager => manager.registrationGroupId === registrationGroupAccessForm.registrationGroupId)}
                        onClick={() => void addRegistrationGroupManager()}
                      >
                        {detailLoading ? 'Ukladam...' : 'Pridat managera'}
                      </button>

                      <button
                        type="button"
                        style={styles.darkButton}
                        disabled={detailLoading || !registrationGroupAccessForm.registrationGroupId || (selectedPerson.delegatedRegistrationGroups || []).some(delegate => delegate.registrationGroupId === registrationGroupAccessForm.registrationGroupId)}
                        onClick={() => void addRegistrationGroupDelegate()}
                      >
                        {detailLoading ? 'Ukladam...' : 'Pridat povereneho'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {detailMode === 'entitlements' && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Nároky na stravu</div>

                  <div style={styles.detailEditGridWide}>
                    <label style={styles.field}>
                      <span>Od</span>
                      {renderDateInput(
                        entitlementForm.validFrom,
                        value => updateEntitlementForm('validFrom', value),
                        detailLoading,
                        'Vyber od'
                      )}
                    </label>

                    <label style={styles.field}>
                      <span>Do</span>
                      {renderDateInput(
                        entitlementForm.validTo,
                        value => updateEntitlementForm('validTo', value),
                        detailLoading,
                        'Vyber do'
                      )}
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
                    {visibleEntitlementCalendarDates.length === 0 ? (
                      <span style={styles.emptyGroupSelection}>Vyber platné obdobie</span>
                    ) : (
                      visibleEntitlementCalendarDates.map(date => {
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
                  <div style={styles.detailEditTitle}>Stravovacie skupiny osoby</div>

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

                  <div style={styles.inlineDivider} />

                  <div style={styles.detailEditGrid}>
                    <label style={styles.field}>
                      <span>Vytvoriť novú stravovaciu skupinu</span>
                      <input
                        value={groupForm.newGroupName}
                        onChange={event => updateGroupForm('newGroupName', event.target.value.slice(0, 80))}
                        style={styles.input}
                        disabled={detailLoading}
                        placeholder="Názov novej skupiny"
                        maxLength={80}
                      />
                    </label>

                    <label style={styles.field}>
                      <span>Rola osoby</span>
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
                    disabled={detailLoading || groupForm.newGroupName.trim().length < 2}
                    onClick={() => void createGroupForSelectedPerson()}
                  >
                    Vytvoriť skupinu a pridať osobu
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

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.wristbandKiosk}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          wristbandKiosk: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Preskenovanie naramkov kiosk</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.menuKiosk}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          menuKiosk: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Výber stravy kiosk</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.offlineObsluha}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          offlineObsluha: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>OFFLINE_OBSLUHA</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.selfOrderingMeal}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          selfOrderingMeal: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>Samostatné objednávanie stravy</span>
                    </label>

                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={roleForm.adminRegSkupiny}
                        onChange={event => setRoleForm(prev => ({
                          ...prev,
                          adminRegSkupiny: event.target.checked
                        }))}
                        disabled={detailLoading}
                        style={styles.checkbox}
                      />
                      <span>ADMIN_REG_SKUPINY</span>
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

              {detailMode === 'accessCode' && canUseSelectedPersonAccessCode && (
                <div style={styles.detailEditBox}>
                  <div style={styles.detailEditTitle}>Pristupovy kod</div>
                  <div style={styles.optionHint}>
                    Kod sa nacita pri otvoreni tejto akcie. Podrz Zobrazit iba pocas kontroly kodu.
                  </div>

                  <div style={styles.accessCodeBox}>
                    <span style={styles.optionTitle}>Kod</span>
                    <b style={styles.accessCodeValue}>
                      {accessCodeLoading
                        ? 'Nacitavam...'
                        : accessCodeLoaded && !accessCodeValue
                          ? 'Bez kodu'
                          : accessCodeRevealed && accessCodeValue
                            ? accessCodeValue
                            : '********'}
                    </b>
                  </div>

                  <div style={styles.accessCodeActions}>
                    <button
                      type="button"
                      style={styles.lightButton}
                      disabled={accessCodeLoading || !accessCodeValue}
                      onPointerDown={() => setAccessCodeRevealed(true)}
                      onPointerUp={() => setAccessCodeRevealed(false)}
                      onPointerLeave={() => setAccessCodeRevealed(false)}
                      onPointerCancel={() => setAccessCodeRevealed(false)}
                      onBlur={() => setAccessCodeRevealed(false)}
                      title="Podrz pre zobrazenie pristupoveho kodu"
                    >
                      Zobrazit
                    </button>

                    <button
                      type="button"
                      style={styles.lightButton}
                      disabled={accessCodeLoading || !accessCodeValue}
                      onClick={copyAccessCode}
                      title="Kopirovat pristupovy kod"
                    >
                      {accessCodeCopied ? 'Skopirovane' : 'Kopirovat'}
                    </button>

                    <button
                      type="button"
                      style={styles.confirmButton}
                      disabled={accessCodeLoading}
                      onClick={generateAccessCodeForSelectedPerson}
                    >
                      {accessCodeValue ? 'Vygenerovat novy' : 'Vygenerovat kod'}
                    </button>
                  </div>
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

              {shouldShowDetailMessage && (
                <div
                  ref={detailMessageRef}
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
          </aside>
        )}
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
    background: '#eef0f3',
    padding: 8,
    display: 'grid',
    gap: 8,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: 12,
    color: '#111827'
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '7px 9px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  mobileHeader: {
    display: 'grid',
    alignItems: 'start'
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 800,
    color: '#6b7280',
    marginBottom: 3
  },
  title: {
    margin: 0,
    fontSize: 19,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '2px 0 0 0',
    fontSize: 11,
    fontWeight: 750,
    color: '#6b7280'
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  currentUserPill: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: '5px 8px',
    background: '#f9fafb',
    display: 'grid',
    gap: 1,
    minWidth: 150,
    maxWidth: 230
  },
  currentUserLabel: {
    fontSize: 9,
    fontWeight: 900,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  currentUserName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontWeight: 950,
    color: '#111827'
  },
  currentUserRole: {
    fontSize: 9,
    fontWeight: 950,
    color: '#2563eb'
  },
  mobileActionStrip: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: 'max-content',
    justifyContent: 'start',
    overflowX: 'auto',
    overflowY: 'hidden',
    flexWrap: 'nowrap',
    width: '100%',
    paddingBottom: 2,
    WebkitOverflowScrolling: 'touch'
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))',
    gap: 4
  },
  mobileSummaryStrip: {
    gridTemplateColumns: 'none',
    gridAutoFlow: 'column',
    gridAutoColumns: '112px',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: 2,
    WebkitOverflowScrolling: 'touch'
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    minHeight: 38
  },
  summaryCardBlue: {
    background: '#eff6ff',
    border: '1px solid #93c5fd',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#1d4ed8',
    minHeight: 38
  },
  summaryCardGreen: {
    background: '#ecfdf5',
    border: '1px solid #86efac',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#166534',
    minHeight: 38
  },
  summaryCardRed: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#991b1b',
    minHeight: 38
  },
  summaryCardYellow: {
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#92400e',
    minHeight: 38
  },
  summaryCardOrange: {
    background: '#fff7ed',
    border: '1px solid #fdba74',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#9a3412',
    minHeight: 38
  },
  summaryCardPink: {
    background: '#fdf2f8',
    border: '1px solid #f9a8d4',
    borderRadius: 6,
    padding: '5px 7px',
    display: 'grid',
    gap: 3,
    color: '#9d174d',
    minHeight: 38
  },
  actionPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 6,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 5,
    minWidth: 0
  },
  toolbarStartGroup: {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: 5,
    flex: '0 0 auto',
    minWidth: 0
  },
  iconActionGroup: {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: 5,
    flex: '0 0 auto'
  },
  iconActionButton: {
    width: 36,
    minHeight: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 0,
    cursor: 'pointer'
  },
  scopeToggle: {
    background: '#f8fafc',
    border: '1px solid #c7d2fe',
    borderRadius: 7,
    padding: 3,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 3,
    minWidth: 164
  },
  scopeToggleButton: {
    borderRadius: 5,
    padding: '6px 8px',
    color: '#3730a3',
    fontSize: 11,
    fontWeight: 950,
    textAlign: 'center',
    textDecoration: 'none'
  },
  scopeToggleButtonActive: {
    background: '#7c3aed',
    color: '#fff',
    boxShadow: '0 2px 6px rgba(124, 58, 237, 0.28)'
  },
  mobileActionStripPanel: {
    flexWrap: 'nowrap',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: 6,
    WebkitOverflowScrolling: 'touch'
  },
  layoutGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 410px)',
    gap: 8,
    alignItems: 'start'
  },
  layoutGridFull: {
    gridTemplateColumns: 'minmax(0, 1fr)'
  },
  leftColumn: {
    minWidth: 0,
    display: 'grid',
    gap: 10
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 6,
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1.2fr) repeat(4, minmax(120px, 0.7fr))',
    gap: 5
  },
  mobileToolbar: {
    gridTemplateColumns: 'none',
    gridAutoFlow: 'column',
    gridAutoColumns: '220px',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: 6,
    WebkitOverflowScrolling: 'touch'
  },
  mobileToolbarHint: {
    display: 'none'
  },
  toolbarHint: {
    gridColumn: '1 / -1',
    fontSize: 10,
    fontWeight: 800,
    color: '#6b7280',
    minHeight: 16,
    boxSizing: 'border-box',
    padding: 0,
    display: 'flex',
    alignItems: 'center'
  },
  toolbarHintLoading: {
    color: '#3730a3',
    background: 'transparent'
  },
  toolbarHintSuccess: {
    color: '#166534',
    background: 'transparent'
  },
  toolbarHintError: {
    color: '#991b1b',
    background: 'transparent'
  },
  inlineDivider: {
    height: 1,
    background: '#e5e7eb',
    margin: '4px 0'
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '7px 8px',
    fontSize: 13,
    fontWeight: 750,
    outline: 'none',
    background: '#fff',
    color: '#111827'
  },
  select: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '7px 7px',
    fontSize: 13,
    fontWeight: 750,
    background: '#fff',
    color: '#111827'
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    overflowX: 'auto',
    boxShadow: 'none'
  },
  tableHeader: {
    minWidth: 920,
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.3fr) 70px minmax(135px, 0.9fr) minmax(135px, 1fr) 62px 58px 68px',
    gap: 6,
    alignItems: 'center',
    padding: '6px 8px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  personRow: {
    width: '100%',
    minWidth: 920,
    border: '0 solid #e5e7eb',
    borderBottomWidth: 1,
    padding: '5px 8px',
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.3fr) 70px minmax(135px, 0.9fr) minmax(135px, 1fr) 62px 58px 68px',
    gap: 6,
    alignItems: 'center',
    textAlign: 'left',
    color: '#111827',
    cursor: 'pointer',
    fontSize: 11
  },
  personCell: {
    minWidth: 0,
    display: 'grid',
    gap: 1
  },
  personMeta: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 9,
    fontWeight: 850,
    color: '#6b7280'
  },
  groupBadges: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 3
  },
  groupBadge: {
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '2px 5px',
    background: '#f3f4f6',
    color: '#374151',
    fontSize: 9,
    fontWeight: 900
  },
  registrationGroupBadge: {
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '2px 5px',
    background: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fde68a',
    fontSize: 9,
    fontWeight: 900
  },
  assignmentStack: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
    alignContent: 'center'
  },
  assignmentLine: {
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 6,
    alignItems: 'baseline',
    color: '#4b5563',
    fontSize: 10,
    fontWeight: 850,
    lineHeight: 1.2
  },
  assignmentName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'left'
  },
  assignmentRange: {
    whiteSpace: 'nowrap',
    color: '#6b7280',
    fontSize: 9,
    fontWeight: 800,
    textAlign: 'right'
  },
  assignmentFallback: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#6b7280',
    fontSize: 10,
    fontWeight: 850,
    lineHeight: 1.2
  },
  moreBadge: {
    borderRadius: 999,
    padding: '2px 5px',
    background: '#111827',
    color: '#fff',
    fontSize: 9,
    fontWeight: 900
  },
  foodBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '3px 6px',
    fontSize: 9,
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
    padding: '3px 5px',
    fontSize: 9,
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
    padding: '3px 6px',
    fontSize: 9,
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
    borderRadius: 6,
    padding: 8,
    display: 'grid',
    gap: 8,
    boxShadow: 'none',
    position: 'sticky',
    top: 8,
    maxHeight: 'calc(100vh - 16px)',
    overflow: 'auto'
  },
  mobileDetailPanel: {
    width: '100%',
    maxHeight: 'none',
    minHeight: 'calc(100vh - 8px)',
    position: 'static',
    top: 'auto',
    borderRadius: 8,
    padding: 10,
    boxSizing: 'border-box',
    overflow: 'visible',
    alignSelf: 'start',
    borderColor: '#dbeafe',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)'
  },
  mobileHiddenListColumn: {
    display: 'none'
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  mobileDetailHeader: {
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  collapseDetailButton: {
    width: 26,
    height: 26,
    borderRadius: 5,
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    color: '#374151',
    fontSize: 15,
    fontWeight: 950,
    cursor: 'pointer',
    lineHeight: 1
  },
  mobileBackToListButton: {
    width: 'auto',
    height: 32,
    minWidth: 94,
    padding: '0 12px',
    borderRadius: 999,
    borderColor: '#111827',
    background: '#111827',
    color: '#fff',
    fontSize: 12,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5
  },
  detailSmall: {
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280'
  },
  detailTitle: {
    margin: '3px 0 0 0',
    fontSize: 16,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  detailRows: {
    display: 'grid',
    gap: 4
  },
  detailRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gap: 3,
    overflowWrap: 'anywhere'
  },
  detailEmailValue: {
    display: 'block',
    minWidth: 0,
    width: '100%',
    wordBreak: 'break-all',
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
    gap: 4
  },
  detailGroupRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 6,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center'
  },
  registrationPeriodRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    background: '#fff',
    cursor: 'pointer'
  },
  registrationPeriodRowIdle: {
    border: '1px solid #e5e7eb',
    background: '#fff',
    boxShadow: 'none',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none'
  },
  registrationPeriodRowSelected: {
    border: '1px solid #fb923c',
    background: '#fff7ed',
    boxShadow: '0 0 0 2px #fdba74 inset'
  },
  registrationPeriodGapRow: {
    border: '1px solid #fecaca',
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gap: 4,
    background: '#fff1f2',
    color: '#991b1b',
    cursor: 'pointer'
  },
  registrationPeriodGapRowIdle: {
    border: '1px solid #fecaca',
    background: '#fff1f2',
    boxShadow: 'none',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none'
  },
  registrationPeriodGapRowSelected: {
    border: '1px solid #f97316',
    background: '#ffedd5',
    boxShadow: '0 0 0 2px #fb923c inset'
  },
  registrationPeriodInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  registrationPeriodActions: {
    display: 'flex',
    gap: 4,
    alignItems: 'center'
  },
  smallEditButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: '1px solid #bfdbfe',
    background: '#fff',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 950,
    lineHeight: 1,
    cursor: 'pointer'
  },
  smallRemoveButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#b91c1c',
    fontSize: 15,
    fontWeight: 950,
    lineHeight: 1,
    cursor: 'pointer'
  },
  detailActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 5
  },
  mobileDetailActions: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    overflowX: 'visible',
    overflowY: 'visible',
    paddingBottom: 0,
    gap: 6
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
  pendingApprovalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'flex-start',
    flexWrap: 'wrap'
  },
  pendingApprovalHeaderText: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  pendingStepGrid: {
    display: 'grid',
    gap: 8
  },
  pendingStepBox: {
    border: '1px solid #fcd34d',
    borderRadius: 8,
    padding: 8,
    display: 'grid',
    gap: 7,
    background: '#fff',
    color: '#374151',
    minWidth: 0
  },
  pendingStepTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    fontWeight: 950,
    color: '#111827'
  },
  pendingStepTitleButton: {
    width: '100%',
    border: 0,
    padding: 0,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    fontWeight: 950,
    color: '#111827',
    textAlign: 'left',
    cursor: 'pointer'
  },
  pendingStepNumber: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#7c3aed',
    color: '#fff',
    fontSize: 12,
    fontWeight: 950
  },
  pendingStepSummary: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 7,
    display: 'grid',
    gap: 3,
    background: '#f9fafb',
    color: '#374151',
    overflowWrap: 'anywhere'
  },
  pendingPeriodList: {
    display: 'grid',
    gap: 6
  },
  pendingPeriodRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 7,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    background: '#f9fafb',
    color: '#374151',
    minWidth: 0
  },
  detailHeaderBadges: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  mobileDetailHeaderBadges: {
    width: '100%',
    justifyContent: 'flex-start'
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
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gap: 6,
    background: '#f9fafb',
    minWidth: 0
  },
  detailEditBoxSoft: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gap: 6,
    background: '#fff',
    minWidth: 0
  },
  detailEditTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  detailEditGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 135px), 1fr))',
    gap: 5
  },
  detailEditGridWide: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 5,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box'
  },
  detailEditFullRow: {
    gridColumn: '1 / -1'
  },
  primaryAction: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  createPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 8,
    display: 'grid',
    gap: 8,
    boxShadow: 'none'
  },
  createHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10
  },
  accountTypeSwitch: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 6
  },
  accountTypeButton: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: 8,
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    cursor: 'pointer'
  },
  accountTypeButtonActive: {
    borderColor: '#fb923c',
    background: '#fff7ed',
    boxShadow: '0 0 0 2px #fdba74 inset'
  },
  createGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 6
  },
  toolActionRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  communicationResendBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fbfbfd',
    padding: 10,
    display: 'grid',
    gap: 8
  },
  toolStatsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 5
  },
  toolStat: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#f9fafb',
    padding: '6px 8px',
    display: 'grid',
    gap: 2,
    minHeight: 44,
    color: '#111827'
  },
  toolStatWarning: {
    border: '1px solid #fed7aa',
    borderRadius: 6,
    background: '#fff7ed',
    padding: '6px 8px',
    display: 'grid',
    gap: 2,
    minHeight: 44,
    color: '#9a3412'
  },
  toolStatBlue: {
    border: '1px solid #bfdbfe',
    borderRadius: 6,
    background: '#eff6ff',
    padding: '6px 8px',
    display: 'grid',
    gap: 2,
    minHeight: 44,
    color: '#1d4ed8'
  },
  toolStatGreen: {
    border: '1px solid #bbf7d0',
    borderRadius: 6,
    background: '#f0fdf4',
    padding: '6px 8px',
    display: 'grid',
    gap: 2,
    minHeight: 44,
    color: '#166534'
  },
  managerResultList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 5
  },
  managerResultButton: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    background: '#fff',
    padding: '7px 8px',
    display: 'grid',
    gap: 2,
    textAlign: 'left',
    cursor: 'pointer',
    color: '#111827'
  },
  managerResultButtonActive: {
    borderColor: '#fb923c',
    background: '#fff7ed',
    boxShadow: '0 0 0 2px #fdba74 inset'
  },
  managerOverviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
    gap: 6
  },
  managerGroupCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    display: 'grid',
    gap: 6,
    padding: 7,
    minWidth: 0
  },
  managerGroupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'flex-start',
    borderBottom: '1px solid #f3f4f6',
    paddingBottom: 5
  },
  managerList: {
    display: 'grid',
    gap: 4
  },
  managerRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 6,
    alignItems: 'center',
    border: '1px solid #f3f4f6',
    borderRadius: 5,
    padding: 6,
    background: '#f9fafb'
  },
  managerPersonInfo: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  managerEmpty: {
    border: '1px dashed #d1d5db',
    borderRadius: 5,
    padding: 8,
    fontSize: 11,
    fontWeight: 850,
    color: '#6b7280',
    background: '#f9fafb'
  },
  createOptionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 6
  },
  optionBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: 6,
    display: 'grid',
    gap: 5,
    background: '#f9fafb'
  },
  accessCodeBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#f9fafb',
    padding: 8,
    display: 'grid',
    gap: 5
  },
  accessCodeValue: {
    fontSize: 22,
    letterSpacing: 0,
    fontWeight: 950,
    color: '#111827',
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  accessCodeActions: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  registrationSection: {
    borderTop: '1px solid #e5e7eb',
    paddingTop: 12,
    display: 'grid',
    gap: 10
  },
  registrationPeopleSection: {
    border: '1px solid #bfdbfe',
    borderLeft: '4px solid #2563eb',
    borderRadius: 6,
    background: '#f8fbff',
    padding: 8,
    display: 'grid',
    gap: 8
  },
  registrationEntitlementSection: {
    border: '1px solid #bbf7d0',
    borderLeft: '4px solid #16a34a',
    borderRadius: 6,
    background: '#f8fff9',
    padding: 8,
    display: 'grid',
    gap: 8
  },
  registrationSectionHeader: {
    display: 'grid',
    gridTemplateColumns: '26px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'start',
    borderBottom: '1px solid rgba(17,24,39,0.08)',
    paddingBottom: 6,
    fontSize: 12,
    color: '#111827'
  },
  registrationSectionBadgeBlue: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2563eb',
    color: '#fff',
    fontSize: 11,
    fontWeight: 950
  },
  registrationSectionBadgeGreen: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#16a34a',
    color: '#fff',
    fontSize: 11,
    fontWeight: 950
  },
  dangerSection: {
    border: '1px solid #fecaca',
    borderLeft: '4px solid #dc2626',
    borderRadius: 6,
    background: '#fff7f7',
    padding: 8,
    display: 'grid',
    gap: 6
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
  infoNotice: {
    border: '1px solid #fde68a',
    borderRadius: 6,
    background: '#fffbeb',
    color: '#92400e',
    padding: '7px 8px',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 850
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
  cancelledEntitlementPill: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca'
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
  qrRuleList: {
    display: 'grid',
    gap: 6
  },
  qrRuleRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(58px, 0.65fr) minmax(72px, 0.8fr) minmax(72px, 0.8fr) auto auto',
    gap: 6,
    alignItems: 'end',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 6,
    background: '#f9fafb',
    minWidth: 0
  },
  mobileQrRuleRow: {
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    alignItems: 'end'
  },
  compactCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 31,
    fontSize: 11,
    fontWeight: 950,
    color: '#374151',
    whiteSpace: 'nowrap'
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
    color: '#6b7280',
    minWidth: 0
  },
  fieldWarning: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#b91c1c',
    minWidth: 0
  },
  input: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minInlineSize: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '7px 8px',
    fontSize: 13,
    fontWeight: 750,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  mobileDateControl: {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    height: 30,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    background: '#fff',
    overflow: 'hidden'
  },
  mobileDateValue: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '0 7px',
    boxSizing: 'border-box',
    color: '#111827',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none'
  },
  mobileDateNativeInput: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    maxWidth: '100%',
    minWidth: 0,
    opacity: 0,
    border: 0,
    padding: 0,
    margin: 0,
    cursor: 'pointer'
  },
  inputWarning: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minInlineSize: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    border: '2px solid #ef4444',
    borderRadius: 5,
    padding: '7px 8px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff7f7',
    color: '#991b1b',
    outline: 'none'
  },
  compactSelect: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '6px 6px',
    fontSize: 11,
    fontWeight: 900,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 5,
    border: '1px solid #e5e7eb',
    background: '#f3f4f6',
    color: '#111827',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1,
    cursor: 'pointer'
  },
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  confirmButtonPurple: {
    background: '#7417e8',
    color: '#fff',
    border: '1px solid #4c1d95',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer'
  },
  dangerButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
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
    minWidth: 920,
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
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
    background: '#fff',
    color: '#111827',
    border: '1px solid #d1d5db',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer',
    opacity: 1
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 5,
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  pendingReviewButton: {
    background: '#fef3c7',
    color: '#92400e',
    borderColor: '#f59e0b',
    boxShadow: '0 0 0 2px rgba(245, 158, 11, 0.18)'
  },
  blockedButton: {
    background: '#fee2e2',
    color: '#991b1b',
    borderColor: '#f87171',
    boxShadow: '0 0 0 2px rgba(248, 113, 113, 0.18)'
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
