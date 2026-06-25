'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QrCameraScanner from './QrCameraScanner'

type MealType = 'OBED' | 'VECERA'
type MealSelection = MealType | ''
type IssueSourceMode = 'REGISTRATION_GROUP' | 'FOOD_GROUP' | 'ONE_OFF'

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

type FoodGroup = {
  id: string
  name: string
  registrationGroupId: string
  memberCount: number
}

type IssuePerson = {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  choice: 'MASO' | 'VEGE' | 'DIETA'
  source: 'REGISTRATION_GROUP' | 'FOOD_GROUP' | 'SEARCH' | 'QR'
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
  minEditableDate: string
  groups: RegistrationGroupOption[]
  delegatesByGroupId: Record<string, Delegate[]>
}

const MEAL_OPTIONS: Array<{ value: MealType, label: string }> = [
  { value: 'OBED', label: 'Obed' },
  { value: 'VECERA', label: 'Večera' }
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

function defaultIssueTitle(groupName: string, meal: MealSelection, sequence: number) {
  if (!meal) return ''

  const mealText = meal === 'OBED' ? 'obed' : 'večera'
  return `${groupName || 'Skupinový výdaj'} ${mealText} výdaj č. ${Math.max(1, sequence)}`
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
  if (value === 'FOOD_GROUP') return 'Strav. skupina'
  if (value === 'QR') return 'QR'
  return 'Vyhladane'
}

function isIssuePersonReady(person: IssuePerson) {
  return person.issuable !== false
}

function isPlannedIssuePerson(person: IssuePerson) {
  return !person.itemStatus || person.itemStatus === 'PLANNED'
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

export default function SkupinovyVydajClient({ initialDate, minEditableDate, groups, delegatesByGroupId }: Props) {
  const pageRef = useRef<HTMLElement | null>(null)
  const stableViewportHeightRef = useRef<number | null>(null)
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
  const [sourceMode, setSourceMode] = useState<IssueSourceMode>('REGISTRATION_GROUP')
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [selectedFoodGroupId, setSelectedFoodGroupId] = useState('')
  const [foodGroupsLoading, setFoodGroupsLoading] = useState(false)
  const [foodGroupModalOpen, setFoodGroupModalOpen] = useState(false)
  const [foodGroupEditId, setFoodGroupEditId] = useState('')
  const [foodGroupName, setFoodGroupName] = useState('')
  const [foodGroupMemberIds, setFoodGroupMemberIds] = useState<string[]>([])
  const [foodGroupMembers, setFoodGroupMembers] = useState<SearchUser[]>([])
  const [foodGroupSearchQuery, setFoodGroupSearchQuery] = useState('')
  const [foodGroupSearchResults, setFoodGroupSearchResults] = useState<SearchUser[]>([])
  const [foodGroupMessage, setFoodGroupMessage] = useState('')
  const [foodGroupMessageType, setFoodGroupMessageType] = useState<'ok' | 'error'>('ok')
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
  const readOnlyDate = Boolean(date && minEditableDate && date < minEditableDate)
  const selectedIssuePeople = issuePeople.filter(person => selectedIssueUserIds.includes(person.id))
  const editableIssuePeople = editingIssueId
    ? issuePeople.filter(isPlannedIssuePerson)
    : issuePeople
  const issueFullyLocked = Boolean(editingIssueId && issuePeople.length > 0 && editableIssuePeople.length === 0)
  const issueReadOnly = readOnlyDate || issueFullyLocked
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

    function textControlIsFocused() {
      const activeElement = document.activeElement
      return (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      )
    }

    function updateViewportHeight() {
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const stableHeight = stableViewportHeightRef.current || window.innerHeight || viewportHeight
      const inputFocused = textControlIsFocused()
      const height = inputFocused ? Math.max(stableHeight, viewportHeight) : viewportHeight

      if (!inputFocused) stableViewportHeightRef.current = viewportHeight
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

    function onFocusIn() {
      root.style.setProperty(
        '--group-issue-viewport-height',
        `${stableViewportHeightRef.current || window.innerHeight}px`
      )
      window.requestAnimationFrame(keepPageScrollInside)
    }

    function onFocusOut() {
      window.setTimeout(updateViewportHeight, 120)
    }

    const page = pageRef.current

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
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
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
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
    if (nextGroupId === selectedGroupId) {
      return
    }

    setSelectedGroupId(nextGroupId)
    setDelegatesPanelOpen(false)
    setSelectedFoodGroupId('')
    setFoodGroups([])
    setDelegateSearchAll(false)
    setSearchQuery('')
    setSearchResults([])
    setDelegateNote('')
    setFeedback('')
    resetIssueState({ preserveMeal: true })
    void loadFoodGroups(nextGroupId)
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
    placeholder = 'Vyber dátum'
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

  async function loadFoodGroups(nextGroupId = selectedGroupId) {
    if (!nextGroupId) {
      setFoodGroups([])
      setSelectedFoodGroupId('')
      return []
    }

    setFoodGroupsLoading(true)

    try {
      const params = new URLSearchParams({ registrationGroupId: nextGroupId })
      const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Stravovacie skupiny sa nepodarilo načítať.')

      const nextGroups: FoodGroup[] = json.groups || []
      setFoodGroups(nextGroups)
      setSelectedFoodGroupId(current => nextGroups.some(group => group.id === current) ? current : '')
      return nextGroups
    } catch (err: any) {
      setIssueMessage(err?.message || 'Stravovacie skupiny sa nepodarilo načítať.', 'error')
      return []
    } finally {
      setFoodGroupsLoading(false)
    }
  }

  async function loadFoodGroupPeople(nextMeal: MealType) {
    if (!selectedGroupId || !selectedFoodGroupId || !date) return []

    const params = new URLSearchParams({
      registrationGroupId: selectedGroupId,
      foodGroupId: selectedFoodGroupId,
      date,
      meal: nextMeal
    })
    const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
    const json = await res.json()

    if (!res.ok) throw new Error(json.error || 'Ľudí zo stravovacej skupiny sa nepodarilo načítať.')

    if (Array.isArray(json.groups)) setFoodGroups(json.groups)
    return (json.people || []) as IssuePerson[]
  }

  async function openFoodGroupModal(groupId = selectedFoodGroupId) {
    if (!selectedGroupId) {
      setIssueMessage('Najprv vyber registračnú skupinu.', 'error')
      return
    }

    const groupsList = foodGroups.length ? foodGroups : await loadFoodGroups(selectedGroupId)
    const selected = groupsList.find(group => group.id === groupId) || null

    setFoodGroupEditId(selected?.id || '')
    setFoodGroupName(selected?.name || '')
    setFoodGroupMemberIds([])
    setFoodGroupMembers([])
    setFoodGroupSearchQuery('')
    setFoodGroupSearchResults([])
    setFoodGroupMessage('')
    setFoodGroupMessageType('ok')
    setFoodGroupModalOpen(true)

    if (!selected?.id || !date) return

    setFoodGroupsLoading(true)

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        foodGroupId: selected.id,
        date
      })
      if (meal) params.set('meal', meal)
      const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Členov sa nepodarilo načítať.')

      const members: SearchUser[] = json.members || []
      setFoodGroupMembers(members)
      setFoodGroupMemberIds(members.map(member => member.id))
    } catch (err: any) {
      setFoodGroupMessage(err?.message || 'Členov sa nepodarilo načítať.')
      setFoodGroupMessageType('error')
    } finally {
      setFoodGroupsLoading(false)
    }
  }

  function closeFoodGroupModal() {
    if (foodGroupsLoading) return
    setFoodGroupModalOpen(false)
    setFoodGroupEditId('')
    setFoodGroupName('')
    setFoodGroupMemberIds([])
    setFoodGroupMembers([])
    setFoodGroupSearchQuery('')
    setFoodGroupSearchResults([])
    setFoodGroupMessage('')
  }

  function toggleFoodGroupMember(user: SearchUser) {
    setFoodGroupMembers(current => mergeSearchUsers(current, [user]))
    setFoodGroupMemberIds(current => current.includes(user.id)
      ? current.filter(id => id !== user.id)
      : [...current, user.id])
  }

  async function searchFoodGroupMembers(query: string) {
    setFoodGroupSearchQuery(query)
    setFoodGroupSearchResults([])

    if (!selectedGroupId || query.trim().length < 3) return

    setFoodGroupsLoading(true)
    setFoodGroupMessage('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        q: query
      })
      const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhľadávanie zlyhalo.')

      setFoodGroupSearchResults(json.users || [])
    } catch (err: any) {
      setFoodGroupMessage(err?.message || 'Vyhľadávanie zlyhalo.')
      setFoodGroupMessageType('error')
    } finally {
      setFoodGroupsLoading(false)
    }
  }

  async function saveFoodGroup() {
    if (!selectedGroupId) return
    if (!foodGroupName.trim()) {
      setFoodGroupMessage('Zadaj názov stravovacej skupiny.')
      setFoodGroupMessageType('error')
      return
    }

    setFoodGroupsLoading(true)
    setFoodGroupMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/food-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: selectedGroupId,
          foodGroupId: foodGroupEditId,
          name: foodGroupName,
          memberUserIds: foodGroupMemberIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Stravovaciu skupinu sa nepodarilo uložiť.')

      setFoodGroups(json.groups || [])
      setSelectedFoodGroupId(json.group?.id || selectedFoodGroupId)
      setFoodGroupMessage(json.message || 'Stravovacia skupina bola uložená.')
      setFoodGroupMessageType('ok')
      window.setTimeout(() => closeFoodGroupModal(), 350)
    } catch (err: any) {
      setFoodGroupMessage(err?.message || 'Stravovaciu skupinu sa nepodarilo uložiť.')
      setFoodGroupMessageType('error')
    } finally {
      setFoodGroupsLoading(false)
    }
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

      if (!res.ok) throw new Error(json.error || 'Existujúce výdaje sa nepodarilo načítať.')

      const issues: ExistingIssue[] = json.issues || []
      setExistingIssues(issues)
      return issues
    } finally {
      setExistingLoading(false)
    }
  }

  useEffect(() => {
    if (!selectedGroupId || !date || confirmed) return

    void loadExistingIssuesFor(selectedGroupId, date, '').catch((err: any) => {
      setIssueMessage(err?.message || 'Existujúce výdaje sa nepodarilo načítať.', 'error')
    })
  }, [selectedGroupId, date, confirmed])

  useEffect(() => {
    if (!selectedGroupId) return
    void loadFoodGroups(selectedGroupId)
  }, [selectedGroupId])

  async function loadIssuePeople(nextMeal: MealType) {
    if (!selectedGroupId || !date) return

    if (readOnlyDate) {
      setIssueMessage('Starší dátum je iba na prezeranie. Nový skupinový výdaj môžeš vytvoriť najskôr na dnešný dátum.', 'error')
      return
    }

    setIssueLoading(true)
    setIssueMessage('')
    setCreatedIssue(null)
    setMeal(nextMeal)

    try {
      let people: IssuePerson[] = []
      let excludedCount = 0
      let json: any = {}

      if (sourceMode === 'REGISTRATION_GROUP') {
        const params = new URLSearchParams({
          registrationGroupId: selectedGroupId,
          date,
          meal: nextMeal
        })
        const res = await fetch(`/api/skupinovy-vydaj/options?${params.toString()}`)
        json = await res.json()

        if (!res.ok) throw new Error(json.error || 'Ľudí sa nepodarilo načítať.')

        people = json.people || []
        excludedCount = Number(json.plannedExcludedCount || 0)
      } else if (sourceMode === 'FOOD_GROUP') {
        if (!selectedFoodGroupId) throw new Error('Vyber stravovaciu skupinu.')
        people = await loadFoodGroupPeople(nextMeal)
      }

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
      const dailyIssues = await loadExistingIssuesFor(selectedGroupId, date, '')
      const existingForMeal = dailyIssues.filter(issue => issue.meal === nextMeal).length
      setIssueTitle(defaultIssueTitle(selectedGroup?.name || '', nextMeal, existingForMeal + 1))
      setConfirmed(true)
      setIssueMessage(
        people.length
          ? excludedCount > 0
            ? `Načítaných ${people.length} zvyšných vydateľných osôb. Ľudia už pripravení v inom skupinovom výdaji sú vynechaní.`
            : `Načítaných ${people.length} aktuálne vydateľných osôb.`
          : 'Pre tento výber nie je aktuálne nikto vydateľný.',
        people.length ? 'ok' : 'error'
      )
    } catch (err: any) {
      setIssueMessage(err?.message || 'Ľudí sa nepodarilo načítať.', 'error')
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

      if (!res.ok) throw new Error(json.error || 'Skupinový výdaj sa nepodarilo načítať.')

      const issue = json.issue
      const people: IssuePerson[] = (issue.people || []).filter((person: IssuePerson) => person.itemStatus !== 'REMOVED')

      setEditingIssueId(issue.id)
      setEditingIssueStatus(issue.status || '')
      setEditingIssueValidAfter(issue.validAfter || null)
      setMeal(issue.meal || '')
      setIssueTitle(issue.title || '')
      setIssuePeople(people)
      setSelectedIssueUserIds(people.filter(isPlannedIssuePerson).map(person => person.id))
      setIssuePeopleConfirmed(true)
      setPickupUserIds(issue.pickupUserIds || [])
      setPickupUsers(issue.pickupUsers || [])
      setIssuePersonFilter('')
      setPickupQuery('')
      setPickupResults([])
      setMoveModalOpen(false)
      setMoveTargetIssueId('')
      const hasEditablePeople = people.some(isPlannedIssuePerson)
      setConfirmed(true)
      setIssueMessage(
        readOnlyDate || !hasEditablePeople
          ? 'Skupinový výdaj je načítaný na prezeranie.'
          : 'Skupinový výdaj je načítaný na úpravu.'
      )
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinový výdaj sa nepodarilo načítať.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function cancelExistingIssue(issue: ExistingIssue) {
    if (readOnlyDate) {
      setIssueMessage('Starší skupinový výdaj je možné iba prezerať.', 'error')
      return
    }

    const ok = window.confirm(`Zrušiť skupinový výdaj "${issue.title}"?`)
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

      if (!res.ok) throw new Error(json.error || 'Skupinový výdaj sa nepodarilo zrušiť.')

      if (editingIssueId === issue.id) resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || 'Skupinový výdaj bol zrušený.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinový výdaj sa nepodarilo zrušiť.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function addIssuePersonByQr(qrCode: string) {
    if (issueReadOnly) {
      return {
        tone: 'error' as const,
        message: issueFullyLocked
          ? 'Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.'
          : 'Starší skupinový výdaj je možné iba prezerať.'
      }
    }

    if (!selectedGroupId || !date || !meal) {
      return {
        tone: 'error' as const,
        message: 'Najprv vyber registračnú skupinu, dátum a jedlo.'
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
    const message = `${json.person.name || 'Osoba'} pridaná cez QR.`
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
  }

  function toggleIssuePerson(userId: string) {
    if (issueReadOnly) return

    const person = issuePeople.find(item => item.id === userId)
    if (editingIssueId && person && !isPlannedIssuePerson(person)) return

    setSelectedIssueUserIds(current => {
      return current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    })
  }

  function handleBulkIssueSelection(action: string) {
    if (issueReadOnly) return

    if (action === 'ALL') {
      setSelectedIssueUserIds(editableIssuePeople.map(person => person.id))
      return
    }

    if (action === 'READY') {
      setSelectedIssueUserIds(editableIssuePeople.filter(isIssuePersonReady).map(person => person.id))
      return
    }

    if (action === 'NONE') {
      setSelectedIssueUserIds([])
    }
  }

  function confirmIssuePeople() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? 'Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.' : 'Starší skupinový výdaj je možné iba prezerať.', 'error')
      return
    }

    if (selectedIssuePeople.length === 0) {
      setIssueMessage('Vyber aspoň jednu osobu.', 'error')
      return
    }

    setIssuePeopleConfirmed(true)
    setIssueMessage('Osoby vo výdaji sú potvrdené. Teraz vyber, kto môže výdaj prevziať.')
    openPickupModal()
  }

  function openMoveModal() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? 'Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.' : 'Starší skupinový výdaj je možné iba prezerať.', 'error')
      return
    }

    if (!editingIssueId || selectedIssuePeople.length === 0) return

    if (selectedHasUnmovablePeople) {
      setIssueMessage('Presunúť je možné iba osoby, ktoré ešte nemajú vydané jedlo.', 'error')
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

      if (!res.ok) throw new Error(json.error || 'Osoby sa nepodarilo presunúť.')

      const currentIssueId = editingIssueId
      closeMoveModal()
      await editExistingIssue(currentIssueId)
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || 'Osoby boli presunuté.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Osoby sa nepodarilo presunúť.', 'error')
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
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? 'Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.' : 'Starší skupinový výdaj je možné iba prezerať.', 'error')
      return
    }

    if (pendingPickupUserIds.length === 0) {
      setIssueMessage('Pridaj aspoň jednu osobu oprávnenú prevziať výdaj.', 'error')
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

      if (!res.ok) throw new Error(json.error || 'Oprávnených prevziať sa nepodarilo uložiť.')

      setPickupUsers(json.pickupUsers || nextUsers)
      setPickupUserIds(json.pickupUserIds || pendingPickupUserIds)
      setPickupModalOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupExternalUsers([])
      setIssueMessage(json.message || 'Oprávnení prevziať boli uložení.')
    } catch (err: any) {
      setIssueMessage(err?.message || 'Oprávnených prevziať sa nepodarilo uložiť.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function saveIssue() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? 'Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.' : 'Starší skupinový výdaj je možné iba prezerať.', 'error')
      return
    }

    if (!selectedGroupId || !date || !meal || selectedIssuePeople.length === 0) {
      setIssueMessage('Vyber aspoň jednu osobu.', 'error')
      return
    }

    if (!editingIssueId && !issuePeopleConfirmed) {
      setIssueMessage('Najprv potvrď osoby vo výdaji a potom vyber oprávnených prevziať.', 'error')
      return
    }

    if (pickupUserIds.length === 0) {
      setIssueMessage('Pridaj aspoň jednu osobu oprávnenú prevziať výdaj.', 'error')
      return
    }

    const title = issueTitle.trim()

    if (!title) {
      setIssueMessage('Zadaj názov skupinového výdaja.', 'error')
      return
    }

    const wasEditing = Boolean(editingIssueId)

    if (editWillResetWaiting) {
      const ok = window.confirm('Uložením úprav sa skupinový výdaj znova aktivuje až o 15 minút. Pokračovať?')
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
          title,
          people: selectedIssuePeople.map(person => ({
            userId: person.id,
            source: person.source
          })),
          pickupUserIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Skupinový výdaj sa nepodarilo uložiť.')

      const successMessage = json.message || (wasEditing
        ? 'Skupinový výdaj bol upravený.'
        : 'Skupinový výdaj bol vytvorený.')

      setQrModalOpen(false)

      resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(successMessage)
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinový výdaj sa nepodarilo uložiť.', 'error')
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

        if (!res.ok) throw new Error(json.error || 'Poverenú osobu sa nepodarilo odobrať.')
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

        if (!res.ok) throw new Error(json.error || 'Poverenú osobu sa nepodarilo pridať.')
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
      setMessage(`Uložené. Pridané: ${usersToAdd.length}, odobraté: ${delegatesToRemove.length}.`)
    } catch (err: any) {
      setMessage(err?.message || 'Poverené osoby sa nepodarilo uložiť.', 'error')
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
            <h1 className="group-issue-title" style={styles.title}>Skupinový výdaj</h1>
            <p style={styles.subtitle}>Príprava výdaja pre registračné skupiny a poverených ľudí.</p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            Späť
          </Link>
        </header>

        {groups.length === 0 ? (
          <div style={styles.messageError}>Nemáte pridelenú registračnú skupinu pre skupinový výdaj.</div>
        ) : (
          <div className="group-issue-layout" style={styles.layout}>
            {confirmed && (
              <section className="group-issue-main" style={styles.mainPanel}>
                <div style={styles.prepHeading}>
                  <div style={styles.prepHeadingInfo}>
                    <span style={styles.summaryLabel}>Pripravuješ</span>
                    <b>{mealLabel(meal)} · {selectedGroup?.name || '-'}</b>
                    <small>{fullDateLabel(date)}</small>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      resetIssueState({ clearExisting: false, preserveMeal: true })
                      void loadExistingIssuesFor(selectedGroupId, date, '')
                    }}
                    style={styles.smallButtonWhite}
                  >
                    Zmeniť
                  </button>
                </div>

                <label style={styles.field}>
                  <span style={styles.label}>Názov skupinového výdaja</span>
                  {issueReadOnly ? (
                    <div style={styles.readOnlyInputValue}>{issueTitle || '-'}</div>
                  ) : (
                    <input
                      type="text"
                      value={issueTitle}
                      onChange={event => setIssueTitle(event.target.value)}
                      placeholder="Zadaj názov výdaja"
                      style={styles.input}
                      disabled={issueLoading}
                      required
                    />
                  )}
                </label>

                {readOnlyDate && (
                  <div style={styles.readOnlyNotice}>
                    Starší dátum je iba na prezeranie. Vytvoriť alebo upraviť skupinový výdaj môžeš najskôr na dnešný dátum.
                  </div>
                )}

                {issueFullyLocked && (
                  <div style={styles.readOnlyNotice}>
                    Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu. Výdaj je iba na prezeranie.
                  </div>
                )}

                {editingWaitingInfo && (
                  <div style={styles.waitingNotice}>
                    <b>{editingWaitingInfo.active ? `Začne platiť o ${editingWaitingInfo.countdown}` : 'Platnosť je aktívna'}</b>
                    <span>Platí od: {editingWaitingInfo.startsAt}</span>
                  </div>
                )}

                {editWillResetWaiting && (
                  <div style={styles.resetWaitingNotice}>
                    Uložením úprav sa tento skupinový výdaj znova aktivuje až o 15 minút.
                  </div>
                )}

                <div style={styles.issueToolbar}>
                  <button
                    type="button"
                    onClick={() => setQrModalOpen(true)}
                    disabled={issueLoading || issueReadOnly || !selectedGroupId || !date || !meal}
                    style={styles.darkButton}
                  >
                    Pridať cez QR
                  </button>

                  {editingIssueId && (
                    <button
                      type="button"
                      onClick={openMoveModal}
                      disabled={
                        issueLoading ||
                        issueReadOnly ||
                        selectedMovableIssuePeople.length === 0 ||
                        selectedHasUnmovablePeople ||
                        moveTargetIssues.length === 0
                      }
                      style={styles.secondaryButton}
                    >
                      Presunúť ({selectedMovableIssuePeople.length})
                    </button>
                  )}
                </div>

                <div style={styles.peopleSectionHeader}>
                  <b>Osoby vo výdaji</b>
                  <span>{selectedSummary.SPOLU} vydateľných / {selectedIssueUserIds.length} označených / {issuePeople.length} spolu</span>
                </div>

                <div style={styles.bulkButtonRow}>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('ALL')}
                    disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Všetci
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('READY')}
                    disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Vydateľní
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkIssueSelection('NONE')}
                    disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                    style={styles.bulkButton}
                  >
                    Žiadni
                  </button>
                </div>

                <input
                  type="search"
                  value={issuePersonFilter}
                  onChange={event => setIssuePersonFilter(event.target.value)}
                  placeholder="Hľadať v osobách vo výdaji"
                  style={styles.filterInput}
                  disabled={issuePeople.length === 0}
                />

                <div style={styles.issuePeopleList}>
                  {issuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento dátum a jedlo nie je aktuálne nikto vydateľný.</div>
                  ) : filteredIssuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>Nič sa nenašlo.</div>
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
                              disabled={issueReadOnly || (Boolean(editingIssueId) && !isPlannedIssuePerson(person))}
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

                {(editingIssueId || issuePeopleConfirmed) && (
                  <div style={styles.pickupStepCard}>
                    <div style={styles.pickupStepInfo}>
                      <b>Oprávnení prevziať</b>
                      <span>
                        {pickupUserIds.length > 0
                          ? `${pickupUserIds.length} osôb môže prevziať tento výdaj.`
                          : 'Zatiaľ nie je pridaná žiadna osoba na prevzatie.'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={openPickupModal}
                      disabled={issueLoading || issueReadOnly}
                      style={{ ...styles.secondaryButton, width: '100%' }}
                    >
                      Upraviť prevzatie
                    </button>
                  </div>
                )}

                {!editingIssueId && !issuePeopleConfirmed ? (
                  <button
                    type="button"
                    onClick={confirmIssuePeople}
                    disabled={issueLoading || issueReadOnly || selectedIssuePeople.length === 0}
                    style={{ ...styles.primaryButton, marginTop: 14, width: '100%' }}
                  >
                    Potvrdiť osoby a pokračovať
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={saveIssue}
                    disabled={issueLoading || issueReadOnly || selectedIssuePeople.length === 0 || pickupUserIds.length === 0}
                    style={{ ...styles.primaryButton, marginTop: 14, width: '100%' }}
                  >
                    {issueLoading ? 'Ukladám...' : editingIssueId ? 'Uložiť skupinový výdaj' : 'Uložiť skupinový výdaj'}
                  </button>
                )}

                {createdIssue && (
                  <div style={styles.createdBox}>
                    <b>{createdIssue.title}</b>
                    <span>
                      MASO {createdIssue.summary?.MASO || 0} / VEGE {createdIssue.summary?.VEGE || 0} / DIETA {createdIssue.summary?.DIETA || 0} / SPOLU {createdIssue.summary?.SPOLU || 0}
                    </span>
                    {createdIssue.status === 'WAITING' && <span>Platnosť začne o 15 minút.</span>}
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
                  <div style={styles.panelTitle}>Výber výdaja</div>
                  <span style={styles.kicker}>Krok 1</span>
                </div>

                <div style={styles.formGrid}>
                  <div style={styles.field}>
                    <span>Registracna skupina</span>
                    <select
                      value={selectedGroupId}
                      onChange={event => selectRegistrationGroup(event.target.value)}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="">Vyberte</option>
                      {groups.map(group => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    {false && (
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
                            placeholder="Hľadať registračnú skupinu"
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
                    )}
                  </div>

                  <label style={styles.field}>
                    <span>Dátum</span>
                    {renderDateInput(
                      date,
                      value => {
                        setDate(value)
                        resetIssueState({ preserveMeal: true })
                      },
                      issueLoading,
                      'Vyber dátum'
                    )}
                  </label>

                  <label style={{ ...styles.field, display: 'none' }}>
                    <span>Zdroj ľudí</span>
                    <select
                      value={sourceMode}
                      onChange={event => {
                        setSourceMode(event.target.value as IssueSourceMode)
                        resetIssueState({ clearExisting: false, preserveMeal: true })
                      }}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="REGISTRATION_GROUP">Registračná skupina</option>
                      <option value="FOOD_GROUP">Stravovacia skupina</option>
                      <option value="ONE_OFF">Jednorazový výdaj cez QR</option>
                    </select>
                  </label>

                  {false && sourceMode === 'FOOD_GROUP' && (
                    <label style={styles.field}>
                      <span>Stravovacia skupina</span>
                      <select
                        value={selectedFoodGroupId}
                        onChange={event => {
                          setSelectedFoodGroupId(event.target.value)
                          resetIssueState({ clearExisting: false, preserveMeal: true })
                        }}
                        disabled={issueLoading || foodGroupsLoading}
                        style={styles.input}
                      >
                        <option value="">Vyber stravovaciu skupinu</option>
                        {foodGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name} ({group.memberCount})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label style={styles.field}>
                    <span>Jedlo pre nový výdaj</span>
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

                {false && selectedGroupId && (
                  <div style={styles.delegateSummaryCard}>
                    <div style={styles.delegateSummaryText}>
                      <b>Stravovacie skupiny</b>
                      <span>{foodGroups.length} zoznamov pre túto registračnú skupinu</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => openFoodGroupModal(selectedFoodGroupId)}
                      style={styles.smallButtonWhite}
                      disabled={foodGroupsLoading}
                    >
                      Spravovať
                    </button>
                  </div>
                )}

                {selectedGroup?.canManageDelegates && (
                  <div style={styles.delegateSummaryCard}>
                    <div style={styles.delegateSummaryText}>
                      <b>Poverené osoby pre túto skupinu</b>
                      <span>{delegates.length} osôb</span>
                    </div>

                    <button
                      type="button"
                      onClick={openDelegateModal}
                      style={styles.smallButtonWhite}
                    >
                      Spravovať
                    </button>
                  </div>
                )}
              </section>
              )}

              {!confirmed && daySelectionReady && (
                <section style={{ ...styles.panel, order: 3 }}>
                  <div style={styles.delegateHeader}>
                    <div>
                      <h2 style={styles.delegateTitle}>Výdaje pre deň</h2>
                      <p style={styles.delegateHint}>{selectedGroup?.name || '-'} / {fullDateLabel(date)}</p>
                    </div>
                    <span style={styles.countBadge}>{existingIssues.length}</span>
                  </div>

                  {readOnlyDate && (
                    <div style={styles.readOnlyNotice}>
                      Starší dátum je iba na prezeranie. Existujúce výdaje môžeš otvoriť, ale nie upravovať.
                    </div>
                  )}

                  {existingLoading ? (
                    <div style={styles.emptyBox}>Načítavam existujúce výdaje...</div>
                  ) : existingIssues.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento deň zatiaľ nie je vytvorený žiadny výdaj.</div>
                  ) : (
                    <div style={styles.existingIssuesList}>
                      {existingIssues.map(issue => {
                        const issueWaitingInfo = issue.status === 'WAITING'
                          ? waitingInfo(issue.validAfter, nowMs)
                          : null
                        const fullyIssuedIssue = (issue.summary?.SPOLU || 0) === 0
                        const isReadOnlyIssue = readOnlyDate || fullyIssuedIssue

                        return (
                          <div
                            key={issue.id}
                            style={{
                              ...styles.existingIssueRow,
                              ...(editingIssueId === issue.id ? styles.existingIssueRowActive : {})
                            }}
                          >
                            <div style={styles.existingIssueInfo}>
                              <b>
                                {issue.title}
                                {fullyIssuedIssue && <span style={styles.issuedInlineStatus}> - vydané</span>}
                              </b>
                              <small>
                                <span style={styles.mealBadge}>{mealLabel(issue.meal)}</span>
                                MASO {issue.summary?.MASO || 0} / VEGE {issue.summary?.VEGE || 0} / DIETA {issue.summary?.DIETA || 0} / SPOLU {issue.summary?.SPOLU || 0}
                              </small>
                              {issueWaitingInfo && (
                                <span style={styles.waitingInline}>
                                  {issueWaitingInfo.active
                                    ? `Začne platiť o ${issueWaitingInfo.countdown}`
                                    : 'Platnosť je aktívna'}
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
                                title={isReadOnlyIssue ? 'Pozrieť výdaj' : 'Zmeniť výdaj'}
                              >
                                {isReadOnlyIssue ? 'i' : 'Z'}
                              </button>
                              {!isReadOnlyIssue && (
                                <button
                                  type="button"
                                  onClick={() => cancelExistingIssue(issue)}
                                  disabled={issueLoading}
                                  style={styles.smallRemoveButton}
                                  title="Zrušiť výdaj"
                                >
                                  x
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div style={styles.prepareActions}>
                    <label style={styles.field}>
                      <span>Zdroj ľudí</span>
                      <select
                        value={sourceMode}
                        onChange={event => {
                          setSourceMode(event.target.value as IssueSourceMode)
                          resetIssueState({ clearExisting: false, preserveMeal: true })
                        }}
                        disabled={issueLoading || readOnlyDate}
                        style={styles.input}
                      >
                        <option value="REGISTRATION_GROUP">Registračná skupina</option>
                        <option value="FOOD_GROUP">Stravovacia skupina</option>
                        <option value="ONE_OFF">Jednorazový výdaj cez QR</option>
                      </select>
                    </label>

                    {sourceMode === 'FOOD_GROUP' && (
                      <div style={styles.prepareFoodGroupRow}>
                        <label style={{ ...styles.field, flex: 1 }}>
                          <span>Stravovacia skupina</span>
                          <select
                            value={selectedFoodGroupId}
                            onChange={event => {
                              setSelectedFoodGroupId(event.target.value)
                              resetIssueState({ clearExisting: false, preserveMeal: true })
                            }}
                            disabled={issueLoading || readOnlyDate || foodGroupsLoading}
                            style={styles.input}
                          >
                            <option value="">Vyber stravovaciu skupinu</option>
                            {foodGroups.map(group => (
                              <option key={group.id} value={group.id}>
                                {group.name} ({group.memberCount})
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          type="button"
                          onClick={() => openFoodGroupModal(selectedFoodGroupId)}
                          style={styles.smallButtonWhite}
                          disabled={issueLoading || readOnlyDate || foodGroupsLoading}
                        >
                          Spravovať
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (meal) void loadIssuePeople(meal)
                      }}
                      disabled={issueLoading || readOnlyDate || !meal || (sourceMode === 'FOOD_GROUP' && !selectedFoodGroupId)}
                      style={{ ...styles.primaryButton, alignSelf: 'end', width: '100%' }}
                    >
                      {issueLoading
                        ? 'Načítavam...'
                        : readOnlyDate
                          ? 'Starší dátum je iba na prezeranie'
                          : sourceMode === 'FOOD_GROUP' && !selectedFoodGroupId
                            ? 'Vyber stravovaciu skupinu'
                            : meal ? 'Pripraviť nový výdaj' : 'Vyber jedlo pre nový výdaj'}
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
                  <b>Pridať cez QR</b>
                  <span>Skenujte QR kódy postupne. Osoby sa budú pridávať do pripravovaného výdaja.</span>
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
                  <b>Presunúť označených</b>
                  <span>{selectedMovableIssuePeople.length} osôb / {mealLabel(meal)} / {fullDateLabel(date)}</span>
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
                    <b>Cieľový výdaj</b>
                    <span>{moveTargetIssues.length} možností</span>
                  </div>

                  {moveTargetIssues.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento dátum a jedlo neexistuje iný skupinový výdaj.</div>
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
                  {issueLoading ? 'Presúvam...' : `Presunúť (${selectedMovableIssuePeople.length})`}
                </button>
              </div>
            </div>
          </div>
        )}

        {foodGroupModalOpen && selectedGroup && (
          <div style={styles.modalOverlay} onClick={closeFoodGroupModal}>
            <div style={styles.peopleModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>Stravovacia skupina</b>
                  <span>{selectedGroup.name}</span>
                </div>

                <button
                  type="button"
                  onClick={closeFoodGroupModal}
                  style={styles.qrCloseButton}
                  disabled={foodGroupsLoading}
                >
                  x
                </button>
              </div>

              <div style={styles.modalScrollBody}>
                <div style={styles.searchBox}>
                  <label style={styles.field}>
                    <span style={styles.label}>Názov skupiny</span>
                    <input
                      type="text"
                      value={foodGroupName}
                      onChange={event => setFoodGroupName(event.target.value)}
                      placeholder="Napr. Amazonky menší tím"
                      style={styles.input}
                      disabled={foodGroupsLoading}
                    />
                  </label>

                  {foodGroups.length > 0 && (
                    <label style={styles.field}>
                      <span style={styles.label}>Upraviť existujúcu</span>
                      <select
                        value={foodGroupEditId}
                        onChange={event => {
                          const nextId = event.target.value
                          const group = foodGroups.find(item => item.id === nextId)
                          setFoodGroupEditId(nextId)
                          setFoodGroupName(group?.name || '')
                          void openFoodGroupModal(nextId)
                        }}
                        style={styles.input}
                        disabled={foodGroupsLoading}
                      >
                        <option value="">Nová stravovacia skupina</option>
                        {foodGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name} ({group.memberCount})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label style={styles.field}>
                    <span style={styles.label}>Pridať osobu</span>
                    <input
                      type="search"
                      value={foodGroupSearchQuery}
                      onChange={event => searchFoodGroupMembers(event.target.value)}
                      placeholder="Zadaj aspoň 3 znaky"
                      style={styles.input}
                      disabled={foodGroupsLoading}
                    />
                  </label>

                  {foodGroupsLoading && <div style={styles.emptyBox}>Načítavam...</div>}

                  <div style={styles.searchResults}>
                    {mergeSearchUsers(foodGroupMembers, foodGroupSearchResults).length === 0 ? (
                      <div style={styles.emptyBox}>Vyhľadaj osobu alebo uprav existujúcu skupinu.</div>
                    ) : (
                      mergeSearchUsers(foodGroupMembers, foodGroupSearchResults).map(user => {
                        const selected = foodGroupMemberIds.includes(user.id)

                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleFoodGroupMember(user)}
                            disabled={foodGroupsLoading}
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
                              <b>{user.name}</b>
                              {user.email && <span>{user.email}</span>}
                              <small>{selected ? 'V skupine' : 'Kliknutím označíš'}</small>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.modalFooter}>
                {foodGroupMessage && (
                  <div style={foodGroupMessageType === 'ok' ? styles.feedbackOkCompact : styles.feedbackErrorCompact}>
                    {foodGroupMessage}
                  </div>
                )}
                <button
                  type="button"
                  onClick={saveFoodGroup}
                  disabled={foodGroupsLoading || !foodGroupName.trim()}
                  style={styles.primaryButton}
                >
                  {foodGroupsLoading ? 'Ukladám...' : `Uložiť skupinu (${foodGroupMemberIds.length})`}
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
                  <b>Správa poverených osôb</b>
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
                  <div style={styles.infoBox}>Túto časť môže meniť iba manager registračnej skupiny.</div>
                </div>
              ) : (
                <>
                  <div style={styles.modalScrollBody}>
                    <div style={styles.searchBox}>
                    <div style={styles.peopleSectionHeader}>
                      <b>Poverené osoby</b>
                      <span>{pendingDelegateUserIds.length} označených / {delegateCandidates.length} v zozname</span>
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
                        {delegateSearchAll ? 'Vyhľadať mimo registračnej skupiny' : 'Vyhľadať v registračnej skupine'}
                      </span>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={event => searchUsers(event.target.value)}
                        placeholder={delegateSearchAll ? 'Zadaj aspoň 3 znaky mimo skupiny' : 'Zoznam skupiny alebo hľadaj od 3 znakov'}
                        style={styles.input}
                      />
                    </label>

                    <label style={styles.field}>
                      <span style={styles.label}>Poznámka</span>
                      <input
                        type="text"
                        value={delegateNote}
                        onChange={event => setDelegateNote(event.target.value)}
                        placeholder="Voliteľné"
                        style={styles.input}
                      />
                    </label>

                    {loading && <div style={styles.emptyBox}>Načítavam...</div>}

                    <div style={styles.searchResults}>
                      {!delegateListReady ? (
                        <div style={styles.emptyBox}>Načítavam osoby zo skupiny...</div>
                      ) : delegateCandidates.length === 0 ? (
                        <div style={styles.emptyBox}>
                          {delegateSearchAll
                            ? 'Pre vyhľadávanie mimo skupiny zadaj aspoň 3 znaky.'
                            : 'V skupine nie je nikto ďalší na pridanie.'}
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
                                    ? selected ? 'Už označený' : 'Kliknutím pridáš'
                                    : changed
                                      ? selected ? 'Bude pridaný po uložení' : 'Bude odobratý po uložení'
                                      : selected ? 'Poverený' : 'Kliknutím označíš'}
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
                      {loading ? 'Ukladám...' : `Uložiť zmeny (${pendingDelegateUserIds.length})`}
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
                  <b>Oprávnení prevziať</b>
                  <span>Osoby, ktoré môžu prevziať tento skupinový výdaj.</span>
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
                    <b>Oprávnení prevziať</b>
                    <span>{pendingPickupUserIds.length} označených / {pickupCandidateUsers.length} v zozname</span>
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
                      {pickupSearchOutside ? 'Vyhľadať mimo registračnej skupiny' : 'Vyhľadať v registračnej skupine'}
                    </span>
                    <input
                      type="search"
                      value={pickupQuery}
                      onChange={event => searchPickupUsers(event.target.value)}
                      placeholder={pickupSearchOutside ? 'Zadaj aspoň 3 znaky mimo skupiny' : 'Zadaj aspoň 3 znaky v skupine'}
                      style={styles.input}
                      disabled={issueLoading}
                    />
                  </label>

                  {pickupLoading && <div style={styles.emptyBox}>Vyhľadávam...</div>}

                  <div style={styles.searchResults}>
                    {pickupCandidateUsers.length === 0 ? (
                      <div style={styles.emptyBox}>
                        {pickupSearchOutside
                          ? 'Pre vyhľadávanie mimo skupiny zadaj aspoň 3 znaky.'
                          : 'Vyber osoby vo výdaji alebo zadaj aspoň 3 znaky v skupine.'}
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
                                  ? selected ? 'Už označený' : 'Kliknutím pridáš'
                                  : changed
                                    ? selected ? 'Bude pridaný po uložení' : 'Bude odobratý po uložení'
                                    : selected ? 'Oprávnený' : 'Kliknutím označíš'}
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
                  disabled={issueLoading || issueReadOnly || !pickupSelectionChanged}
                  style={styles.primaryButton}
                >
                  {issueLoading
                    ? 'Ukladám...'
                    : editingIssueId
                      ? `Uložiť zmeny (${pendingPickupUserIds.length})`
                      : `Potvrdiť prevzatie (${pendingPickupUserIds.length})`}
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
    border: '1px solid #86efac',
    borderRadius: 8,
    background: '#dcfce7',
    padding: '10px 12px',
    marginBottom: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    color: '#14532d',
    fontSize: 13,
    fontWeight: 900,
    boxShadow: 'inset 4px 0 0 #22c55e'
  },
  prepHeadingInfo: {
    display: 'grid',
    gap: 3,
    minWidth: 0
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
  readOnlyNotice: {
    border: '1px solid #fed7aa',
    borderRadius: 8,
    background: '#fff7ed',
    color: '#9a3412',
    padding: '9px 10px',
    marginTop: 10,
    marginBottom: 10,
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
  readOnlyInputValue: {
    width: '100%',
    minWidth: 0,
    minHeight: 38,
    boxSizing: 'border-box',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '9px 10px',
    fontSize: 13,
    fontWeight: 900,
    background: '#f9fafb',
    color: '#374151',
    userSelect: 'none'
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
  prepareFoodGroupRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'end',
    flexWrap: 'wrap'
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
  issuedInlineStatus: {
    color: '#dc2626',
    fontWeight: 950
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
