'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QrCameraScanner from './QrCameraScanner'

type MealType = 'OBED' | 'VECERA'
type MealSelection = MealType | ''

type RegistrationGroupOption = {
  id: string
  name: string
  canManageDelegates: boolean
  canSearchAllDelegates?: boolean
  accessLabel: string
}

type Delegate = {
  id: string
  userId: string
  registrationGroupId: string
  name: string
  email: string
  note: string
  createdAt: string
}

type SearchUser = {
  id: string
  name: string
  email: string
}

type IssuePerson = {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  choice: 'MASO' | 'VEGE' | 'DIETA'
  source: 'REGISTRATION_GROUP' | 'SEARCH' | 'QR'
  issuable?: boolean
  issueStatus?: string
  issueStatusLabel?: string
  itemStatus?: string
}

type ExistingIssue = {
  id: string
  title: string
  meal: MealType
  status: string
  validAfter: string | null
  summary: {
    MASO: number
    VEGE: number
    DIETA: number
    SPOLU: number
  }
}

type Props = {
  initialDate: string
  groups: RegistrationGroupOption[]
  delegatesByGroupId: Record<string, Delegate[]>
}

const MEAL_OPTIONS: Array<{ value: MealType, label: string }> = [
  { value: 'OBED', label: 'Obed' },
  { value: 'VECERA', label: 'Vecera' }
]
const PWA_DISABLE_PULL_REFRESH_CLASS = 'pwa-disable-pull-refresh'

function fullDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '-'

  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function mealLabel(value: MealSelection) {
  return MEAL_OPTIONS.find(option => option.value === value)?.label || 'Vyberte jedlo'
}

function dateTimeLabel(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: 'Europe/Bratislava',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function remainingLabel(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function waitingInfo(validAfter: string | null, nowMs: number) {
  if (!validAfter) return null

  const targetMs = Date.parse(validAfter)
  if (Number.isNaN(targetMs)) return null

  const diff = targetMs - nowMs

  return {
    active: diff > 0,
    countdown: diff > 0 ? remainingLabel(diff) : '0:00',
    startsAt: dateTimeLabel(validAfter)
  }
}

function sourceLabel(value: IssuePerson['source']) {
  if (value === 'REGISTRATION_GROUP') return 'Skupina'
  if (value === 'QR') return 'QR'
  return 'Vyhladane'
}

function isIssuePersonReady(person: IssuePerson) {
  return person.issuable !== false
}

function displayIssuePersonName(person: IssuePerson) {
  const firstName = String(person.firstName || '').trim()
  const lastName = String(person.lastName || '').trim()

  if (lastName || firstName) return `${lastName} ${firstName}`.trim()
  return person.name
}

function compareIssuePeople(a: IssuePerson, b: IssuePerson) {
  const aLastName = String(a.lastName || '').trim()
  const bLastName = String(b.lastName || '').trim()
  const aFirstName = String(a.firstName || '').trim()
  const bFirstName = String(b.firstName || '').trim()

  return (
    aLastName.localeCompare(bLastName, 'sk', { sensitivity: 'base' }) ||
    aFirstName.localeCompare(bFirstName, 'sk', { sensitivity: 'base' }) ||
    a.name.localeCompare(b.name, 'sk', { sensitivity: 'base' }) ||
    a.email.localeCompare(b.email, 'sk', { sensitivity: 'base' })
  )
}

function compareSearchUsers(a: SearchUser, b: SearchUser) {
  return (
    a.name.localeCompare(b.name, 'sk', { sensitivity: 'base' }) ||
    a.email.localeCompare(b.email, 'sk', { sensitivity: 'base' })
  )
}

function issuePersonToSearchUser(person: IssuePerson): SearchUser {
  return {
    id: person.id,
    name: displayIssuePersonName(person),
    email: person.email || ''
  }
}

function mergeSearchUsers(...lists: SearchUser[][]) {
  const usersById = new Map<string, SearchUser>()

  for (const list of lists) {
    for (const user of list) {
      if (!user?.id || usersById.has(user.id)) continue
      usersById.set(user.id, user)
    }
  }

  return Array.from(usersById.values()).sort(compareSearchUsers)
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false

  const ids = new Set(a)
  return b.every(id => ids.has(id))
}

export default function SkupinovyVydajClient({ initialDate, groups, delegatesByGroupId }: Props) {
  const pageRef = useRef<HTMLElement | null>(null)
  const delegateSearchRequestRef = useRef(0)
  const delegateSearchModeRef = useRef<'group' | 'outside'>('group')
  const [date, setDate] = useState(initialDate)
  const [meal, setMeal] = useState<MealSelection>('')
  const [confirmed, setConfirmed] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issuePeople, setIssuePeople] = useState<IssuePerson[]>([])
  const [selectedIssueUserIds, setSelectedIssueUserIds] = useState<string[]>([])
  const [issuePeopleConfirmed, setIssuePeopleConfirmed] = useState(false)
  const [pickupUserIds, setPickupUserIds] = useState<string[]>([])
  const [pickupUsers, setPickupUsers] = useState<SearchUser[]>([])
  const [issuePersonFilter, setIssuePersonFilter] = useState('')
  const [pickupQuery, setPickupQuery] = useState('')
  const [pickupResults, setPickupResults] = useState<SearchUser[]>([])
  const [pickupLoading, setPickupLoading] = useState(false)
  const [pickupSearchOutside, setPickupSearchOutside] = useState(false)
  const [pendingPickupExternalUsers, setPendingPickupExternalUsers] = useState<SearchUser[]>([])
  const [pickupModalOpen, setPickupModalOpen] = useState(false)
  const [pendingPickupUserIds, setPendingPickupUserIds] = useState<string[]>([])
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveTargetIssueId, setMoveTargetIssueId] = useState('')
  const [existingIssues, setExistingIssues] = useState<ExistingIssue[]>([])
  const [editingIssueId, setEditingIssueId] = useState('')
  const [editingIssueStatus, setEditingIssueStatus] = useState('')
  const [editingIssueValidAfter, setEditingIssueValidAfter] = useState<string | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueFeedback, setIssueFeedback] = useState('')
  const [issueFeedbackType, setIssueFeedbackType] = useState<'ok' | 'error'>('ok')
  const [createdIssue, setCreatedIssue] = useState<any>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [existingLoading, setExistingLoading] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState(groups.length === 1 ? groups[0]?.id || '' : '')
  const [delegatesPanelOpen, setDelegatesPanelOpen] = useState(false)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [groupQuery, setGroupQuery] = useState('')
  const [delegateMap, setDelegateMap] = useState<Record<string, Delegate[]>>(delegatesByGroupId)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [delegateSearchAll, setDelegateSearchAll] = useState(false)
  const [pendingDelegateExternalUsers, setPendingDelegateExternalUsers] = useState<SearchUser[]>([])
  const [pendingDelegateUserIds, setPendingDelegateUserIds] = useState<string[]>([])
  const [delegateListReady, setDelegateListReady] = useState(false)
  const [delegateNote, setDelegateNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'error'>('ok')
  const [nowMs, setNowMs] = useState(() => Date.now())

  const selectedGroup = useMemo(() => {
    return groups.find(group => group.id === selectedGroupId) || null
  }, [groups, selectedGroupId])

  const filteredGroups = useMemo(() => {
    const query = groupQuery.trim().toLowerCase()
    if (!query) return groups

    return groups.filter(group => group.name.toLowerCase().includes(query))
  }, [groups, groupQuery])

  const delegates = selectedGroupId ? delegateMap[selectedGroupId] || [] : []
  const daySelectionReady = Boolean(date && selectedGroupId)
  const selectedIssuePeople = issuePeople.filter(person => selectedIssueUserIds.includes(person.id))
  const selectedMovableIssuePeople = selectedIssuePeople.filter(person => person.itemStatus === 'PLANNED')
  const selectedHasUnmovablePeople = selectedIssuePeople.some(person => person.itemStatus !== 'PLANNED')
  const selectedIssuablePeople = selectedIssuePeople.filter(isIssuePersonReady)
  const selectedSummary = selectedIssuablePeople.reduce((summary, person) => {
    summary[person.choice] += 1
    summary.SPOLU += 1
    return summary
  }, { MASO: 0, VEGE: 0, DIETA: 0, SPOLU: 0 })
  const filteredIssuePeople = useMemo(() => {
    const query = issuePersonFilter.trim().toLowerCase()
    const filtered = query
      ? issuePeople.filter(person => {
          return [
            displayIssuePersonName(person),
            person.name,
            person.email,
            person.choice,
            sourceLabel(person.source),
            person.issueStatusLabel || ''
          ].join(' ').toLowerCase().includes(query)
        })
      : issuePeople

    return [...filtered].sort(compareIssuePeople)
  }, [issuePeople, issuePersonFilter])
  const issuePickupCandidates = useMemo(() => {
    return selectedIssuePeople.map(issuePersonToSearchUser)
  }, [selectedIssuePeople])
  const delegateCandidates = useMemo(() => {
    const selectedDelegates = delegates.map(delegate => ({
        id: delegate.userId,
        name: delegate.name,
        email: delegate.email || ''
    }))

    return delegateSearchAll
      ? mergeSearchUsers(pendingDelegateExternalUsers, searchResults)
      : mergeSearchUsers(selectedDelegates, issuePickupCandidates, searchResults)
  }, [delegateSearchAll, delegates, issuePickupCandidates, pendingDelegateExternalUsers, searchResults])
  const pickupCandidateUsers = useMemo(() => {
    return pickupSearchOutside
      ? mergeSearchUsers(pendingPickupExternalUsers, pickupResults)
      : mergeSearchUsers(pickupUsers, issuePickupCandidates, pickupResults)
  }, [pickupSearchOutside, pickupUsers, issuePickupCandidates, pendingPickupExternalUsers, pickupResults])
  const delegateUserIds = useMemo(() => delegates.map(delegate => delegate.userId), [delegates])
  const delegateSelectionChanged = !sameIds(delegateUserIds, pendingDelegateUserIds)
  const pickupSelectionChanged = !sameIds(pickupUserIds, pendingPickupUserIds)
  const moveTargetIssues = useMemo(() => {
    return existingIssues.filter(issue => {
      return issue.id !== editingIssueId && issue.meal === meal && issue.status !== 'CANCELLED'
    })
  }, [editingIssueId, existingIssues, meal])
  const editingWaitingInfo = editingIssueStatus === 'WAITING'
    ? waitingInfo(editingIssueValidAfter, nowMs)
    : null
  const editWillResetWaiting = Boolean(editingIssueId && selectedGroup && !selectedGroup.canManageDelegates)

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return

    let touchStartY = 0
    const root = document.documentElement
    const body = document.body
    const previousRootOverscroll = root.style.getPropertyValue('overscroll-behavior-y')
    const previousBodyOverscroll = body.style.getPropertyValue('overscroll-behavior-y')
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousRootHeight = root.style.height
    const previousBodyHeight = body.style.height
    const previousBodyPosition = body.style.position
    const previousBodyInset = body.style.inset
    const previousBodyWidth = body.style.width
    const previousViewportHeight = root.style.getPropertyValue('--group-issue-viewport-height')

    root.classList.add(PWA_DISABLE_PULL_REFRESH_CLASS)
    root.style.setProperty('overscroll-behavior-y', 'none')
    body.style.setProperty('overscroll-behavior-y', 'none')
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    root.style.height = '100%'
    body.style.height = '100%'
    body.style.position = 'fixed'
    body.style.inset = '0'
    body.style.width = '100%'

    function updateViewportHeight() {
      const height = window.visualViewport?.height || window.innerHeight
      root.style.setProperty('--group-issue-viewport-height', `${height}px`)
      window.requestAnimationFrame(keepPageScrollInside)
    }

    function keepPageScrollInside() {
      const page = pageRef.current
      if (!page || page.scrollHeight <= page.clientHeight + 2) return

      if (page.scrollTop <= 0) {
        page.scrollTop = 1
        return
      }

      const maxScrollTop = page.scrollHeight - page.clientHeight
      if (page.scrollTop >= maxScrollTop) {
        page.scrollTop = Math.max(1, maxScrollTop - 1)
      }
    }

    function findScrollableParent(target: EventTarget | null) {
      let element = target instanceof HTMLElement ? target : null

      while (element && element !== document.body) {
        const style = window.getComputedStyle(element)
        const canScroll = (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          element.scrollHeight > element.clientHeight
        )

        if (canScroll) return element
        element = element.parentElement
      }

      return null
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) return
      touchStartY = event.touches[0].clientY
    }

    function onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 1) return

      const deltaY = event.touches[0].clientY - touchStartY
      if (deltaY <= 0) return

      const scrollableParent = findScrollableParent(event.target)
      if (scrollableParent && scrollableParent.scrollTop > 0) return

      if (window.scrollY <= 0 || scrollableParent?.scrollTop === 0) {
        event.preventDefault()
      }
    }

    const page = pageRef.current

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    page?.addEventListener('touchstart', onTouchStart, { passive: true })
    page?.addEventListener('touchmove', onTouchMove, { passive: false })
    page?.addEventListener('scroll', keepPageScrollInside, { passive: true })
    updateViewportHeight()
    keepPageScrollInside()
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.addEventListener('resize', updateViewportHeight)

    return () => {
      root.classList.remove(PWA_DISABLE_PULL_REFRESH_CLASS)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchmove', onTouchMove)
      page?.removeEventListener('touchstart', onTouchStart)
      page?.removeEventListener('touchmove', onTouchMove)
      page?.removeEventListener('scroll', keepPageScrollInside)
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('resize', updateViewportHeight)
      root.style.setProperty('overscroll-behavior-y', previousRootOverscroll)
      body.style.setProperty('overscroll-behavior-y', previousBodyOverscroll)
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      root.style.height = previousRootHeight
      body.style.height = previousBodyHeight
      body.style.position = previousBodyPosition
      body.style.inset = previousBodyInset
      body.style.width = previousBodyWidth
      root.style.setProperty('--group-issue-viewport-height', previousViewportHeight)
    }
  }, [])

  function setMessage(message: string, type: 'ok' | 'error' = 'ok') {
    setFeedback(message)
    setFeedbackType(type)
  }

  function setIssueMessage(message: string, type: 'ok' | 'error' = 'ok') {
    setIssueFeedback(message)
    setIssueFeedbackType(type)
  }

  function resetDelegateSearchMode(searchAll: boolean) {
    delegateSearchModeRef.current = searchAll ? 'outside' : 'group'
    delegateSearchRequestRef.current += 1
    setSearchQuery('')
    setSearchResults([])
    setLoading(false)
  }

  function selectRegistrationGroup(nextGroupId: string) {
    setSelectedGroupId(nextGroupId)
    setGroupPickerOpen(false)
    setGroupQuery('')
    setDelegatesPanelOpen(false)
    setDelegateSearchAll(false)
    setSearchQuery('')
    setSearchResults([])
    setDelegateNote('')
    setFeedback('')
    resetIssueState({ preserveMeal: true })
  }

  async function openDelegateModal() {
    setDelegatesPanelOpen(true)
    setDelegateSearchAll(false)
    setPendingDelegateUserIds(delegates.map(delegate => delegate.userId))
    setPendingDelegateExternalUsers([])
    setDelegateListReady(false)
    setMessage('')
    await searchUsers('', false)
    setDelegateListReady(true)
  }

  function closeDelegateModal() {
    setDelegatesPanelOpen(false)
    setDelegateSearchAll(false)
    setSearchQuery('')
    setSearchResults([])
    setPendingDelegateUserIds([])
    setPendingDelegateExternalUsers([])
    setDelegateListReady(false)
    setDelegateNote('')
    setMessage('')
  }

  function openPickupModal() {
    setPickupModalOpen(true)
    setPickupSearchOutside(false)
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupExternalUsers([])
    setPendingPickupUserIds(pickupUserIds)
  }

  function closePickupModal() {
    setPickupModalOpen(false)
    setPickupSearchOutside(false)
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupUserIds([])
    setPendingPickupExternalUsers([])
  }

  const renderDateInput = (
    value: string,
    onChange: (value: string) => void,
    disabled: boolean,
    placeholder = 'Vyber datum'
  ) => (
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

  function resetIssueState(options: { clearExisting?: boolean, preserveMeal?: boolean } = {}) {
    const clearExisting = options.clearExisting ?? true

    setConfirmed(false)
    if (!options.preserveMeal) setMeal('')
    setIssueTitle('')
    setIssuePeople([])
    setSelectedIssueUserIds([])
    setIssuePeopleConfirmed(false)
    setPickupUserIds([])
    setPickupUsers([])
    setIssuePersonFilter('')
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupExternalUsers([])
    setMoveModalOpen(false)
    setMoveTargetIssueId('')
    if (clearExisting) {
      setExistingIssues([])
    }
    setEditingIssueId('')
    setEditingIssueStatus('')
    setEditingIssueValidAfter(null)
    setIssueFeedback('')
    setCreatedIssue(null)
  }

  async function loadExistingIssuesFor(
    nextGroupId = selectedGroupId,
    nextDate = date,
    nextMeal: MealSelection = meal
  ) {
    if (!nextGroupId || !nextDate) {
      setExistingIssues([])
      return []
    }

    const params = new URLSearchParams({
      registrationGroupId: nextGroupId,
      date: nextDate
    })
    if (nextMeal) params.set('meal', nextMeal)

    setExistingLoading(true)

    try {
      const res = await fetch(`/api/skupinovy-vydaj/issues?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Existujuce vydaje sa nepodarilo nacitat.')

      const issues = json.issues || []
      setExistingIssues(issues)
      return issues
    } finally {
      setExistingLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedGroupId || !date || confirmed) return

    void loadExistingIssuesFor(selectedGroupId, date, '').catch((err: any) => {
      setIssueMessage(err?.message || 'Existujuce vydaje sa nepodarilo nacitat.', 'error')
    })
  }, [selectedGroupId, date, confirmed])

  async function loadIssuePeople(nextMeal: MealType) {
    if (!selectedGroupId || !date) return

    setIssueLoading(true)
    setIssueMessage('')
    setCreatedIssue(null)
    setMeal(nextMeal)

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        date,
        meal: nextMeal
      })
      const res = await fetch(`/api/skupinovy-vydaj/options?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Ludi sa nepodarilo nacitat.')

      const people: IssuePerson[] = json.people || []
      setIssueTitle('')
      setIssuePeople(people)
      setSelectedIssueUserIds([])
      setPickupUserIds([])
      setPickupUsers([])
      setIssuePersonFilter('')
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupExternalUsers([])
      setIssuePeopleConfirmed(false)
      setEditingIssueId('')
      setEditingIssueStatus('')
      setEditingIssueValidAfter(null)
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setConfirmed(true)
      const excludedCount = Number(json.plannedExcludedCount || 0)
      setIssueMessage(
        people.length
          ? excludedCount > 0
            ? `Nacitanych ${people.length} zvysnych vydatelnych osob. Ludia uz pripraveni v inom skupinovom vydaji su vynechani.`
            : `Nacitanych ${people.length} aktualne vydatelnych osob.`
          : 'Pre tento vyber nie je aktualne nikto vydatelny.',
        people.length ? 'ok' : 'error'
      )
    } catch (err: any) {
      setIssueMessage(err?.message || 'Ludi sa nepodarilo nacitat.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function editExistingIssue(issueId: string) {
    setIssueLoading(true)
    setIssueMessage('')
    setCreatedIssue(null)

    try {
      const params = new URLSearchParams({ issueId })
      const res = await fetch(`/api/skupinovy-vydaj/issues?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Skupinovy vydaj sa nepodarilo nacitat.')

      const issue = json.issue
      const people: IssuePerson[] = (issue.people || []).filter((person: IssuePerson) => person.itemStatus !== 'REMOVED')

      setEditingIssueId(issue.id)
      setEditingIssueStatus(issue.status || '')
      setEditingIssueValidAfter(issue.validAfter || null)
      setMeal(issue.meal || '')
      setIssueTitle(issue.title || '')
      setIssuePeople(people)
      setSelectedIssueUserIds(people.filter(person => person.itemStatus !== 'REMOVED').map(person => person.id))
      setIssuePeopleConfirmed(true)
      setPickupUserIds(issue.pickupUserIds || [])
      setPickupUsers(issue.pickupUsers || [])
      setIssuePersonFilter('')
      setPickupQuery('')
      setPickupResults([])
      setMoveModalOpen(false)
      setMoveTargetIssueId('')
      setConfirmed(true)
      setIssueMessage('Skupinovy vydaj je nacitany na upravu.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinovy vydaj sa nepodarilo nacitat.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function cancelExistingIssue(issue: ExistingIssue) {
    const ok = window.confirm(`Zrusit skupinovy vydaj "${issue.title}"?`)
    if (!ok) return

    setIssueLoading(true)
    setIssueMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/issues', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Skupinovy vydaj sa nepodarilo zrusit.')

      if (editingIssueId === issue.id) resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || 'Skupinovy vydaj bol zruseny.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinovy vydaj sa nepodarilo zrusit.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function addIssuePersonByQr(qrCode: string) {
    if (!selectedGroupId || !date || !meal) {
      return {
        tone: 'error' as const,
        message: 'Najprv vyber registracnu skupinu, datum a jedlo.'
      }
    }

    const res = await fetch('/api/skupinovy-vydaj/qr-person', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationGroupId: selectedGroupId,
        date,
        meal,
        qrCode
      })
    })
    const json = await res.json()

    if (!res.ok || !json.person) {
      const message = json.error || 'QR sa nepodarilo pridat.'
      setIssueMessage(message, 'error')
      return {
        tone: 'error' as const,
        message
      }
    }

    addIssuePerson(json.person)
    const message = `${json.person.name || 'Osoba'} pridana cez QR.`
    setIssueMessage(message)

    return {
      tone: 'success' as const,
      message
    }
  }

  function addIssuePerson(person: IssuePerson) {
    setIssuePeople(current => {
      if (current.some(item => item.id === person.id)) return current
      return [...current, person]
    })
    setSelectedIssueUserIds(current => {
      if (current.includes(person.id)) return current
      return [...current, person.id]
    })
    if (!editingIssueId) setIssuePeopleConfirmed(false)
  }

  function toggleIssuePerson(userId: string) {
    if (!editingIssueId) setIssuePeopleConfirmed(false)
    setSelectedIssueUserIds(current => {
      return current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    })
  }

  function handleBulkIssueSelection(action: string) {
    if (!editingIssueId) setIssuePeopleConfirmed(false)

    if (action === 'ALL') {
      setSelectedIssueUserIds(issuePeople.map(person => person.id))
      return
    }

    if (action === 'READY') {
      setSelectedIssueUserIds(issuePeople.filter(isIssuePersonReady).map(person => person.id))
      return
    }

    if (action === 'NONE') {
      setSelectedIssueUserIds([])
    }
  }

  function confirmIssuePeople() {
    if (selectedIssuePeople.length === 0) {
      setIssueMessage('Vyber aspon jednu osobu.', 'error')
      return
    }

    setIssuePeopleConfirmed(true)
    setIssueMessage('Osoby vo vydaji su potvrdene. Teraz vyber, kto moze vydaj prevziat.')
    openPickupModal()
  }

  function openMoveModal() {
    if (!editingIssueId || selectedIssuePeople.length === 0) return

    if (selectedHasUnmovablePeople) {
      setIssueMessage('Presunut je mozne iba osoby, ktore este nemaju vydane jedlo.', 'error')
      return
    }

    setMoveTargetIssueId(moveTargetIssues[0]?.id || '')
    setMoveModalOpen(true)
  }

  function closeMoveModal() {
    setMoveModalOpen(false)
    setMoveTargetIssueId('')
  }

  async function moveSelectedPeople() {
    if (!editingIssueId || !moveTargetIssueId || selectedMovableIssuePeople.length === 0) return

    setIssueLoading(true)
    setIssueMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/issues/move-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromIssueId: editingIssueId,
          toIssueId: moveTargetIssueId,
          userIds: selectedMovableIssuePeople.map(person => person.id)
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Osoby sa nepodarilo presunut.')

      const currentIssueId = editingIssueId
      closeMoveModal()
      await editExistingIssue(currentIssueId)
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || 'Osoby boli presunute.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Osoby sa nepodarilo presunut.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function searchPickupUsers(query: string, searchOutside = pickupSearchOutside) {
    setPickupQuery(query)
    setPickupResults([])

    if (!selectedGroupId || query.trim().length < 3) return

    setPickupLoading(true)

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        mode: 'pickup',
        date,
        q: query
      })
      if (searchOutside) params.set('scope', 'outside')
      const res = await fetch(`/api/skupinovy-vydaj/people-search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhladavanie zlyhalo.')

      setPickupResults(json.people || [])
    } catch (err: any) {
      setIssueMessage(err?.message || 'Vyhladavanie zlyhalo.', 'error')
    } finally {
      setPickupLoading(false)
    }
  }

  function togglePendingPickupUser(userId: string) {
    setPendingPickupUserIds(current => {
      return current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    })
  }

  function addOutsidePickupUser(user: SearchUser) {
    setPendingPickupUserIds(current => current.includes(user.id) ? current : [...current, user.id])
    setPendingPickupExternalUsers(current => mergeSearchUsers(current, [user]))
    setPickupQuery('')
    setPickupResults([])
  }

  async function savePickupSelection() {
    if (pendingPickupUserIds.length === 0) {
      setIssueMessage('Pridaj aspon jednu osobu opravnenu prevziat vydaj.', 'error')
      return
    }

    const usersById = new Map(mergeSearchUsers(pickupCandidateUsers, pendingPickupExternalUsers).map(user => [user.id, user]))
    const nextUsers = pendingPickupUserIds
      .map(id => usersById.get(id))
      .filter(Boolean) as SearchUser[]

    if (!editingIssueId) {
      setPickupUsers(nextUsers)
      setPickupUserIds(pendingPickupUserIds)
      setPickupModalOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupExternalUsers([])
      return
    }

    setIssueLoading(true)
    setIssueMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/issues/pickup-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: editingIssueId,
          pickupUserIds: pendingPickupUserIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Opravneni prevziat sa nepodarilo ulozit.')

      setPickupUsers(json.pickupUsers || nextUsers)
      setPickupUserIds(json.pickupUserIds || pendingPickupUserIds)
      setPickupModalOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupExternalUsers([])
      setIssueMessage(json.message || 'Opravneni prevziat boli ulozeni.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Opravneni prevziat sa nepodarilo ulozit.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function saveIssue() {
    if (!selectedGroupId || !date || !meal || selectedIssuePeople.length === 0) {
      setIssueMessage('Vyber aspon jednu osobu.', 'error')
      return
    }

    if (!editingIssueId && !issuePeopleConfirmed) {
      setIssueMessage('Najprv potvrd osoby vo vydaji a potom vyber opravnenych prevziat.', 'error')
      return
    }

    if (pickupUserIds.length === 0) {
      setIssueMessage('Pridaj aspon jednu osobu opravnenu prevziat vydaj.', 'error')
      return
    }

    const wasEditing = Boolean(editingIssueId)

    if (editWillResetWaiting) {
      const ok = window.confirm('Ulozenim uprav sa skupinovy vydaj znova aktivuje az o 15 minut. Pokracovat?')
      if (!ok) return
    }

    setIssueLoading(true)
    setIssueMessage('')
    setCreatedIssue(null)

    try {
      const res = await fetch('/api/skupinovy-vydaj/issues', {
        method: editingIssueId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: editingIssueId,
          registrationGroupId: selectedGroupId,
          date,
          meal,
          title: issueTitle,
          people: selectedIssuePeople.map(person => ({
            userId: person.id,
            source: person.source
          })),
          pickupUserIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Skupinovy vydaj sa nepodarilo ulozit.')

      const successMessage = json.message || (wasEditing
        ? 'Skupinovy vydaj bol upraveny.'
        : 'Skupinovy vydaj bol vytvoreny.')

      setQrModalOpen(false)

      resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(successMessage)
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinovy vydaj sa nepodarilo ulozit.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function searchUsers(query: string, searchAll = delegateSearchAll) {
    const searchMode = searchAll ? 'outside' : 'group'
    const requestId = delegateSearchRequestRef.current + 1
    delegateSearchRequestRef.current = requestId
    delegateSearchModeRef.current = searchMode

    setSearchQuery(query)
    setSearchResults([])

    const searchText = query.trim()

    if (!selectedGroupId) return
    if (searchAll && searchText.length < 3) return

    setLoading(true)
    setMessage('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        date,
        q: searchAll || searchText.length >= 3 ? searchText : ''
      })
      if (searchAll) params.set('scope', 'outside')
      const res = await fetch(`/api/skupinovy-vydaj/delegates/search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhladavanie zlyhalo.')
      if (delegateSearchRequestRef.current !== requestId || delegateSearchModeRef.current !== searchMode) return

      setSearchResults(json.users || [])
    } catch (err: any) {
      if (delegateSearchRequestRef.current !== requestId || delegateSearchModeRef.current !== searchMode) return
      setMessage(err?.message || 'Vyhladavanie zlyhalo.', 'error')
    } finally {
      if (delegateSearchRequestRef.current === requestId && delegateSearchModeRef.current === searchMode) {
        setLoading(false)
      }
    }
  }

  function togglePendingDelegateUser(userId: string) {
    setPendingDelegateUserIds(current => {
      return current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    })
  }

  function addOutsideDelegateUser(user: SearchUser) {
    setPendingDelegateUserIds(current => current.includes(user.id) ? current : [...current, user.id])
    setPendingDelegateExternalUsers(current => mergeSearchUsers(current, [user]))
    setSearchQuery('')
    setSearchResults([])
  }

  async function addPendingDelegates() {
    if (!selectedGroupId) return

    const selectedIds = new Set(pendingDelegateUserIds)
    const existingIds = new Set(delegates.map(delegate => delegate.userId))
    const usersById = new Map(mergeSearchUsers(delegateCandidates, pendingDelegateExternalUsers).map(user => [user.id, user]))
    const delegatesToRemove = delegates.filter(delegate => !selectedIds.has(delegate.userId))
    const usersToAdd = pendingDelegateUserIds
      .filter(userId => !existingIds.has(userId))
      .map(userId => usersById.get(userId))
      .filter(Boolean) as SearchUser[]

    if (delegatesToRemove.length === 0 && usersToAdd.length === 0) {
      setMessage('Nie je co ulozit.')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      let latestDelegates: Delegate[] | null = null

      for (const delegate of delegatesToRemove) {
        const res = await fetch('/api/skupinovy-vydaj/delegates', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delegateId: delegate.id })
        })
        const json = await res.json()

        if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo odobrat.')
        latestDelegates = json.delegates || latestDelegates
      }

      for (const user of usersToAdd) {
        const res = await fetch('/api/skupinovy-vydaj/delegates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            registrationGroupId: selectedGroupId,
            date,
            note: delegateNote
          })
        })
        const json = await res.json()

        if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo pridat.')
        latestDelegates = json.delegates || latestDelegates
      }

      if (latestDelegates) {
        setDelegateMap(current => ({
          ...current,
          [selectedGroupId]: latestDelegates
        }))
        setPendingDelegateUserIds(latestDelegates.map(delegate => delegate.userId))
      }
      setDelegateNote('')
      setPendingDelegateExternalUsers([])
      setMessage(`Ulozene. Pridane: ${usersToAdd.length}, odobrate: ${delegatesToRemove.length}.`)
    } catch (err: any) {
      setMessage(err?.message || 'Poverene osoby sa nepodarilo ulozit.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main ref={pageRef} className="group-issue-page" style={styles.page}>
      <style>{`
        .group-issue-page button,
        .group-issue-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(34, 197, 94, 0.18);
        }

        .group-issue-page button:not(:disabled):active,
        .group-issue-page a[href]:active {
          transform: translateY(1px) scale(0.99);
          filter: brightness(0.97);
        }

        .group-issue-page button:disabled {
          cursor: wait;
          opacity: 0.7;
        }

        .group-issue-page small {
          display: block;
          color: #6b7280;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        @media (max-width: 720px) {
          .group-issue-page {
            position: fixed !important;
            inset: 0 !important;
            width: 100% !important;
            height: var(--group-issue-viewport-height, 100dvh) !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-y: none !important;
            padding: 10px 10px max(10px, env(safe-area-inset-bottom)) 10px !important;
          }
          .pwa-ios-standalone .group-issue-page {
            padding-top: max(18px, calc(env(safe-area-inset-top) + 12px)) !important;
          }
          .group-issue-shell { gap: 8px !important; }
          .group-issue-layout { grid-template-columns: 1fr !important; }
          .group-issue-sidebar { order: 1 !important; }
          .group-issue-main { order: 3 !important; }
          .group-issue-header { align-items: stretch !important; flex-direction: column !important; }
          .group-issue-title { font-size: 24px !important; }
          .group-issue-actions { grid-template-columns: 1fr !important; }
          .group-issue-top { align-items: stretch !important; flex-direction: column !important; }
          .delegate-row { grid-template-columns: 1fr auto !important; }
          .issue-count-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .issue-person-row { grid-template-columns: 1fr !important; }
          .issue-person-meta { justify-content: flex-start !important; }
          .workflow-steps { grid-template-columns: 1fr !important; }
          .group-picker-menu {
            position: fixed !important;
            left: 10px !important;
            right: 10px !important;
            top: 120px !important;
            max-height: calc(100vh - 150px) !important;
          }
        }
      `}</style>

      <div className="group-issue-shell" style={styles.shell}>
        <header className="group-issue-header" style={styles.header}>
          <div>
            <h1 className="group-issue-title" style={styles.title}>Skupinovy vydaj</h1>
            <p style={styles.subtitle}>Priprava vydaja pre registracne skupiny a poverenych ludi.</p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            Spat
          </Link>
        </header>

        {groups.length === 0 ? (
          <div style={styles.messageError}>Nemate pridelenu registracnu skupinu pre skupinovy vydaj.</div>
        ) : (
          <div className="group-issue-layout" style={styles.layout}>
            {confirmed && (
              <section className="group-issue-main" style={styles.mainPanel}>
                <div style={styles.prepHeading}>
                  <div style={styles.prepHeadingInfo}>
                    <span style={styles.summaryLabel}>Pripravujes</span>
                    <b>{mealLabel(meal)}</b>
                    <small>{selectedGroup?.name || '-'} / {fullDateLabel(date)}</small>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      resetIssueState({ clearExisting: false, preserveMeal: true })
                      void loadExistingIssuesFor(selectedGroupId, date, '')
                    }}
                    style={styles.smallButtonWhite}
                  >
                    Zmenit
                  </button>
                </div>

                <label style={styles.field}>
                  <span style={styles.label}>Nazov skupinoveho vydaja</span>
                  <input
                    type="text"
                    value={issueTitle}
                    onChange={event => setIssueTitle(event.target.value)}
                    placeholder="Volitelne, inak sa nazov vytvori automaticky"
                    style={styles.input}
                  />
                </label>

                {editingWaitingInfo && (
                  <div style={styles.waitingNotice}>
                    <b>{editingWaitingInfo.active ? `Zacne platit o ${editingWaitingInfo.countdown}` : 'Platnost by mala byt aktivna'}</b>
                    <span>Planovana platnost: {editingWaitingInfo.startsAt}</span>
                  </div>
                )}

                {editWillResetWaiting && (
                  <div style={styles.resetWaitingNotice}>
                    Ulozenim uprav sa tento skupinovy vydaj znova aktivuje az o 15 minut.
                  </div>
                )}

                <div className="workflow-steps" style={styles.workflowSteps}>
                  <div style={{ ...styles.workflowStep, ...styles.workflowStepActive }}>
                    <span style={styles.workflowStepNumber}>1</span>
                    <div style={styles.workflowStepText}>
                      <b>Osoby vo vydaji</b>
                      <small>Vyber ludi, pre ktorych sa pripravuje jedlo.</small>
                    </div>
                  </div>

                  <div
                    style={{
                      ...styles.workflowStep,
                      ...(editingIssueId || issuePeopleConfirmed ? styles.workflowStepActive : styles.workflowStepLocked)
                    }}
                  >
                    <span style={styles.workflowStepNumber}>2</span>
                    <div style={styles.workflowStepText}>
                      <b>Opravneni prevziat</b>
                      <small>{editingIssueId || issuePeopleConfirmed ? 'Vyber osoby, ktore mozu vydaj prevziat.' : 'Tento krok sa otvori po potvrdeni osob.'}</small>
                    </div>
                  </div>
                </div>

                <div style={styles.issueToolbar}>
                  <button
                    type="button"
                    onClick={() => setQrModalOpen(true)}
                    disabled={issueLoading || !selectedGroupId || !date || !meal}
                    style={styles.darkButton}
                  >
                    Pridat cez QR
                  </button>

                  {editingIssueId && (
                    <button
                      type="button"
                      onClick={openMoveModal}
                      disabled={
                        issueLoading ||
                        selectedMovableIssuePeople.length === 0 ||
                        selectedHasUnmovablePeople ||
                        moveTargetIssues.length === 0
                      }
                      style={styles.secondaryButton}
                    >
                      Presunut ({selectedMovableIssuePeople.length})
                    </button>
                  )}
                </div>

                <div style={styles.peopleSectionHeader}>
                  <b>Osoby vo vydaji</b>
                  <span>{selectedSummary.SPOLU} vydatelnych / {selectedIssueUserIds.length} oznacenych / {issuePeople.length} spolu</span>
                </div>

                <div style={styles.bulkButtonRow}>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('ALL')}
                    disabled={issueLoading || issuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Vsetci
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('READY')}
                    disabled={issueLoading || issuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Vydatelni
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('NONE')}
                    disabled={issueLoading || issuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Ziadni
                  </button>
                </div>

                <input
                  type="search"
                  value={issuePersonFilter}
                  onChange={event => setIssuePersonFilter(event.target.value)}
                  placeholder="Hladat v osobach vo vydaji"
                  style={styles.filterInput}
                  disabled={issuePeople.length === 0}
                />

                <div style={styles.issuePeopleList}>
                  {issuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento datum a jedlo nie je aktualne nikto vydatelny.</div>
                  ) : filteredIssuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>Nic sa nenaslo.</div>
                  ) : (
                    filteredIssuePeople.map(person => {
                      const selected = selectedIssueUserIds.includes(person.id)
                      const ready = isIssuePersonReady(person)

                      return (
                        <div
                          key={person.id}
                          className="issue-person-row"
                          style={{
                            ...styles.issuePersonRow,
                            ...(selected ? styles.issuePersonRowSelected : {}),
                            ...(!ready ? styles.issuePersonRowMuted : {})
                          }}
                        >
                          <label style={styles.personCheckLabel}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleIssuePerson(person.id)}
                              style={styles.checkbox}
                            />
                            <span>
                              <b>{displayIssuePersonName(person)}</b>
                              {person.email && <small>{person.email}</small>}
                            </span>
                          </label>

                          <div className="issue-person-meta" style={styles.personMeta}>
                            <span style={styles.choicePill}>{person.choice}</span>
                            <span style={ready ? styles.statusPillReady : styles.statusPillWarning}>
                              {person.issueStatusLabel || (ready ? 'Pripravene' : 'Nevydatelne')}
                            </span>
                            <span style={styles.sourcePill}>{sourceLabel(person.source)}</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {editingIssueId || issuePeopleConfirmed ? (
                  <div style={styles.pickupStepCard}>
                    <div style={styles.pickupStepInfo}>
                      <b>Opravneni prevziat</b>
                      <span>
                        {pickupUserIds.length > 0
                          ? `${pickupUserIds.length} osob moze prevziat tento vydaj.`
                          : 'Zatial nie je pridana ziadna osoba na prevzatie.'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={openPickupModal}
                      disabled={issueLoading}
                      style={styles.secondaryButton}
                    >
                      Upravit prevzatie
                    </button>
                  </div>
                ) : (
                  <div style={styles.nextStepHint}>
                    Najprv potvrd osoby vo vydaji. Skupinovy vydaj sa este neulozi.
                  </div>
                )}

                {!editingIssueId && !issuePeopleConfirmed ? (
                  <button
                    type="button"
                    onClick={confirmIssuePeople}
                    disabled={issueLoading || selectedIssuePeople.length === 0}
                    style={{ ...styles.primaryButton, marginTop: 14, width: '100%' }}
                  >
                    Potvrdit osoby a pokracovat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={saveIssue}
                    disabled={issueLoading || selectedIssuePeople.length === 0 || pickupUserIds.length === 0}
                    style={{ ...styles.primaryButton, marginTop: 14, width: '100%' }}
                  >
                    {issueLoading ? 'Ukladam...' : editingIssueId ? 'Ulozit skupinovy vydaj' : 'Ulozit skupinovy vydaj'}
                  </button>
                )}

                {createdIssue && (
                  <div style={styles.createdBox}>
                    <b>{createdIssue.title}</b>
                    <span>
                      MASO {createdIssue.summary?.MASO || 0} / VEGE {createdIssue.summary?.VEGE || 0} / DIETA {createdIssue.summary?.DIETA || 0} / SPOLU {createdIssue.summary?.SPOLU || 0}
                    </span>
                    {createdIssue.status === 'WAITING' && <span>Platnost zacne o 15 minut.</span>}
                  </div>
                )}

                {issueFeedback && (
                  <div style={issueFeedbackType === 'ok' ? styles.feedbackOk : styles.feedbackError}>
                    {issueFeedback}
                  </div>
                )}
              </section>
            )}

            <aside className="group-issue-sidebar" style={styles.sidebar}>
              {!confirmed && (
              <section style={{ ...styles.panel, order: 1 }}>
                <div style={styles.panelHeaderRow}>
                  <div style={styles.panelTitle}>Vyber vydaja</div>
                  <span style={styles.kicker}>Krok 1</span>
                </div>

                <div style={styles.formGrid}>
                  <div style={styles.field}>
                    <span>Registracna skupina</span>
                    <div style={styles.groupPicker}>
                      <button
                        type="button"
                        onClick={() => setGroupPickerOpen(current => !current)}
                        style={styles.groupPickerButton}
                      >
                        <span>{selectedGroup?.name || 'Vyberte'}</span>
                        <b>{groupPickerOpen ? '^' : 'v'}</b>
                      </button>

                      {groupPickerOpen && (
                        <div className="group-picker-menu" style={styles.groupPickerMenu}>
                          <input
                            type="search"
                            value={groupQuery}
                            onChange={event => setGroupQuery(event.target.value)}
                            placeholder="Hladat registracnu skupinu"
                            style={styles.filterInput}
                          />

                          <div style={styles.groupPickerList}>
                            {filteredGroups.length === 0 ? (
                              <div style={styles.emptyBox}>Skupina sa nenasla.</div>
                            ) : (
                              filteredGroups.map(group => (
                                <button
                                  key={group.id}
                                  type="button"
                                  onClick={() => selectRegistrationGroup(group.id)}
                                  style={{
                                    ...styles.groupPickerOption,
                                    ...(group.id === selectedGroupId ? styles.groupPickerOptionActive : {})
                                  }}
                                >
                                  {group.name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <label style={styles.field}>
                    <span>Datum</span>
                    {renderDateInput(
                      date,
                      value => {
                        setDate(value)
                        resetIssueState({ preserveMeal: true })
                      },
                      issueLoading,
                      'Vyber datum'
                    )}
                  </label>

                  <label style={styles.field}>
                    <span>Jedlo pre novy vydaj</span>
                    <select
                      value={meal}
                      onChange={event => {
                        setMeal(event.target.value as MealSelection)
                        resetIssueState({ clearExisting: false, preserveMeal: true })
                      }}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="">Vyberte jedlo</option>
                      {MEAL_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {selectedGroup?.canManageDelegates && (
                  <div style={styles.delegateSummaryCard}>
                    <div style={styles.delegateSummaryText}>
                      <b>Poverene osoby pre tuto skupinu</b>
                      <span>{delegates.length} osob</span>
                    </div>

                    <button
                      type="button"
                      onClick={openDelegateModal}
                      style={styles.smallButtonWhite}
                    >
                      Spravovat
                    </button>
                  </div>
                )}
              </section>
              )}

              {!confirmed && daySelectionReady && (
                <section style={{ ...styles.panel, order: 3 }}>
                  <div style={styles.delegateHeader}>
                    <div>
                      <h2 style={styles.delegateTitle}>Vydaje pre den</h2>
                      <p style={styles.delegateHint}>{selectedGroup?.name || '-'} / {fullDateLabel(date)}</p>
                    </div>
                    <span style={styles.countBadge}>{existingIssues.length}</span>
                  </div>

                  {existingLoading ? (
                    <div style={styles.emptyBox}>Nacitavam existujuce vydaje...</div>
                  ) : existingIssues.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento den zatial nie je vytvoreny ziaden vydaj.</div>
                  ) : (
                    <div style={styles.existingIssuesList}>
                      {existingIssues.map(issue => {
                        const issueWaitingInfo = issue.status === 'WAITING'
                          ? waitingInfo(issue.validAfter, nowMs)
                          : null

                        return (
                          <div
                            key={issue.id}
                            style={{
                              ...styles.existingIssueRow,
                              ...(editingIssueId === issue.id ? styles.existingIssueRowActive : {})
                            }}
                          >
                            <div style={styles.existingIssueInfo}>
                              <b>{issue.title}</b>
                              <small>
                                <span style={styles.mealBadge}>{mealLabel(issue.meal)}</span>
                                MASO {issue.summary?.MASO || 0} / VEGE {issue.summary?.VEGE || 0} / DIETA {issue.summary?.DIETA || 0} / SPOLU {issue.summary?.SPOLU || 0}
                              </small>
                              {issueWaitingInfo && (
                                <span style={styles.waitingInline}>
                                  {issueWaitingInfo.active
                                    ? `Zacne platit o ${issueWaitingInfo.countdown}`
                                    : 'Platnost by mala byt aktivna'}
                                  {issueWaitingInfo.startsAt ? ` / ${issueWaitingInfo.startsAt}` : ''}
                                </span>
                              )}
                            </div>

                            <div style={styles.existingIssueActions}>
                              <button
                                type="button"
                                onClick={() => editExistingIssue(issue.id)}
                                disabled={issueLoading}
                                style={styles.smallEditButton}
                                title="Zmenit vydaj"
                              >
                                Z
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelExistingIssue(issue)}
                                disabled={issueLoading}
                                style={styles.smallRemoveButton}
                                title="Zrusit vydaj"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div style={styles.prepareActions}>
                    <button
                      type="button"
                      onClick={() => {
                        if (meal) void loadIssuePeople(meal)
                      }}
                      disabled={issueLoading || !meal}
                      style={{ ...styles.primaryButton, alignSelf: 'end', width: '100%' }}
                    >
                      {issueLoading ? 'Nacitavam...' : meal ? 'Pripravit novy vydaj' : 'Vyber jedlo pre novy vydaj'}
                    </button>
                  </div>

                  {!confirmed && issueFeedback && (
                    <div style={issueFeedbackType === 'ok' ? styles.feedbackOk : styles.feedbackError}>
                      {issueFeedback}
                    </div>
                  )}
                </section>
              )}
            </aside>
          </div>
        )}

        {qrModalOpen && (
          <div style={styles.modalOverlay} onClick={() => setQrModalOpen(false)}>
            <div style={styles.qrModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>Pridat cez QR</b>
                  <span>Skenujte QR kody postupne. Osoby sa budu pridavat do pripravovaneho vydaja.</span>
                </div>

                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  style={styles.qrCloseButton}
                  disabled={issueLoading}
                >
                  x
                </button>
              </div>

              <QrCameraScanner
                disabled={issueLoading || !selectedGroupId || !date || !meal}
                onScan={addIssuePersonByQr}
              />
            </div>
          </div>
        )}

        {moveModalOpen && (
          <div style={styles.modalOverlay} onClick={closeMoveModal}>
            <div style={styles.peopleModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>Presunut oznacenych</b>
                  <span>{selectedMovableIssuePeople.length} osob / {mealLabel(meal)} / {fullDateLabel(date)}</span>
                </div>

                <button
                  type="button"
                  onClick={closeMoveModal}
                  style={styles.qrCloseButton}
                  disabled={issueLoading}
                >
                  x
                </button>
              </div>

              <div style={styles.modalScrollBody}>
                <div style={styles.searchBox}>
                  <div style={styles.peopleSectionHeader}>
                    <b>Cielovy vydaj</b>
                    <span>{moveTargetIssues.length} moznosti</span>
                  </div>

                  {moveTargetIssues.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento datum a jedlo neexistuje iny skupinovy vydaj.</div>
                  ) : (
                    <div style={styles.searchResults}>
                      {moveTargetIssues.map(issue => {
                        const selected = moveTargetIssueId === issue.id
                        return (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => setMoveTargetIssueId(issue.id)}
                            style={{
                              ...styles.resultButton,
                              ...(selected ? styles.resultButtonSelected : {})
                            }}
                          >
                            <span style={{
                              ...styles.resultMarker,
                              ...(selected ? styles.resultMarkerSelected : {})
                            }}>
                              {selected ? '✓' : ''}
                            </span>
                            <span style={styles.resultText}>
                              <b>{issue.title}</b>
                              <small>
                                MASO {issue.summary.MASO} / VEGE {issue.summary.VEGE} / DIETA {issue.summary.DIETA} / SPOLU {issue.summary.SPOLU}
                              </small>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={moveSelectedPeople}
                  disabled={issueLoading || !moveTargetIssueId || selectedMovableIssuePeople.length === 0}
                  style={styles.primaryButton}
                >
                  {issueLoading ? 'Presuvam...' : `Presunut (${selectedMovableIssuePeople.length})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {delegatesPanelOpen && selectedGroup && (
          <div style={styles.modalOverlay} onClick={closeDelegateModal}>
            <div style={styles.peopleModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>Sprava poverenych osob</b>
                  <span>{selectedGroup.name}</span>
                </div>

                <button
                  type="button"
                  onClick={closeDelegateModal}
                  style={styles.qrCloseButton}
                  disabled={loading}
                >
                  x
                </button>
              </div>

              {!selectedGroup.canManageDelegates ? (
                <div style={styles.modalScrollBody}>
                  <div style={styles.infoBox}>Tuto cast moze menit iba manager registracnej skupiny.</div>
                </div>
              ) : (
                <>
                  <div style={styles.modalScrollBody}>
                    <div style={styles.searchBox}>
                    <div style={styles.peopleSectionHeader}>
                      <b>Poverene osoby</b>
                      <span>{pendingDelegateUserIds.length} oznacenych / {delegateCandidates.length} v zozname</span>
                    </div>

                    {selectedGroup.canSearchAllDelegates && (
                      <div style={styles.segment}>
                        <button
                          type="button"
                          onClick={() => {
                            setDelegateSearchAll(false)
                            resetDelegateSearchMode(false)
                            void searchUsers('', false)
                          }}
                          style={{
                            ...styles.segmentButton,
                            ...(!delegateSearchAll ? styles.segmentButtonActive : {})
                          }}
                        >
                          Zo skupiny
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDelegateSearchAll(true)
                            resetDelegateSearchMode(true)
                          }}
                          style={{
                            ...styles.segmentButton,
                            ...(delegateSearchAll ? styles.segmentButtonActive : {})
                          }}
                        >
                          Mimo skupiny
                        </button>
                      </div>
                    )}

                    <label style={styles.field}>
                      <span style={styles.label}>
                        {delegateSearchAll ? 'Vyhladat mimo registracnej skupiny' : 'Vyhladat v registracnej skupine'}
                      </span>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={event => searchUsers(event.target.value)}
                        placeholder={delegateSearchAll ? 'Zadaj aspon 3 znaky mimo skupiny' : 'Zoznam skupiny alebo hladaj od 3 znakov'}
                        style={styles.input}
                      />
                    </label>

                    <label style={styles.field}>
                      <span style={styles.label}>Poznamka</span>
                      <input
                        type="text"
                        value={delegateNote}
                        onChange={event => setDelegateNote(event.target.value)}
                        placeholder="Volitelne"
                        style={styles.input}
                      />
                    </label>

                    {loading && <div style={styles.emptyBox}>Nacitavam...</div>}

                    <div style={styles.searchResults}>
                      {!delegateListReady ? (
                        <div style={styles.emptyBox}>Nacitavam osoby zo skupiny...</div>
                      ) : delegateCandidates.length === 0 ? (
                        <div style={styles.emptyBox}>
                          {delegateSearchAll
                            ? 'Pre vyhladavanie mimo skupiny zadaj aspon 3 znaky.'
                            : 'V skupine nie je nikto dalsi na pridanie.'}
                        </div>
                      ) : (
                        delegateCandidates.map(user => {
                          const originallySelected = delegateUserIds.includes(user.id)
                          const selected = pendingDelegateUserIds.includes(user.id)
                          const changed = originallySelected !== selected
                          const willAdd = selected && !originallySelected
                          const willRemove = !selected && originallySelected

                          return (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => delegateSearchAll ? addOutsideDelegateUser(user) : togglePendingDelegateUser(user.id)}
                              disabled={loading}
                              style={{
                                ...styles.resultButton,
                                ...(selected && !willAdd ? styles.resultButtonSelected : {}),
                                ...(willAdd ? styles.resultButtonAdded : {}),
                                ...(willRemove ? styles.resultButtonRemoved : {})
                              }}
                            >
                              <span style={{
                                ...styles.resultMarker,
                                ...(selected ? styles.resultMarkerSelected : {}),
                                ...(willRemove ? styles.resultMarkerRemoved : {})
                              }}>
                                {selected ? '✓' : willRemove ? '-' : ''}
                              </span>
                              <span style={styles.resultText}>
                                <b>{user.name}</b>
                                {user.email && <span>{user.email}</span>}
                                <small>
                                  {delegateSearchAll
                                    ? selected ? 'Uz oznaceny' : 'Kliknutim pridas'
                                    : changed
                                      ? selected ? 'Bude pridany po ulozeni' : 'Bude odobraty po ulozeni'
                                      : selected ? 'Povereny' : 'Kliknutim oznacis'}
                                </small>
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                    </div>
                  </div>

                  <div style={styles.modalFooter}>
                    {feedback && (
                      <div style={feedbackType === 'ok' ? styles.feedbackOkCompact : styles.feedbackErrorCompact}>
                        {feedback}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={addPendingDelegates}
                      disabled={loading || !delegateListReady || !delegateSelectionChanged}
                      style={styles.primaryButton}
                    >
                      {loading ? 'Ukladam...' : `Ulozit zmeny (${pendingDelegateUserIds.length})`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {pickupModalOpen && (
          <div style={styles.modalOverlay} onClick={closePickupModal}>
            <div style={styles.peopleModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>Opravneni prevziat</b>
                  <span>Osoby, ktore mozu prevziat tento skupinovy vydaj.</span>
                </div>

                <button
                  type="button"
                  onClick={closePickupModal}
                  style={styles.qrCloseButton}
                  disabled={issueLoading}
                >
                  x
                </button>
              </div>

              <div style={styles.modalScrollBody}>
                <div style={styles.searchBox}>
                  <div style={styles.peopleSectionHeader}>
                    <b>Opravneni prevziat</b>
                    <span>{pendingPickupUserIds.length} oznacenych / {pickupCandidateUsers.length} v zozname</span>
                  </div>

                  {selectedGroup?.canSearchAllDelegates && (
                    <div style={styles.segment}>
                      <button
                        type="button"
                        onClick={() => {
                          setPickupSearchOutside(false)
                          setPickupQuery('')
                          setPickupResults([])
                        }}
                        style={{
                          ...styles.segmentButton,
                          ...(!pickupSearchOutside ? styles.segmentButtonActive : {})
                        }}
                      >
                        Zo skupiny
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPickupSearchOutside(true)
                          setPickupQuery('')
                          setPickupResults([])
                        }}
                        style={{
                          ...styles.segmentButton,
                          ...(pickupSearchOutside ? styles.segmentButtonActive : {})
                        }}
                      >
                        Mimo skupiny
                      </button>
                    </div>
                  )}

                  <label style={styles.field}>
                    <span style={styles.label}>
                      {pickupSearchOutside ? 'Vyhladat mimo registracnej skupiny' : 'Vyhladat v registracnej skupine'}
                    </span>
                    <input
                      type="search"
                      value={pickupQuery}
                      onChange={event => searchPickupUsers(event.target.value)}
                      placeholder={pickupSearchOutside ? 'Zadaj aspon 3 znaky mimo skupiny' : 'Zadaj aspon 3 znaky v skupine'}
                      style={styles.input}
                      disabled={issueLoading}
                    />
                  </label>

                  {pickupLoading && <div style={styles.emptyBox}>Vyhladavam...</div>}

                  <div style={styles.searchResults}>
                    {pickupCandidateUsers.length === 0 ? (
                      <div style={styles.emptyBox}>
                        {pickupSearchOutside
                          ? 'Pre vyhladavanie mimo skupiny zadaj aspon 3 znaky.'
                          : 'Vyber osoby vo vydaji alebo zadaj aspon 3 znaky v skupine.'}
                      </div>
                    ) : (
                      pickupCandidateUsers.map(user => {
                        const originallySelected = pickupUserIds.includes(user.id)
                        const selected = pendingPickupUserIds.includes(user.id)
                        const changed = originallySelected !== selected
                        const willAdd = selected && !originallySelected
                        const willRemove = !selected && originallySelected

                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => pickupSearchOutside ? addOutsidePickupUser(user) : togglePendingPickupUser(user.id)}
                            style={{
                              ...styles.resultButton,
                              ...(selected && !willAdd ? styles.resultButtonSelected : {}),
                              ...(willAdd ? styles.resultButtonAdded : {}),
                              ...(willRemove ? styles.resultButtonRemoved : {})
                            }}
                          >
                            <span style={{
                              ...styles.resultMarker,
                              ...(selected ? styles.resultMarkerSelected : {}),
                              ...(willRemove ? styles.resultMarkerRemoved : {})
                            }}>
                              {selected ? '✓' : willRemove ? '-' : ''}
                            </span>
                            <span style={styles.resultText}>
                              <b>{user.name}</b>
                              {user.email && <span>{user.email}</span>}
                              <small>
                                {pickupSearchOutside
                                  ? selected ? 'Uz oznaceny' : 'Kliknutim pridas'
                                  : changed
                                    ? selected ? 'Bude pridany po ulozeni' : 'Bude odobraty po ulozeni'
                                    : selected ? 'Opravneny' : 'Kliknutim oznacis'}
                              </small>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={savePickupSelection}
                  disabled={issueLoading || !pickupSelectionChanged}
                  style={styles.primaryButton}
                >
                  {issueLoading
                    ? 'Ukladam...'
                    : editingIssueId
                      ? `Ulozit zmeny (${pendingPickupUserIds.length})`
                      : `Potvrdit prevzatie (${pendingPickupUserIds.length})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 14,
    color: '#111827',
    fontFamily: 'Arial, Helvetica, sans-serif',
    overscrollBehaviorY: 'none'
  },
  shell: {
    maxWidth: 1040,
    margin: '0 auto',
    display: 'grid',
    gap: 10
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 950,
    color: '#111827'
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280',
    lineHeight: 1.3
  },
  backButton: {
    minHeight: 34,
    background: '#111827',
    color: '#fff',
    border: '1px solid #111827',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 900,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 10,
    alignItems: 'start'
  },
  sidebar: {
    display: 'contents',
    minWidth: 0
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    boxShadow: '0 1px 2px rgba(17, 24, 39, 0.04)'
  },
  mainPanel: {
    minWidth: 0,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    boxShadow: '0 1px 2px rgba(17, 24, 39, 0.04)',
    order: 4
  },
  prepHeading: {
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    padding: 10,
    marginBottom: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    color: '#14532d',
    fontSize: 13,
    fontWeight: 900
  },
  prepHeadingInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  workflowSteps: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 8,
    marginTop: 10
  },
  workflowStep: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 9,
    display: 'grid',
    gap: 7,
    alignItems: 'start',
    minWidth: 0
  },
  workflowStepActive: {
    borderColor: '#86efac',
    background: '#f0fdf4',
    color: '#14532d'
  },
  workflowStepLocked: {
    opacity: 0.72,
    color: '#6b7280'
  },
  workflowStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 999,
    background: '#111827',
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
    justifySelf: 'start'
  },
  workflowStepText: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    fontSize: 12,
    fontWeight: 900
  },
  waitingNotice: {
    marginTop: 10,
    border: '1px solid #fed7aa',
    borderRadius: 8,
    background: '#fff7ed',
    color: '#9a3412',
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 900
  },
  resetWaitingNotice: {
    marginTop: 8,
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
    padding: 10,
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1.35
  },
  panelHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10
  },
  panelTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 950,
    color: '#111827'
  },
  kicker: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid #bbf7d0',
    borderRadius: 999,
    background: '#f0fdf4',
    color: '#166534',
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 10
  },
  groupPicker: {
    position: 'relative',
    minWidth: 0
  },
  groupPickerButton: {
    width: '100%',
    minHeight: 38,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: '0 9px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    fontSize: 13,
    fontWeight: 850
  },
  groupPickerMenu: {
    position: 'absolute',
    zIndex: 20,
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    padding: 8,
    boxShadow: '0 16px 40px rgba(17, 24, 39, 0.14)',
    maxHeight: 'min(360px, 55vh)',
    overflow: 'hidden',
    touchAction: 'pan-y'
  },
  groupPickerList: {
    display: 'grid',
    gap: 4,
    maxHeight: 'min(280px, 42vh)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
    touchAction: 'pan-y',
    marginTop: 8,
    paddingRight: 2
  },
  groupPickerOption: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: '8px 9px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 850
  },
  groupPickerOptionActive: {
    background: '#f0fdf4',
    borderColor: '#22c55e',
    color: '#14532d',
    boxShadow: 'inset 3px 0 0 #22c55e'
  },
  field: {
    display: 'grid',
    gap: 4,
    minWidth: 0
  },
  label: {
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280'
  },
  input: {
    width: '100%',
    minWidth: 0,
    minHeight: 38,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '0 9px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  mobileDateControl: {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    height: 38,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    overflow: 'hidden'
  },
  mobileDateValue: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '0 9px',
    boxSizing: 'border-box',
    color: '#111827',
    fontSize: 13,
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
  segment: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6
  },
  segmentButton: {
    minHeight: 38,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#374151',
    fontSize: 13,
    fontWeight: 900
  },
  segmentButtonActive: {
    background: '#dcfce7',
    borderColor: '#22c55e',
    color: '#14532d',
    boxShadow: 'inset 0 0 0 1px #22c55e'
  },
  summaryBox: {
    marginTop: 12,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#111827',
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 800
  },
  summaryLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  selectedChoiceCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    padding: 10,
    flexWrap: 'wrap'
  },
  selectedChoiceInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  delegateSummaryCard: {
    marginTop: 10,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  delegateSummaryText: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    color: '#111827',
    fontSize: 12,
    fontWeight: 900
  },
  delegateSummaryMuted: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 850
  },
  actions: {
    marginTop: 12,
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 8
  },
  primaryButton: {
    minHeight: 40,
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 6,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 950
  },
  secondaryButton: {
    minHeight: 40,
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 900,
    textDecoration: 'none'
  },
  messageError: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: 12,
    color: '#991b1b',
    fontWeight: 900
  },
  issueHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    paddingBottom: 10,
    borderBottom: '1px solid #e5e7eb'
  },
  countGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(72px, 96px))',
    gap: 6,
    marginTop: 12
  },
  countBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    minHeight: 44,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 2,
    fontSize: 11,
    fontWeight: 950,
    color: '#111827'
  },
  countBoxDark: {
    border: '1px solid #111827',
    borderRadius: 8,
    background: '#111827',
    color: '#86efac',
    minHeight: 44,
    display: 'grid',
    placeItems: 'center',
    alignContent: 'center',
    gap: 2,
    fontSize: 11,
    fontWeight: 950
  },
  selectedSummaryBar: {
    marginTop: 10,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    padding: '8px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    color: '#374151',
    fontSize: 12,
    fontWeight: 850
  },
  issueToolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12
  },
  pickupStepCard: {
    marginTop: 12,
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    background: '#eff6ff',
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  pickupStepInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0,
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: 900
  },
  nextStepHint: {
    marginTop: 12,
    border: '1px dashed #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#6b7280',
    padding: '9px 10px',
    fontSize: 12,
    fontWeight: 850,
    lineHeight: 1.35
  },
  bulkButtonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8
  },
  bulkButton: {
    minHeight: 30,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#374151',
    padding: '0 9px',
    fontSize: 11,
    fontWeight: 950
  },
  prepareActions: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 8,
    marginTop: 10,
    alignItems: 'end'
  },
  existingIssuesBox: {
    marginTop: 12,
    display: 'grid',
    gap: 8,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 10
  },
  existingIssuesList: {
    display: 'grid',
    gap: 6
  },
  existingIssueRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: 8
  },
  existingIssueRowActive: {
    background: '#ecfdf5',
    borderColor: '#22c55e',
    boxShadow: 'inset 3px 0 0 #22c55e'
  },
  existingIssueInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0,
    fontSize: 12,
    fontWeight: 900
  },
  waitingInline: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    border: '1px solid #fed7aa',
    borderRadius: 999,
    background: '#fff7ed',
    color: '#9a3412',
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 950
  },
  mealBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid #fed7aa',
    borderRadius: 999,
    background: '#fff7ed',
    color: '#9a3412',
    padding: '2px 7px',
    marginRight: 6,
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  existingIssueActions: {
    display: 'flex',
    gap: 5,
    alignItems: 'center'
  },
  smallEditButton: {
    width: 30,
    height: 30,
    border: '1px solid #bfdbfe',
    borderRadius: 6,
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 950
  },
  smallRemoveButton: {
    width: 30,
    height: 30,
    border: '1px solid #fecaca',
    borderRadius: 6,
    background: '#fef2f2',
    color: '#991b1b',
    fontSize: 14,
    fontWeight: 950
  },
  existingIssueButton: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: 9,
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    fontWeight: 900
  },
  existingIssueButtonActive: {
    background: '#ecfdf5',
    borderColor: '#22c55e',
    boxShadow: 'inset 3px 0 0 #22c55e'
  },
  smallButton: {
    minHeight: 34,
    background: '#dcfce7',
    color: '#14532d',
    border: '1px solid #86efac',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 950
  },
  smallButtonWhite: {
    minHeight: 34,
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 900
  },
  issuePeopleList: {
    display: 'grid',
    gap: 4,
    marginTop: 8,
    maxHeight: 560,
    overflow: 'auto',
    paddingRight: 3
  },
  filterInput: {
    width: '100%',
    minHeight: 36,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '0 9px',
    marginTop: 8,
    fontSize: 12,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  peopleSectionHeader: {
    marginTop: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    color: '#374151',
    fontSize: 12,
    fontWeight: 900
  },
  issuePersonRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(210px, auto)',
    gap: 8,
    alignItems: 'center',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '6px 8px'
  },
  issuePersonRowSelected: {
    background: '#f0fdf4',
    borderColor: '#86efac',
    boxShadow: 'inset 3px 0 0 #22c55e'
  },
  issuePersonRowMuted: {
    background: '#f9fafb',
    color: '#6b7280'
  },
  personCheckLabel: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
    fontSize: 13,
    fontWeight: 900
  },
  checkbox: {
    width: 17,
    height: 17,
    accentColor: '#22c55e'
  },
  personMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  choicePill: {
    border: '1px solid #bfdbfe',
    borderRadius: 999,
    background: '#eff6ff',
    color: '#1d4ed8',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 950
  },
  sourcePill: {
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    background: '#f9fafb',
    color: '#374151',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 900
  },
  statusPillReady: {
    border: '1px solid #bbf7d0',
    borderRadius: 999,
    background: '#f0fdf4',
    color: '#166534',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 950
  },
  statusPillWarning: {
    border: '1px solid #fecaca',
    borderRadius: 999,
    background: '#fef2f2',
    color: '#991b1b',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 950
  },
  pickupLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: '1px solid #fed7aa',
    borderRadius: 999,
    background: '#fff7ed',
    color: '#9a3412',
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 950
  },
  pickupPanel: {
    marginTop: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 10,
    display: 'grid',
    gap: 8
  },
  pickupList: {
    display: 'grid',
    gap: 6
  },
  pickupUserRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    padding: 8,
    fontSize: 12,
    fontWeight: 900
  },
  createdBox: {
    marginTop: 12,
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 10,
    display: 'grid',
    gap: 4,
    fontSize: 12,
    fontWeight: 900
  },
  delegateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  delegateTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 950,
    color: '#111827'
  },
  delegateHint: {
    margin: '4px 0 0 0',
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280',
    lineHeight: 1.35
  },
  countBadge: {
    minWidth: 34,
    height: 34,
    border: '1px solid #86efac',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#14532d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 950
  },
  delegateList: {
    display: 'grid',
    gap: 6,
    marginTop: 10
  },
  delegateRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 8
  },
  delegateName: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    fontSize: 12
  },
  removeButton: {
    width: 30,
    height: 30,
    border: '1px solid #fecaca',
    borderRadius: 6,
    background: '#fef2f2',
    color: '#991b1b',
    fontSize: 17,
    fontWeight: 950
  },
  emptyBox: {
    background: '#f9fafb',
    border: '1px dashed #d1d5db',
    borderRadius: 6,
    padding: 10,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 850
  },
  infoBox: {
    marginTop: 10,
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: 10,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 850
  },
  searchBox: {
    marginTop: 12,
    display: 'grid',
    gap: 10
  },
  addPeoplePanel: {
    marginTop: 12,
    display: 'grid',
    gap: 10,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 10
  },
  searchResults: {
    display: 'grid',
    gap: 6
  },
  qrScannerBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    padding: 10,
    flexWrap: 'wrap'
  },
  qrScannerHint: {
    display: 'block',
    marginTop: 3,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 800
  },
  darkButton: {
    minHeight: 36,
    background: '#111827',
    color: '#fff',
    border: '1px solid #111827',
    borderRadius: 6,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 900
  },
  resultButton: {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: 9,
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 3,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 850
  },
  resultButtonSelected: {
    background: '#f0fdf4',
    borderColor: '#22c55e',
    boxShadow: 'inset 3px 0 0 #22c55e'
  },
  resultButtonAdded: {
    background: '#eff6ff',
    borderColor: '#3b82f6',
    boxShadow: 'inset 3px 0 0 #3b82f6'
  },
  resultButtonRemoved: {
    background: '#fef2f2',
    borderColor: '#ef4444',
    boxShadow: 'inset 3px 0 0 #ef4444',
    color: '#7f1d1d'
  },
  resultMarker: {
    width: 20,
    height: 20,
    borderRadius: 999,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#6b7280',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
    lineHeight: 1
  },
  resultMarkerSelected: {
    background: '#22c55e',
    borderColor: '#22c55e',
    color: '#fff'
  },
  resultMarkerRemoved: {
    background: '#ef4444',
    borderColor: '#ef4444',
    color: '#fff'
  },
  resultText: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  feedbackOk: {
    marginTop: 12,
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 6,
    padding: 10,
    color: '#14532d',
    fontSize: 12,
    fontWeight: 900
  },
  feedbackError: {
    marginTop: 12,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    padding: 10,
    color: '#991b1b',
    fontSize: 12,
    fontWeight: 900
  },
  feedbackOkCompact: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#14532d',
    fontSize: 12,
    fontWeight: 900
  },
  feedbackErrorCompact: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 6,
    padding: '8px 10px',
    color: '#991b1b',
    fontSize: 12,
    fontWeight: 900
  },
  placeholderBox: {
    minHeight: 360,
    display: 'grid',
    alignContent: 'center',
    justifyItems: 'center',
    gap: 8,
    textAlign: 'center',
    border: '1px dashed #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#6b7280',
    padding: 20,
    fontSize: 13,
    fontWeight: 850
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    height: 'var(--group-issue-viewport-height, 100dvh)',
    boxSizing: 'border-box',
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: 'max(36px, calc(env(safe-area-inset-top) + 24px)) 16px max(16px, env(safe-area-inset-bottom)) 16px',
    overflow: 'hidden',
    overscrollBehaviorY: 'contain'
  },
  qrModal: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '100%',
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: '#fff',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'grid',
    gap: 12
  },
  peopleModal: {
    width: '100%',
    maxWidth: 620,
    height: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
    background: '#fff',
    borderRadius: 14,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'flex',
    flexDirection: 'column',
    margin: '0 0 16px 0'
  },
  qrModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
    padding: '14px 14px 10px 14px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    flex: '0 0 auto'
  },
  modalScrollBody: {
    minHeight: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain',
    padding: '0 14px 14px 14px',
    flex: '1 1 auto'
  },
  modalFooter: {
    flex: '0 0 auto',
    display: 'grid',
    gap: 8,
    padding: 14,
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
    boxShadow: '0 -8px 18px rgba(17, 24, 39, 0.06)'
  },
  modalTitleBlock: {
    display: 'grid',
    gap: 4,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 850
  },
  qrCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: '#f3f4f6',
    color: '#111827',
    fontSize: 20,
    fontWeight: 900,
    lineHeight: 1
  }
}
