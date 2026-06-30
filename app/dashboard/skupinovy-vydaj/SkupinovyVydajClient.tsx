'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { appText, type AppLanguage } from '@/lib/i18n'
import QrCameraScanner from './QrCameraScanner'

type MealType = 'OBED' | 'VECERA'
type MealSelection = MealType | ''
type IssueSourceMode = 'REGISTRATION_GROUP' | 'FOOD_GROUP' | 'ONE_OFF'
type PickupMode = 'selected' | 'group' | 'outside' | 'qr'
type FoodGroupMemberMode = 'group' | 'outside' | 'qr'
type FoodGroupSetupTab = 'NEW' | 'EDIT' | 'DELETE' | 'PICKUP'

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
  foodChoice?: string
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
  language?: AppLanguage
  initialDate: string
  minEditableDate: string
  groups: RegistrationGroupOption[]
  delegatesByGroupId: Record<string, Delegate[]>
  canEditExistingIssues: boolean
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

function localizedMealLabel(value: MealSelection, language: AppLanguage) {
  if (value === 'OBED') return language === 'EN' ? 'Lunch' : 'Obed'
  if (value === 'VECERA') return language === 'EN' ? 'Dinner' : 'Večera'
  return language === 'EN' ? 'Choose meal' : 'Vyberte jedlo'
}

function defaultIssueTitle(_groupName: string, meal: MealSelection, sequence: number, language: AppLanguage = 'SK') {
  if (!meal) return ''

  const mealText = localizedMealLabel(meal, language)
  return language === 'EN'
    ? `${mealText} issue no. ${Math.max(1, sequence)}`
    : `${mealText} výdaj č. ${Math.max(1, sequence)}`
}

function foodGroupIssueTitle(meal: MealSelection, foodGroupName: string, language: AppLanguage = 'SK') {
  if (!meal) return foodGroupName || ''

  const mealText = localizedMealLabel(meal, language)
  return language === 'EN'
    ? `${mealText} issue - ${foodGroupName || 'meal group'}`
    : `${mealText} výdaj - ${foodGroupName || 'stravovacia skupina'}`
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

function sourceLabel(value: IssuePerson['source'], language: AppLanguage = 'SK') {
  if (value === 'REGISTRATION_GROUP') return language === 'EN' ? 'Group' : 'Skupina'
  if (value === 'FOOD_GROUP') return language === 'EN' ? 'Meal group' : 'Strav. skupina'
  if (value === 'QR') return 'QR'
  return language === 'EN' ? 'Searched' : 'Vyhľadané'
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

export default function SkupinovyVydajClient({ language = 'SK', initialDate, minEditableDate, groups, delegatesByGroupId, canEditExistingIssues }: Props) {
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const t = (sk: string, en: string) => isEnglish ? en : sk
  const pageRef = useRef<HTMLElement | null>(null)
  const stableViewportHeightRef = useRef<number | null>(null)
  const delegateSearchRequestRef = useRef(0)
  const delegateSearchModeRef = useRef<'group' | 'outside'>('group')
  const pickupSearchRequestRef = useRef(0)
  const foodGroupSearchRequestRef = useRef(0)
  const foodGroupPickupSearchRequestRef = useRef(0)
  const [date, setDate] = useState(initialDate)
  const [meal, setMeal] = useState<MealSelection>('')
  const [confirmed, setConfirmed] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issueTitleEditing, setIssueTitleEditing] = useState(false)
  const [issuePeople, setIssuePeople] = useState<IssuePerson[]>([])
  const [selectedIssueUserIds, setSelectedIssueUserIds] = useState<string[]>([])
  const [issuePeopleConfirmed, setIssuePeopleConfirmed] = useState(false)
  const [pickupUserIds, setPickupUserIds] = useState<string[]>([])
  const [pickupUsers, setPickupUsers] = useState<SearchUser[]>([])
  const [issuePersonFilter, setIssuePersonFilter] = useState('')
  const [issueSearchOpen, setIssueSearchOpen] = useState(false)
  const [pickupQuery, setPickupQuery] = useState('')
  const [pickupResults, setPickupResults] = useState<SearchUser[]>([])
  const [pickupLoading, setPickupLoading] = useState(false)
  const [pickupMode, setPickupMode] = useState<PickupMode>('selected')
  const [pendingPickupSearchUsers, setPendingPickupSearchUsers] = useState<SearchUser[]>([])
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
  const [prepareSourceModalOpen, setPrepareSourceModalOpen] = useState(false)
  const [prepareSourceStep, setPrepareSourceStep] = useState<'SOURCE' | 'DETAIL'>('SOURCE')
  const [existingLoading, setExistingLoading] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [sourceMode, setSourceMode] = useState<IssueSourceMode>('REGISTRATION_GROUP')
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [selectedFoodGroupId, setSelectedFoodGroupId] = useState('')
  const [foodGroupsLoading, setFoodGroupsLoading] = useState(false)
  const [foodGroupModalOpen, setFoodGroupModalOpen] = useState(false)
  const [foodGroupModalStep, setFoodGroupModalStep] = useState<'MEMBERS' | 'PICKUP'>('MEMBERS')
  const [foodGroupEditId, setFoodGroupEditId] = useState('')
  const [foodGroupName, setFoodGroupName] = useState('')
  const [foodGroupMemberIds, setFoodGroupMemberIds] = useState<string[]>([])
  const [foodGroupMembers, setFoodGroupMembers] = useState<SearchUser[]>([])
  const [foodGroupOutsideUsers, setFoodGroupOutsideUsers] = useState<SearchUser[]>([])
  const [foodGroupMemberMode, setFoodGroupMemberMode] = useState<FoodGroupMemberMode>('group')
  const [foodGroupSearchQuery, setFoodGroupSearchQuery] = useState('')
  const [foodGroupSearchResults, setFoodGroupSearchResults] = useState<SearchUser[]>([])
  const [foodGroupMessage, setFoodGroupMessage] = useState('')
  const [foodGroupMessageType, setFoodGroupMessageType] = useState<'ok' | 'error'>('ok')
  const [foodGroupPickupMode, setFoodGroupPickupMode] = useState<FoodGroupMemberMode>('group')
  const [foodGroupPickupUserIds, setFoodGroupPickupUserIds] = useState<string[]>([])
  const [foodGroupPickupUsers, setFoodGroupPickupUsers] = useState<SearchUser[]>([])
  const [foodGroupPickupOutsideUsers, setFoodGroupPickupOutsideUsers] = useState<SearchUser[]>([])
  const [foodGroupPickupQuery, setFoodGroupPickupQuery] = useState('')
  const [foodGroupPickupResults, setFoodGroupPickupResults] = useState<SearchUser[]>([])
  const [foodGroupPickupLoading, setFoodGroupPickupLoading] = useState(false)
  const [foodGroupSetupOpen, setFoodGroupSetupOpen] = useState(false)
  const [foodGroupSetupTab, setFoodGroupSetupTab] = useState<FoodGroupSetupTab>('NEW')
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
  const selectedFoodGroup = useMemo(() => {
    return foodGroups.find(group => group.id === selectedFoodGroupId) || null
  }, [foodGroups, selectedFoodGroupId])

  const filteredGroups = useMemo(() => {
    const query = groupQuery.trim().toLowerCase()
    if (!query) return groups

    return groups.filter(group => group.name.toLowerCase().includes(query))
  }, [groups, groupQuery])

  const delegates = selectedGroupId ? delegateMap[selectedGroupId] || [] : []
  const pickupSelectedMode = pickupMode === 'selected'
  const pickupGroupMode = pickupMode === 'group'
  const pickupSearchOutside = pickupMode === 'outside'
  const pickupQrMode = pickupMode === 'qr'
  const foodGroupMemberGroupMode = foodGroupMemberMode === 'group'
  const foodGroupMemberOutsideMode = foodGroupMemberMode === 'outside'
  const foodGroupMemberQrMode = foodGroupMemberMode === 'qr'
  const foodGroupModalMembersStep = foodGroupModalStep === 'MEMBERS'
  const foodGroupModalPickupStep = foodGroupModalStep === 'PICKUP'
  const foodGroupPickupGroupMode = foodGroupPickupMode === 'group'
  const foodGroupPickupOutsideMode = foodGroupPickupMode === 'outside'
  const foodGroupPickupQrMode = foodGroupPickupMode === 'qr'
  const daySelectionReady = Boolean(date && selectedGroupId)
  const readOnlyDate = Boolean(date && minEditableDate && date < minEditableDate)
  const selectedIssuePeople = issuePeople.filter(person => selectedIssueUserIds.includes(person.id))
  const editableIssuePeople = editingIssueId
    ? issuePeople.filter(isPlannedIssuePerson)
    : issuePeople
  const issueFullyLocked = Boolean(editingIssueId && issuePeople.length > 0 && editableIssuePeople.length === 0)
  const issueReadOnly = readOnlyDate || issueFullyLocked || Boolean(editingIssueId && !canEditExistingIssues)
  const selectedMovableIssuePeople = selectedIssuePeople.filter(person => person.itemStatus === 'PLANNED')
  const selectedHasUnmovablePeople = selectedIssuePeople.some(person => person.itemStatus !== 'PLANNED')
  const selectedIssuablePeople = selectedIssuePeople.filter(isIssuePersonReady)
  const selectedSummary = selectedIssuablePeople.reduce((summary, person) => {
    summary[person.choice] += 1
    summary.SPOLU += 1
    return summary
  }, { MASO: 0, VEGE: 0, DIETA: 0, SPOLU: 0 })
  const filteredIssuePeople = useMemo(() => {
    const query = sourceMode === 'ONE_OFF' ? '' : issuePersonFilter.trim().toLowerCase()
    const filtered = query
      ? issuePeople.filter(person => {
          return [
            displayIssuePersonName(person),
            person.name,
            person.email,
            person.choice,
            sourceLabel(person.source, language),
            person.issueStatusLabel || ''
          ].join(' ').toLowerCase().includes(query)
        })
      : issuePeople

    return [...filtered].sort(compareIssuePeople)
  }, [issuePeople, issuePersonFilter, language, sourceMode])
  const issuePickupCandidates = useMemo(() => {
    return selectedIssuablePeople.map(issuePersonToSearchUser)
  }, [selectedIssuablePeople])
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
  const pickupExternalUsers = useMemo(() => {
    const issueIds = new Set(issuePickupCandidates.map(user => user.id))
    return mergeSearchUsers(pickupUsers, pendingPickupExternalUsers)
      .filter(user => !issueIds.has(user.id))
  }, [issuePickupCandidates, pendingPickupExternalUsers, pickupUsers])
  const sourceGroupPickupUsers = useMemo(() => {
    if (sourceMode === 'ONE_OFF') {
      return mergeSearchUsers(issuePickupCandidates, pendingPickupSearchUsers)
    }

    if (sourceMode === 'FOOD_GROUP') {
      const query = pickupQuery.trim().toLowerCase()
      const sourceUsers = query
        ? foodGroupMembers.filter(user => {
            return [user.name, user.email].join(' ').toLowerCase().includes(query)
          })
        : foodGroupMembers

      return mergeSearchUsers(issuePickupCandidates, sourceUsers, pendingPickupSearchUsers)
    }

    return mergeSearchUsers(
      issuePickupCandidates,
      pendingPickupSearchUsers,
      pickupResults
    )
  }, [foodGroupMembers, issuePickupCandidates, pendingPickupSearchUsers, pickupQuery, pickupResults, sourceMode])
  const pickupKnownUsers = useMemo(() => {
    return mergeSearchUsers(pickupUsers, issuePickupCandidates, sourceGroupPickupUsers, pendingPickupSearchUsers, pendingPickupExternalUsers, pickupResults)
  }, [pickupUsers, issuePickupCandidates, sourceGroupPickupUsers, pendingPickupSearchUsers, pendingPickupExternalUsers, pickupResults])
  const pickupCandidateUsers = useMemo(() => {
    if (pickupSelectedMode) return issuePickupCandidates
    if (pickupGroupMode) return sourceGroupPickupUsers
    if (pickupQrMode) return pickupExternalUsers
    if (pickupSearchOutside) {
      return mergeSearchUsers(
        pickupExternalUsers,
        pickupQuery.trim().length >= 3 ? pickupResults : []
      )
    }

    return []
  }, [issuePickupCandidates, pickupExternalUsers, pickupGroupMode, pickupQrMode, pickupQuery, pickupResults, pickupSearchOutside, pickupSelectedMode, sourceGroupPickupUsers])
  const delegateUserIds = useMemo(() => delegates.map(delegate => delegate.userId), [delegates])
  const delegateSelectionChanged = !sameIds(delegateUserIds, pendingDelegateUserIds)
  const pickupSelectionChanged = !sameIds(pickupUserIds, pendingPickupUserIds)
  const foodGroupCandidateUsers = useMemo(() => {
    if (foodGroupMemberQrMode) return foodGroupMembers
    if (foodGroupMemberOutsideMode) {
      return mergeSearchUsers(
        foodGroupOutsideUsers,
        foodGroupSearchQuery.trim().length >= 3 ? foodGroupSearchResults : []
      )
    }

    return mergeSearchUsers(foodGroupMembers, foodGroupSearchResults)
  }, [foodGroupMemberOutsideMode, foodGroupMemberQrMode, foodGroupMembers, foodGroupOutsideUsers, foodGroupSearchQuery, foodGroupSearchResults])
  const foodGroupPickupCandidateUsers = useMemo(() => {
    if (foodGroupPickupQrMode) return foodGroupPickupUsers
    if (foodGroupPickupOutsideMode) {
      return mergeSearchUsers(
        foodGroupPickupOutsideUsers,
        foodGroupPickupQuery.trim().length >= 3 ? foodGroupPickupResults : []
      )
    }

    return mergeSearchUsers(foodGroupPickupUsers, foodGroupPickupResults)
  }, [foodGroupPickupOutsideMode, foodGroupPickupOutsideUsers, foodGroupPickupQrMode, foodGroupPickupQuery, foodGroupPickupResults, foodGroupPickupUsers])
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
    setPickupMode('selected')
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupSearchUsers([])
    setPendingPickupExternalUsers([])
    setPendingPickupUserIds(pickupUserIds)
  }

  function closePickupModal() {
    setPickupModalOpen(false)
    setPickupMode('selected')
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupUserIds([])
    setPendingPickupSearchUsers([])
    setPendingPickupExternalUsers([])
  }

  const renderDateInput = (
    value: string,
    onChange: (value: string) => void,
    disabled: boolean,
    placeholder = t('Vyber dátum', 'Choose date')
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
    setIssueTitleEditing(false)
    setIssuePeople([])
    setSelectedIssueUserIds([])
    setIssuePeopleConfirmed(false)
    setPickupUserIds([])
    setPickupUsers([])
    setIssuePersonFilter('')
    setIssueSearchOpen(false)
    setPickupQuery('')
    setPickupResults([])
    setPendingPickupSearchUsers([])
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

      if (!res.ok) throw new Error(json.error || t('Stravovacie skupiny sa nepodarilo načítať.', 'Meal groups could not be loaded.'))

      const nextGroups: FoodGroup[] = json.groups || []
      setFoodGroups(nextGroups)
      setSelectedFoodGroupId(current => nextGroups.some(group => group.id === current) ? current : '')
      return nextGroups
    } catch (err: any) {
      setIssueMessage(err?.message || t('Stravovacie skupiny sa nepodarilo načítať.', 'Meal groups could not be loaded.'), 'error')
      return []
    } finally {
      setFoodGroupsLoading(false)
    }
  }

  async function loadFoodGroupPeople(nextMeal: MealType, foodGroupId = selectedFoodGroupId) {
    if (!selectedGroupId || !foodGroupId || !date) return []

    const params = new URLSearchParams({
      registrationGroupId: selectedGroupId,
      foodGroupId,
      date,
      meal: nextMeal
    })
    const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
    const json = await res.json()

    if (!res.ok) throw new Error(json.error || t('Ľudí zo stravovacej skupiny sa nepodarilo načítať.', 'People from the meal group could not be loaded.'))

    if (Array.isArray(json.groups)) setFoodGroups(json.groups)
    if (Array.isArray(json.members)) setFoodGroupMembers(json.members)
    return (json.people || []) as IssuePerson[]
  }

  async function loadFoodGroupPickupUserIds(foodGroupId = selectedFoodGroupId) {
    if (!selectedGroupId || !foodGroupId) return []

    const params = new URLSearchParams({
      registrationGroupId: selectedGroupId,
      foodGroupId
    })
    const res = await fetch(`/api/skupinovy-vydaj/food-groups/pickup-users?${params.toString()}`)
    const json = await res.json()

    if (!res.ok) throw new Error(json.error || t('Oprávnených prevziať sa nepodarilo načítať.', 'Pickup permissions could not be loaded.'))

    return (json.pickupUserIds || []) as string[]
  }

  async function openFoodGroupModal(groupId = selectedFoodGroupId) {
    if (!selectedGroupId) {
      setIssueMessage(t('Najprv vyber registračnú skupinu.', 'Choose a registration group first.'), 'error')
      return
    }

    const groupsList = foodGroups.length ? foodGroups : await loadFoodGroups(selectedGroupId)
    const selected = groupsList.find(group => group.id === groupId) || null

    setFoodGroupEditId(selected?.id || '')
    setFoodGroupName(selected?.name || '')
    setFoodGroupMemberIds([])
    setFoodGroupMembers([])
    setFoodGroupOutsideUsers([])
    setFoodGroupModalStep('MEMBERS')
    setFoodGroupMemberMode('group')
    setFoodGroupSearchQuery('')
    setFoodGroupSearchResults([])
    setFoodGroupPickupMode('group')
    setFoodGroupPickupUserIds([])
    setFoodGroupPickupUsers([])
    setFoodGroupPickupOutsideUsers([])
    setFoodGroupPickupQuery('')
    setFoodGroupPickupResults([])
    setFoodGroupMessage('')
    setFoodGroupMessageType('ok')
    setFoodGroupModalOpen(true)

    if (!selected?.id || !date) {
      void searchFoodGroupMembers('', 'group')
      return
    }

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
      try {
        const pickupParams = new URLSearchParams({
          registrationGroupId: selectedGroupId,
          foodGroupId: selected.id
        })
        const pickupRes = await fetch(`/api/skupinovy-vydaj/food-groups/pickup-users?${pickupParams.toString()}`)
        const pickupJson = await pickupRes.json()
        if (pickupRes.ok) {
          setFoodGroupPickupUserIds(pickupJson.pickupUserIds || [])
          setFoodGroupPickupUsers(pickupJson.pickupUsers || [])
          setFoodGroupPickupOutsideUsers([])
        }
      } catch {
        setFoodGroupPickupUserIds([])
        setFoodGroupPickupUsers([])
        setFoodGroupPickupOutsideUsers([])
      }
    } catch (err: any) {
      setFoodGroupMessage(err?.message || 'Členov sa nepodarilo načítať.')
      setFoodGroupMessageType('error')
    } finally {
      setFoodGroupsLoading(false)
    }

    void searchFoodGroupMembers('', 'group')
  }

  async function openFoodGroupPickupModal(groupId: string) {
    await openFoodGroupModal(groupId)
    setFoodGroupModalStep('PICKUP')
    void searchFoodGroupPickupUsers('', 'group')
  }

  async function openFoodGroupSetup(tab: FoodGroupSetupTab) {
    if (!selectedGroupId) {
      setIssueMessage(t('Najprv vyber registračnú skupinu.', 'Choose a registration group first.'), 'error')
      return
    }

    setFoodGroupSetupTab(tab)
    setFoodGroupSetupOpen(true)
    if (foodGroups.length === 0) {
      await loadFoodGroups(selectedGroupId)
    }
  }

  function closeFoodGroupModal() {
    if (foodGroupsLoading) return
    foodGroupSearchRequestRef.current += 1
    setFoodGroupModalOpen(false)
    setFoodGroupModalStep('MEMBERS')
    setFoodGroupEditId('')
    setFoodGroupName('')
    setFoodGroupMemberIds([])
    setFoodGroupMembers([])
    setFoodGroupOutsideUsers([])
    setFoodGroupMemberMode('group')
    setFoodGroupSearchQuery('')
    setFoodGroupSearchResults([])
    setFoodGroupPickupMode('group')
    setFoodGroupPickupUserIds([])
    setFoodGroupPickupUsers([])
    setFoodGroupPickupOutsideUsers([])
    setFoodGroupPickupQuery('')
    setFoodGroupPickupResults([])
    setFoodGroupMessage('')
  }

  function continueFoodGroupModal() {
    if (!foodGroupName.trim()) {
      setFoodGroupMessage(t('Zadaj názov stravovacej skupiny.', 'Enter the meal group name.'))
      setFoodGroupMessageType('error')
      return
    }

    setFoodGroupMessage('')
    setFoodGroupModalStep('PICKUP')

    if (foodGroupPickupMode === 'group') {
      void searchFoodGroupPickupUsers('', 'group')
    }
  }

  function toggleFoodGroupMember(user: SearchUser) {
    const selected = foodGroupMemberIds.includes(user.id)
    setFoodGroupMembers(current => mergeSearchUsers(current, [user]))
    setFoodGroupMemberIds(current => current.includes(user.id)
      ? current.filter(id => id !== user.id)
      : [...current, user.id])

    if (foodGroupMemberOutsideMode) {
      setFoodGroupOutsideUsers(current => selected
        ? current.filter(existing => existing.id !== user.id)
        : mergeSearchUsers(current, [user]))
    }
  }

  function selectAllFoodGroupMembers() {
    setFoodGroupMembers(current => mergeSearchUsers(current, foodGroupCandidateUsers))
    setFoodGroupMemberIds(current => Array.from(new Set([
      ...current,
      ...foodGroupCandidateUsers.map(user => user.id)
    ])))

    if (foodGroupMemberOutsideMode) {
      setFoodGroupOutsideUsers(current => mergeSearchUsers(current, foodGroupCandidateUsers))
    }
  }

  function clearFoodGroupMembers() {
    setFoodGroupMemberIds([])
    setFoodGroupOutsideUsers([])
  }

  function switchFoodGroupMemberMode(mode: FoodGroupMemberMode) {
    foodGroupSearchRequestRef.current += 1
    setFoodGroupMemberMode(mode)
    setFoodGroupSearchQuery('')
    setFoodGroupSearchResults([])
    setFoodGroupsLoading(false)

    if (mode === 'group') {
      void searchFoodGroupMembers('', 'group')
    }
  }

  async function searchFoodGroupMembers(query: string, mode = foodGroupMemberMode) {
    const requestId = foodGroupSearchRequestRef.current + 1
    foodGroupSearchRequestRef.current = requestId
    setFoodGroupSearchQuery(query)
    setFoodGroupSearchResults([])

    const searchText = query.trim()
    if (
      !selectedGroupId ||
      !date ||
      mode === 'qr' ||
      (mode === 'outside' && searchText.length < 3)
    ) {
      setFoodGroupsLoading(false)
      return
    }

    setFoodGroupsLoading(true)
    setFoodGroupMessage('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        mode: 'pickup',
        date,
        q: searchText
      })
      if (mode === 'outside') params.set('scope', 'outside')
      const res = await fetch(`/api/skupinovy-vydaj/people-search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhľadávanie zlyhalo.')

      if (foodGroupSearchRequestRef.current !== requestId) return
      setFoodGroupSearchResults(json.people || [])
    } catch (err: any) {
      setFoodGroupMessage(err?.message || 'Vyhľadávanie zlyhalo.')
      setFoodGroupMessageType('error')
    } finally {
      if (foodGroupSearchRequestRef.current === requestId) {
        setFoodGroupsLoading(false)
      }
    }
  }

  async function addFoodGroupMemberByQr(qrCode: string) {
    if (!selectedGroupId) {
      return {
        tone: 'error' as const,
        message: t('Najprv vyber registračnú skupinu.', 'Choose a registration group first.')
      }
    }

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        qrCode
      })
      const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
      const json = await res.json()

      if (!res.ok || !json.user) {
        const message = json.error || t('QR sa nepodarilo načítať.', 'QR could not be loaded.')
        setFoodGroupMessage(message)
        setFoodGroupMessageType('error')
        return {
          tone: 'error' as const,
          message
        }
      }

      const user = json.user as SearchUser
      setFoodGroupMembers(current => mergeSearchUsers(current, [user]))
      setFoodGroupMemberIds(current => current.includes(user.id) ? current : [...current, user.id])

      const message = `${user.name || t('Osoba', 'Person')} ${t('pridaná do stravovacej skupiny.', 'added to the meal group.')}`
      setFoodGroupMessage(message)
      setFoodGroupMessageType('ok')

      return {
        tone: 'success' as const,
        message
      }
    } catch (err: any) {
      const message = err?.message || 'QR sa nepodarilo načítať.'
      setFoodGroupMessage(message)
      setFoodGroupMessageType('error')
      return {
        tone: 'error' as const,
        message
      }
    }
  }

  function switchFoodGroupPickupMode(mode: FoodGroupMemberMode) {
    foodGroupPickupSearchRequestRef.current += 1
    setFoodGroupPickupMode(mode)
    setFoodGroupPickupQuery('')
    setFoodGroupPickupResults([])
    setFoodGroupPickupLoading(false)

    if (mode === 'group') {
      void searchFoodGroupPickupUsers('', 'group')
    }
  }

  async function searchFoodGroupPickupUsers(query: string, mode = foodGroupPickupMode) {
    const requestId = foodGroupPickupSearchRequestRef.current + 1
    foodGroupPickupSearchRequestRef.current = requestId
    setFoodGroupPickupQuery(query)
    setFoodGroupPickupResults([])

    const searchText = query.trim()
    if (
      !selectedGroupId ||
      !date ||
      mode === 'qr' ||
      (mode === 'outside' && searchText.length < 3)
    ) {
      setFoodGroupPickupLoading(false)
      return
    }

    setFoodGroupPickupLoading(true)

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        mode: 'pickup',
        date,
        q: searchText
      })
      if (mode === 'outside') params.set('scope', 'outside')
      const res = await fetch(`/api/skupinovy-vydaj/people-search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhľadávanie zlyhalo.')

      if (foodGroupPickupSearchRequestRef.current !== requestId) return
      setFoodGroupPickupResults(json.people || [])
    } catch (err: any) {
      if (foodGroupPickupSearchRequestRef.current !== requestId) return
      setFoodGroupMessage(err?.message || 'Vyhľadávanie zlyhalo.')
      setFoodGroupMessageType('error')
    } finally {
      if (foodGroupPickupSearchRequestRef.current === requestId) {
        setFoodGroupPickupLoading(false)
      }
    }
  }

  function toggleFoodGroupPickupUser(user: SearchUser) {
    const selected = foodGroupPickupUserIds.includes(user.id)
    setFoodGroupPickupUsers(current => mergeSearchUsers(current, [user]))
    setFoodGroupPickupUserIds(current => current.includes(user.id)
      ? current.filter(id => id !== user.id)
      : [...current, user.id])

    if (foodGroupPickupOutsideMode) {
      setFoodGroupPickupOutsideUsers(current => selected
        ? current.filter(existing => existing.id !== user.id)
        : mergeSearchUsers(current, [user]))
    }
  }

  function selectAllFoodGroupPickupUsers() {
    setFoodGroupPickupUsers(current => mergeSearchUsers(current, foodGroupPickupCandidateUsers))
    setFoodGroupPickupUserIds(current => Array.from(new Set([
      ...current,
      ...foodGroupPickupCandidateUsers.map(user => user.id)
    ])))

    if (foodGroupPickupOutsideMode) {
      setFoodGroupPickupOutsideUsers(current => mergeSearchUsers(current, foodGroupPickupCandidateUsers))
    }
  }

  function clearFoodGroupPickupUsers() {
    setFoodGroupPickupUserIds([])
    setFoodGroupPickupOutsideUsers([])
  }

  async function addFoodGroupPickupUserByQr(qrCode: string) {
    if (!selectedGroupId) {
      return {
        tone: 'error' as const,
        message: t('Najprv vyber registračnú skupinu.', 'Choose a registration group first.')
      }
    }

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        qrCode
      })
      const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
      const json = await res.json()

      if (!res.ok || !json.user) {
        const message = json.error || t('QR sa nepodarilo načítať.', 'QR could not be loaded.')
        setFoodGroupMessage(message)
        setFoodGroupMessageType('error')
        return {
          tone: 'error' as const,
          message
        }
      }

      const user = json.user as SearchUser
      setFoodGroupPickupUsers(current => mergeSearchUsers(current, [user]))
      setFoodGroupPickupUserIds(current => current.includes(user.id) ? current : [...current, user.id])

      const message = `${user.name || t('Osoba', 'Person')} ${t('pridaná medzi oprávnených prevziať.', 'added to people allowed for pickup.')}`
      setFoodGroupMessage(message)
      setFoodGroupMessageType('ok')

      return {
        tone: 'success' as const,
        message
      }
    } catch (err: any) {
      const message = err?.message || 'QR sa nepodarilo načítať.'
      setFoodGroupMessage(message)
      setFoodGroupMessageType('error')
      return {
        tone: 'error' as const,
        message
      }
    }
  }

  async function saveFoodGroup() {
    if (!selectedGroupId) return
    if (!foodGroupName.trim()) {
      setFoodGroupMessage(t('Zadaj názov stravovacej skupiny.', 'Enter the meal group name.'))
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

      if (!res.ok) throw new Error(json.error || t('Stravovaciu skupinu sa nepodarilo uložiť.', 'Meal group could not be saved.'))

      const savedGroupId = json.group?.id || foodGroupEditId
      if (savedGroupId) {
        const pickupRes = await fetch('/api/skupinovy-vydaj/food-groups/pickup-users', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            registrationGroupId: selectedGroupId,
            foodGroupId: savedGroupId,
            pickupUserIds: foodGroupPickupUserIds
          })
        })
        const pickupJson = await pickupRes.json()

        if (!pickupRes.ok) throw new Error(pickupJson.error || t('Oprávnených prevziať sa nepodarilo uložiť.', 'Pickup permissions could not be saved.'))
      }

      setFoodGroups(json.groups || [])
      setSelectedFoodGroupId(json.group?.id || selectedFoodGroupId)
      setFoodGroupMessage(json.message || t('Stravovacia skupina bola uložená.', 'Meal group has been saved.'))
      setFoodGroupMessageType('ok')
      window.setTimeout(() => closeFoodGroupModal(), 350)
    } catch (err: any) {
      setFoodGroupMessage(err?.message || t('Stravovaciu skupinu sa nepodarilo uložiť.', 'Meal group could not be saved.'))
      setFoodGroupMessageType('error')
    } finally {
      setFoodGroupsLoading(false)
    }
  }

  async function deleteFoodGroup(group: FoodGroup) {
    if (!selectedGroupId || foodGroupsLoading) return

    const ok = window.confirm(isEnglish ? `Delete meal group "${group.name}"?` : `Zrušiť stravovaciu skupinu "${group.name}"?`)
    if (!ok) return

    setFoodGroupsLoading(true)
    setFoodGroupMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/food-groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: selectedGroupId,
          foodGroupId: group.id
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || t('Stravovaciu skupinu sa nepodarilo zrušiť.', 'Meal group could not be deleted.'))

      setFoodGroups(json.groups || [])
      if (selectedFoodGroupId === group.id) setSelectedFoodGroupId('')
      if (foodGroupEditId === group.id) {
        setFoodGroupEditId('')
        setFoodGroupName('')
        setFoodGroupMemberIds([])
        setFoodGroupMembers([])
      }
      setFoodGroupMessage(json.message || t('Stravovacia skupina bola zrušená.', 'Meal group has been deleted.'))
      setFoodGroupMessageType('ok')
    } catch (err: any) {
      setFoodGroupMessage(err?.message || t('Stravovaciu skupinu sa nepodarilo zrušiť.', 'Meal group could not be deleted.'))
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

      if (!res.ok) throw new Error(json.error || t('Existujúce výdaje sa nepodarilo načítať.', 'Existing issues could not be loaded.'))

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
      setIssueMessage(err?.message || t('Existujúce výdaje sa nepodarilo načítať.', 'Existing issues could not be loaded.'), 'error')
    })
  }, [selectedGroupId, date, confirmed])

  useEffect(() => {
    if (!selectedGroupId) return
    void loadFoodGroups(selectedGroupId)
  }, [selectedGroupId])

  async function loadIssuePeople(nextMeal: MealType) {
    if (!selectedGroupId || !date) return

    if (readOnlyDate) {
      setIssueMessage(t('Starší dátum je iba na prezeranie. Nový skupinový výdaj môžeš vytvoriť najskôr na dnešný dátum.', 'Older dates are read-only. You can create a new group issue from today at the earliest.'), 'error')
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

        if (!res.ok) throw new Error(json.error || t('Ľudí sa nepodarilo načítať.', 'People could not be loaded.'))

        people = json.people || []
        excludedCount = Number(json.plannedExcludedCount || 0)
      } else if (sourceMode === 'FOOD_GROUP') {
        if (!selectedFoodGroupId) throw new Error(t('Vyber stravovaciu skupinu.', 'Choose a meal group.'))
        people = await loadFoodGroupPeople(nextMeal)
      }

      setIssuePeople(people)
      setSelectedIssueUserIds([])
      setPickupUserIds([])
      setPickupUsers([])
      setIssuePersonFilter('')
      setIssueSearchOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupSearchUsers([])
      setPendingPickupExternalUsers([])
      setIssuePeopleConfirmed(true)
      setEditingIssueId('')
      setEditingIssueStatus('')
      setEditingIssueValidAfter(null)
      const dailyIssues = await loadExistingIssuesFor(selectedGroupId, date, '')
      const existingForMeal = dailyIssues.filter(issue => issue.meal === nextMeal).length
      setIssueTitle(defaultIssueTitle(selectedGroup?.name || '', nextMeal, existingForMeal + 1, language))
      setConfirmed(true)
      setPrepareSourceModalOpen(false)
      setIssueMessage(
        people.length
          ? excludedCount > 0
            ? (isEnglish
              ? `Loaded ${people.length} remaining issuable people. People already prepared in another group issue are skipped.`
              : `Načítaných ${people.length} zvyšných vydateľných osôb. Ľudia už pripravení v inom skupinovom výdaji sú vynechaní.`)
            : (isEnglish
              ? `Loaded ${people.length} currently issuable people.`
              : `Načítaných ${people.length} aktuálne vydateľných osôb.`)
          : t('Pre tento výber nie je aktuálne nikto vydateľný.', 'There is currently nobody issuable for this selection.'),
        people.length ? 'ok' : 'error'
      )
    } catch (err: any) {
      setIssueMessage(err?.message || t('Ľudí sa nepodarilo načítať.', 'People could not be loaded.'), 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  function openPrepareSourceModal() {
    if (!selectedGroupId || !date || !meal) {
      setIssueMessage(t('Najprv vyber dátum, registračnú skupinu a jedlo.', 'Choose date, registration group and meal first.'), 'error')
      return
    }

    if (readOnlyDate) {
      setIssueMessage(t('Starší dátum je iba na prezeranie.', 'Older date is read-only.'), 'error')
      return
    }

    setIssueMessage('')
    setSourceMode('FOOD_GROUP')
    setSelectedFoodGroupId('')
    setPrepareSourceStep('SOURCE')
    setPrepareSourceModalOpen(true)
    if (selectedGroupId) void loadFoodGroups(selectedGroupId)
  }

  function selectSourceMode(nextSourceMode: IssueSourceMode, nextStep: 'SOURCE' | 'DETAIL' = 'SOURCE') {
    setSourceMode(nextSourceMode)
    setPrepareSourceStep(nextStep)
    if (nextSourceMode === 'FOOD_GROUP') setSelectedFoodGroupId('')
    resetIssueState({ clearExisting: false, preserveMeal: true })
    if (nextSourceMode === 'FOOD_GROUP' && selectedGroupId) {
      void loadFoodGroups(selectedGroupId)
    }
  }

  function continuePrepareFromSourceModal() {
    if (!meal) return

    if (sourceMode === 'FOOD_GROUP') {
      if (prepareSourceStep !== 'DETAIL') {
        setPrepareSourceStep('DETAIL')
        if (selectedGroupId) void loadFoodGroups(selectedGroupId)
        return
      }

      if (!selectedFoodGroupId) {
        setFoodGroupMessage(t('Vyber stravovaciu skupinu.', 'Choose a meal group.'))
        setFoodGroupMessageType('error')
        return
      }

      void createFoodGroupIssue()
      return
    }

    void loadIssuePeople(meal)
  }

  async function createFoodGroupIssue() {
    if (!selectedGroupId || !selectedFoodGroupId || !date || !meal) return

    setIssueLoading(true)
    setIssueMessage('')
    setFoodGroupMessage('')
    setCreatedIssue(null)

    try {
      const people = await loadFoodGroupPeople(meal, selectedFoodGroupId)
      const issuablePeople = people.filter(isIssuePersonReady)
      let savedPickupUserIds: string[] = []
      try {
        savedPickupUserIds = await loadFoodGroupPickupUserIds(selectedFoodGroupId)
      } catch {
        savedPickupUserIds = []
      }
      const pickupIds = savedPickupUserIds.length > 0
        ? savedPickupUserIds
        : issuablePeople.map(person => person.id)

      if (issuablePeople.length === 0) {
        throw new Error(t('Táto stravovacia skupina nemá pre tento výdaj žiadne vydateľné osoby.', 'This meal group has no issuable people for this issue.'))
      }

      const title = foodGroupIssueTitle(meal, selectedFoodGroup?.name || '', language)

      const res = await fetch('/api/skupinovy-vydaj/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: selectedGroupId,
          date,
          meal,
          title,
          people: issuablePeople.map(person => ({
            userId: person.id,
            source: 'FOOD_GROUP'
          })),
          pickupUserIds: pickupIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || t('Skupinový výdaj sa nepodarilo vytvoriť.', 'Group issue could not be created.'))

      setPrepareSourceModalOpen(false)
      resetIssueState({ preserveMeal: true, clearExisting: false })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || (isEnglish ? `Group issue was created for ${issuablePeople.length} people.` : `Skupinový výdaj bol vytvorený pre ${issuablePeople.length} osôb.`))
    } catch (err: any) {
      const message = err?.message || t('Skupinový výdaj sa nepodarilo vytvoriť.', 'Group issue could not be created.')
      setFoodGroupMessage(message)
      setFoodGroupMessageType('error')
      setIssueMessage(message, 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  function closeIssueEditor() {
    resetIssueState({ clearExisting: false, preserveMeal: true })
    if (selectedGroupId && date) void loadExistingIssuesFor(selectedGroupId, date, '')
  }

  function backIssueEditorToSource() {
    setConfirmed(false)
    setPrepareSourceStep('SOURCE')
    setPrepareSourceModalOpen(true)
  }

  async function editExistingIssue(issueId: string) {
    setIssueLoading(true)
    setIssueMessage('')
    setCreatedIssue(null)

    try {
      const params = new URLSearchParams({ issueId })
      const res = await fetch(`/api/skupinovy-vydaj/issues?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || t('Skupinový výdaj sa nepodarilo načítať.', 'Group issue could not be loaded.'))

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
      setIssueSearchOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupSearchUsers([])
      setPendingPickupExternalUsers([])
      setMoveModalOpen(false)
      setMoveTargetIssueId('')
      const hasEditablePeople = people.some(isPlannedIssuePerson)
      setConfirmed(true)
      setIssueMessage(
        readOnlyDate || !hasEditablePeople
          ? t('Skupinový výdaj je načítaný na prezeranie.', 'Group issue is loaded as read-only.')
          : t('Skupinový výdaj je načítaný na úpravu.', 'Group issue is loaded for editing.')
      )
    } catch (err: any) {
      setIssueMessage(err?.message || t('Skupinový výdaj sa nepodarilo načítať.', 'Group issue could not be loaded.'), 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function cancelExistingIssue(issue: ExistingIssue) {
    if (readOnlyDate) {
      setIssueMessage(t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.'), 'error')
      return
    }

    const ok = window.confirm(isEnglish ? `Cancel group issue "${issue.title}"?` : `Zrušiť skupinový výdaj "${issue.title}"?`)
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

      if (!res.ok) throw new Error(json.error || t('Skupinový výdaj sa nepodarilo zrušiť.', 'Group issue could not be cancelled.'))

      if (editingIssueId === issue.id) resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || t('Skupinový výdaj bol zrušený.', 'Group issue has been cancelled.'))
    } catch (err: any) {
      setIssueMessage(err?.message || t('Skupinový výdaj sa nepodarilo zrušiť.', 'Group issue could not be cancelled.'), 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function addIssuePersonByQr(qrCode: string) {
    if (issueReadOnly) {
      return {
        tone: 'error' as const,
        message: issueFullyLocked
          ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.')
          : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.')
      }
    }

    if (!selectedGroupId || !date || !meal) {
      return {
        tone: 'error' as const,
        message: t('Najprv vyber registračnú skupinu, dátum a jedlo.', 'Choose registration group, date and meal first.')
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
      const message = json.error || t('QR sa nepodarilo pridať.', 'QR could not be added.')
      setIssueMessage(message, 'error')
      return {
        tone: 'error' as const,
        message
      }
    }

    addIssuePerson(json.person)
    const ready = isIssuePersonReady(json.person)
    const message = ready
      ? `${json.person.name || t('Osoba', 'Person')} ${t('pridaná cez QR.', 'added by QR.')}`
      : `${json.person.name || t('Osoba', 'Person')} ${t('pridaná cez QR, ale nie je vydateľná:', 'added by QR, but is not issuable:')} ${json.person.issueStatusLabel || t('bez nároku', 'no entitlement')}.`
    setIssueMessage(message, ready ? 'ok' : 'error')

    return {
      tone: ready ? 'success' as const : 'error' as const,
      message
    }
  }

  function addIssuePerson(person: IssuePerson) {
    setIssuePeople(current => {
      if (current.some(item => item.id === person.id)) {
        return current.map(item => {
          if (item.id !== person.id) return item

          return {
            ...item,
            ...person,
            issueStatus: person.issueStatus,
            issueStatusLabel: person.issueStatusLabel,
            itemStatus: person.itemStatus ?? item.itemStatus
          }
        })
      }

      return [...current, person]
    })
    if (!isIssuePersonReady(person)) return

    setSelectedIssueUserIds(current => {
      if (current.includes(person.id)) return current
      return [...current, person.id]
    })
  }

  function toggleIssuePerson(userId: string) {
    if (issueReadOnly) return

    const person = issuePeople.find(item => item.id === userId)
    if (editingIssueId && person && !isPlannedIssuePerson(person)) return
    if (person && !isIssuePersonReady(person)) return

    setSelectedIssueUserIds(current => {
      return current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]
    })
  }

  function handleBulkIssueSelection(action: string) {
    if (issueReadOnly) return

    if (action === 'ALL') {
      setSelectedIssueUserIds(editableIssuePeople.filter(isIssuePersonReady).map(person => person.id))
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
      setIssueMessage(issueFullyLocked ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.') : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.'), 'error')
      return
    }

    if (selectedIssuablePeople.length === 0) {
      setIssueMessage(t('Vyber aspoň jednu osobu.', 'Select at least one person.'), 'error')
      return
    }

    setIssuePeopleConfirmed(true)
    setIssueMessage(t('Osoby vo výdaji sú potvrdené. Teraz vyber, kto môže výdaj prevziať.', 'People in the issue are confirmed. Now choose who can pick it up.'))
    openPickupModal()
  }

  function openMoveModal() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.') : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.'), 'error')
      return
    }

    if (!editingIssueId || selectedIssuePeople.length === 0) return

    if (selectedHasUnmovablePeople) {
      setIssueMessage(t('Presunúť je možné iba osoby, ktoré ešte nemajú vydané jedlo.', 'Only people without issued meal can be moved.'), 'error')
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

      if (!res.ok) throw new Error(json.error || t('Osoby sa nepodarilo presunúť.', 'People could not be moved.'))

      const currentIssueId = editingIssueId
      closeMoveModal()
      await editExistingIssue(currentIssueId)
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(json.message || t('Osoby boli presunuté.', 'People have been moved.'))
    } catch (err: any) {
      setIssueMessage(err?.message || t('Osoby sa nepodarilo presunúť.', 'People could not be moved.'), 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  function switchPickupMode(mode: PickupMode) {
    pickupSearchRequestRef.current += 1
    setPickupMode(mode)
    setPickupQuery('')
    setPickupResults([])
    setPickupLoading(false)
    if (mode === 'group' && sourceMode === 'REGISTRATION_GROUP') {
      void searchPickupUsers('', 'group')
    }
  }

  async function searchPickupUsers(query: string, mode = pickupMode) {
    const requestId = pickupSearchRequestRef.current + 1
    pickupSearchRequestRef.current = requestId
    setPickupQuery(query)
    setPickupResults([])

    const searchText = query.trim()
    if (
      !selectedGroupId ||
      (mode !== 'group' && mode !== 'outside') ||
      sourceMode === 'FOOD_GROUP' ||
      sourceMode === 'ONE_OFF' ||
      (mode === 'outside' && searchText.length < 3)
    ) {
      setPickupLoading(false)
      return
    }

    setPickupLoading(true)

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        mode: 'pickup',
        date,
        q: searchText
      })
      if (mode === 'outside') params.set('scope', 'outside')
      const res = await fetch(`/api/skupinovy-vydaj/people-search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhladavanie zlyhalo.')

      if (pickupSearchRequestRef.current !== requestId) return
      setPickupResults(json.people || [])
    } catch (err: any) {
      if (pickupSearchRequestRef.current !== requestId) return
      setIssueMessage(err?.message || 'Vyhladavanie zlyhalo.', 'error')
    } finally {
      if (pickupSearchRequestRef.current === requestId) {
        setPickupLoading(false)
      }
    }
  }

  function togglePendingPickupUser(user: SearchUser, source: 'group' | 'outside') {
    const selected = pendingPickupUserIds.includes(user.id)

    if (selected) {
      setPendingPickupUserIds(current => current.filter(id => id !== user.id))
      setPendingPickupSearchUsers(current => current.filter(item => item.id !== user.id))
      setPendingPickupExternalUsers(current => current.filter(item => item.id !== user.id))
      return
    }

    setPendingPickupUserIds(current => current.includes(user.id) ? current : [...current, user.id])

    if (source === 'outside') {
      setPendingPickupExternalUsers(current => mergeSearchUsers(current, [user]))
    } else {
      setPendingPickupSearchUsers(current => mergeSearchUsers(current, [user]))
    }
  }

  function selectAllPickupCandidates() {
    setPendingPickupUserIds(current => Array.from(new Set([
      ...current,
      ...pickupCandidateUsers.map(user => user.id)
    ])))

    if (pickupSearchOutside || pickupQrMode) {
      setPendingPickupExternalUsers(current => mergeSearchUsers(current, pickupCandidateUsers))
    } else {
      setPendingPickupSearchUsers(current => mergeSearchUsers(current, pickupCandidateUsers))
    }
  }

  function clearPickupCandidates() {
    setPendingPickupUserIds([])
  }

  async function addPickupUserByQr(qrCode: string) {
    if (issueReadOnly) {
      return {
        tone: 'error' as const,
        message: issueFullyLocked
          ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.')
          : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.')
      }
    }

    if (!selectedGroupId) {
      return {
        tone: 'error' as const,
        message: t('Najprv vyber registračnú skupinu.', 'Choose a registration group first.')
      }
    }

    const params = new URLSearchParams({
      registrationGroupId: selectedGroupId,
      qrCode
    })
    const res = await fetch(`/api/skupinovy-vydaj/food-groups?${params.toString()}`)
    const json = await res.json()

    if (!res.ok || !json.user) {
      const message = json.error || t('QR sa nepodarilo načítať.', 'QR could not be loaded.')
      setIssueMessage(message, 'error')
      return {
        tone: 'error' as const,
        message
      }
    }

    const user = json.user as SearchUser
    setPendingPickupUserIds(current => current.includes(user.id) ? current : [...current, user.id])
    setPendingPickupExternalUsers(current => mergeSearchUsers(current, [user]))

    const message = pendingPickupUserIds.includes(user.id)
      ? `${user.name || t('Osoba', 'Person')} ${t('už je označená na prevzatie.', 'is already selected for pickup.')}`
      : `${user.name || t('Osoba', 'Person')} ${t('pridaná cez QR.', 'added by QR.')}`
    setIssueMessage(message)

    return {
      tone: 'success' as const,
      message
    }
  }

  async function savePickupSelection() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.') : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.'), 'error')
      return
    }

    if (pendingPickupUserIds.length === 0) {
      setIssueMessage(t('Pridaj aspoň jednu osobu oprávnenú prevziať výdaj.', 'Add at least one person allowed to pick up the issue.'), 'error')
      return
    }

    const usersById = new Map(pickupKnownUsers.map(user => [user.id, user]))
    const nextUsers = pendingPickupUserIds
      .map(id => usersById.get(id))
      .filter(Boolean) as SearchUser[]

    if (!editingIssueId) {
      setPickupUsers(nextUsers)
      setPickupUserIds(pendingPickupUserIds)
      setPickupModalOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupSearchUsers([])
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

      if (!res.ok) throw new Error(json.error || t('Oprávnených prevziať sa nepodarilo uložiť.', 'Pickup permissions could not be saved.'))

      setPickupUsers(json.pickupUsers || nextUsers)
      setPickupUserIds(json.pickupUserIds || pendingPickupUserIds)
      setPickupModalOpen(false)
      setPickupQuery('')
      setPickupResults([])
      setPendingPickupSearchUsers([])
      setPendingPickupExternalUsers([])
      setIssueMessage(json.message || t('Oprávnení prevziať boli uložení.', 'Pickup permissions have been saved.'))
    } catch (err: any) {
      setIssueMessage(err?.message || t('Oprávnených prevziať sa nepodarilo uložiť.', 'Pickup permissions could not be saved.'), 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function saveIssue() {
    if (issueReadOnly) {
      setIssueMessage(issueFullyLocked ? t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.', 'No person can be edited in this group issue anymore.') : t('Starší skupinový výdaj je možné iba prezerať.', 'Older group issue is read-only.'), 'error')
      return
    }

    if (!selectedGroupId || !date || !meal || selectedIssuablePeople.length === 0) {
      setIssueMessage(t('Vyber aspoň jednu osobu.', 'Select at least one person.'), 'error')
      return
    }

    if (!editingIssueId && !issuePeopleConfirmed) {
      setIssueMessage(t('Najprv potvrď osoby vo výdaji a potom vyber oprávnených prevziať.', 'Confirm people in the issue first, then choose who can pick it up.'), 'error')
      return
    }

    if (pickupUserIds.length === 0) {
      setIssueMessage(t('Pridaj aspoň jednu osobu oprávnenú prevziať výdaj.', 'Add at least one person allowed to pick up the issue.'), 'error')
      return
    }

    const title = issueTitle.trim()

    if (!title) {
      setIssueMessage(t('Zadaj názov skupinového výdaja.', 'Enter the group issue name.'), 'error')
      return
    }

    const wasEditing = Boolean(editingIssueId)

    if (editWillResetWaiting) {
      const ok = window.confirm(t('Uložením úprav sa skupinový výdaj znova aktivuje až o 15 minút. Pokračovať?', 'Saving changes will activate the group issue again after 15 minutes. Continue?'))
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
          people: selectedIssuablePeople.map(person => ({
            userId: person.id,
            source: person.source
          })),
          pickupUserIds
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || t('Skupinový výdaj sa nepodarilo uložiť.', 'Group issue could not be saved.'))

      const successMessage = json.message || (wasEditing
        ? t('Skupinový výdaj bol upravený.', 'Group issue has been updated.')
        : t('Skupinový výdaj bol vytvorený.', 'Group issue has been created.'))

      setQrModalOpen(false)

      resetIssueState({ preserveMeal: true })
      await loadExistingIssuesFor(selectedGroupId, date, '')
      setIssueMessage(successMessage)
    } catch (err: any) {
      setIssueMessage(err?.message || t('Skupinový výdaj sa nepodarilo uložiť.', 'Group issue could not be saved.'), 'error')
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

        if (!res.ok) throw new Error(json.error || t('Poverenú osobu sa nepodarilo odobrať.', 'Delegated person could not be removed.'))
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

        if (!res.ok) throw new Error(json.error || t('Poverenú osobu sa nepodarilo pridať.', 'Delegated person could not be added.'))
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
      setMessage(err?.message || t('Poverené osoby sa nepodarilo uložiť.', 'Delegated people could not be saved.'), 'error')
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
          .group-issue-action-hub { grid-template-columns: 1fr !important; }
          .group-issue-setup-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
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
            <h1 className="group-issue-title" style={styles.title}>{copy.groupIssue}</h1>
            <p style={styles.subtitle}>
              {isEnglish
                ? 'Prepare meal distribution for registration groups and delegated people.'
                : 'Príprava výdaja pre registračné skupiny a poverených ľudí.'}
            </p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            {copy.back}
          </Link>
        </header>

        {groups.length === 0 ? (
          <div style={styles.messageError}>{t('Nemáte pridelenú registračnú skupinu pre skupinový výdaj.', 'You do not have an assigned registration group for group issue.')}</div>
        ) : (
          <div className="group-issue-layout" style={styles.layout}>
            {confirmed && (
              <div style={styles.modalOverlay}>
                <section className="group-issue-main" style={styles.issueEditorModal}>
                <div style={styles.prepHeading}>
                  <div style={styles.prepHeadingInfo}>
                    <span style={styles.summaryLabel}>{isEnglish ? 'Preparing' : 'Pripravuješ'}</span>
                    <b>{localizedMealLabel(meal, language)} · {selectedGroup?.name || '-'}</b>
                    <small>{fullDateLabel(date)}</small>
                    <div style={styles.issueTitleRow}>
                      <span style={styles.issueTitleLabel}>{isEnglish ? 'Issue name:' : 'Názov výdaja:'}</span>
                      <div style={styles.issueTitleCompact}>
                        {issueTitleEditing && !issueReadOnly ? (
                          <input
                            type="text"
                            value={issueTitle}
                            onChange={event => setIssueTitle(event.target.value)}
                            placeholder={isEnglish ? 'Issue name' : 'Názov výdaja'}
                            style={styles.compactTitleInput}
                            disabled={issueLoading}
                            autoFocus
                          />
                        ) : (
                          <span>{issueTitle || '-'}</span>
                        )}

                        {!issueReadOnly && (
                          <button
                            type="button"
                            onClick={() => setIssueTitleEditing(open => !open)}
                            style={styles.compactIconButton}
                            disabled={issueLoading}
                             title={isEnglish ? 'Edit name' : 'Upraviť názov'}
                             aria-label={isEnglish ? 'Edit name' : 'Upraviť názov'}
                          >
                            Z
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={styles.modalHeaderActions}>
                    <button
                      type="button"
                      onClick={backIssueEditorToSource}
                      style={styles.iconBackButton}
                      title={copy.back}
                      aria-label={copy.back}
                    >
                      ←
                    </button>

                    <button
                      type="button"
                      onClick={closeIssueEditor}
                      style={styles.qrCloseButton}
                      title={t('Zatvoriť', 'Close')}
                      aria-label={t('Zatvoriť', 'Close')}
                    >
                      x
                    </button>
                  </div>
                </div>

                <div style={styles.issueEditorBody}>
                {readOnlyDate && (
                  <div style={styles.readOnlyNotice}>
                    {t('Starší dátum je iba na prezeranie. Vytvoriť alebo upraviť skupinový výdaj môžeš najskôr na dnešný dátum.', 'Older dates are read-only. You can create or edit a group issue from today at the earliest.')}
                  </div>
                )}

                {sourceMode === 'FOOD_GROUP' && !editingIssueId && (
                  <div style={styles.issueSourcePanel}>
                    <div style={styles.issueSourceHeader}>
                      <div>
                        <b>{selectedFoodGroup?.name || t('Stravovacia skupina', 'Meal group')}</b>
                        <div style={styles.emptyInlineText}>
                          {selectedFoodGroup ? `${selectedFoodGroup.memberCount} ${t('osôb v skupine', 'people in group')}` : t('Vybraná stravovacia skupina', 'Selected meal group')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openFoodGroupModal(selectedFoodGroupId)}
                        style={styles.smallButtonWhite}
                        disabled={issueLoading || issueReadOnly || foodGroupsLoading}
                      >
                        {t('Spravovať', 'Manage')}
                      </button>
                    </div>
                  </div>
                )}

                {issueFullyLocked && (
                  <div style={styles.readOnlyNotice}>
                    {t('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu. Výdaj je iba na prezeranie.', 'No person can be edited in this group issue anymore. The issue is read-only.')}
                  </div>
                )}

                {editingWaitingInfo && (
                  <div style={styles.waitingNotice}>
                    <b>{editingWaitingInfo.active ? `${t('Začne platiť o', 'Starts in')} ${editingWaitingInfo.countdown}` : t('Platnosť je aktívna', 'Validity is active')}</b>
                    <span>{t('Platí od:', 'Valid from:')} {editingWaitingInfo.startsAt}</span>
                  </div>
                )}

                {editWillResetWaiting && (
                  <div style={styles.resetWaitingNotice}>
                    {t('Uložením úprav sa tento skupinový výdaj znova aktivuje až o 15 minút.', 'Saving changes will activate this group issue again after 15 minutes.')}
                  </div>
                )}

                <div style={styles.issueToolbar}>
                  {sourceMode !== 'ONE_OFF' && (
                    <div style={styles.toolbarLeft}>
                      <button
                        type="button"
                        onClick={() => handleBulkIssueSelection('ALL')}
                        disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                        style={styles.bulkButton}
                      >
                        {isEnglish ? 'All' : 'Všetci'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkIssueSelection('READY')}
                        disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                        style={styles.bulkButton}
                      >
                        {isEnglish ? 'Issuable' : 'Vydateľní'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkIssueSelection('NONE')}
                        disabled={issueLoading || issueReadOnly || editableIssuePeople.length === 0}
                        style={styles.bulkButton}
                      >
                        {isEnglish ? 'None' : 'Žiadni'}
                      </button>
                    </div>
                  )}

                  <div style={sourceMode === 'ONE_OFF' ? styles.qrOnlyToolbar : styles.toolbarRight}>
                    <button
                      type="button"
                      onClick={() => setQrModalOpen(true)}
                      disabled={issueLoading || issueReadOnly || !selectedGroupId || !date || !meal}
                      style={sourceMode === 'ONE_OFF'
                        ? { ...styles.primaryButton, width: '100%' }
                        : styles.compactDarkButton}
                    >
                      {sourceMode === 'ONE_OFF' ? (isEnglish ? 'Add people by QR' : 'Pridať ľudí cez QR') : 'QR'}
                    </button>

                    {sourceMode !== 'ONE_OFF' && (
                      <button
                        type="button"
                        onClick={() => {
                          setIssueSearchOpen(open => {
                            if (open) setIssuePersonFilter('')
                            return !open
                          })
                        }}
                        disabled={issuePeople.length === 0}
                        style={{
                          ...styles.secondaryButton,
                          ...styles.compactButton,
                          ...(issueSearchOpen || issuePersonFilter ? styles.secondaryButtonActive : {})
                        }}
                      >
                        {isEnglish ? 'Search' : 'Hľadať'}
                      </button>
                    )}
                  </div>

                  {editingIssueId && sourceMode !== 'ONE_OFF' && (
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
                      {isEnglish ? 'Move' : 'Presunúť'} ({selectedMovableIssuePeople.length})
                    </button>
                  )}
                </div>

                <div style={styles.peopleSectionHeader}>
                  <b>{isEnglish ? 'People in issue' : 'Osoby vo výdaji'}</b>
                  <span>
                    {selectedSummary.SPOLU} {isEnglish ? 'issuable' : 'vydateľných'} / {selectedIssueUserIds.length} {isEnglish ? 'selected' : 'označených'} / {issuePeople.length} {isEnglish ? 'total' : 'spolu'}
                  </span>
                </div>

                {sourceMode !== 'ONE_OFF' && (issueSearchOpen || issuePersonFilter) && (
                  <input
                    type="search"
                    value={issuePersonFilter}
                    onChange={event => setIssuePersonFilter(event.target.value)}
                    placeholder={isEnglish ? 'Search people in issue' : 'Hľadať v osobách vo výdaji'}
                    style={styles.filterInput}
                    disabled={issuePeople.length === 0}
                    autoFocus
                  />
                )}

                <div style={styles.issuePeopleList}>
                  {issuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>{t('Pre tento dátum a jedlo nie je aktuálne nikto vydateľný.', 'There is currently nobody issuable for this date and meal.')}</div>
                  ) : filteredIssuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>{t('Nič sa nenašlo.', 'Nothing found.')}</div>
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
                              disabled={issueReadOnly || !ready || (Boolean(editingIssueId) && !isPlannedIssuePerson(person))}
                            />
                            <span>
                              <b>{displayIssuePersonName(person)}</b>
                              {person.email && <small>{person.email}</small>}
                            </span>
                          </label>

                          <div className="issue-person-meta" style={styles.personMeta}>
                            <span style={styles.choicePill}>{person.choice}</span>
                            <span style={ready ? styles.statusPillReady : styles.statusPillWarning}>
                              {person.issueStatusLabel || (ready ? t('Pripravené', 'Ready') : t('Nevydateľné', 'Not issuable'))}
                            </span>
                            <span style={styles.sourcePill}>{sourceLabel(person.source, language)}</span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div style={styles.issueStickyFooter}>
                  {(editingIssueId || issuePeopleConfirmed) && (
                    <div style={styles.pickupStepCard}>
                      <div style={styles.pickupStepInfo}>
                        <b>{isEnglish ? 'Allowed to pick up' : 'Oprávnení prevziať'}</b>
                        <span>
                          {pickupUserIds.length > 0
                            ? (isEnglish ? `${pickupUserIds.length} people can pick up this issue.` : `${pickupUserIds.length} osôb môže prevziať tento výdaj.`)
                            : (isEnglish ? 'No pickup person has been added yet.' : 'Zatiaľ nie je pridaná žiadna osoba na prevzatie.')}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={openPickupModal}
                        disabled={issueLoading || issueReadOnly}
                        style={{ ...styles.secondaryButton, ...styles.compactButton }}
                      >
                         {isEnglish ? 'Edit' : 'Upraviť'}
                      </button>
                    </div>
                  )}

                  {!editingIssueId && !issuePeopleConfirmed ? (
                    <button
                      type="button"
                      onClick={confirmIssuePeople}
                      disabled={issueLoading || issueReadOnly || selectedIssuablePeople.length === 0}
                      style={{ ...styles.primaryButton, width: '100%' }}
                    >
                       {isEnglish ? 'Confirm people and continue' : 'Potvrdiť osoby a pokračovať'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={saveIssue}
                      disabled={issueLoading || issueReadOnly || selectedIssuablePeople.length === 0 || pickupUserIds.length === 0}
                      style={{ ...styles.primaryButton, width: '100%' }}
                    >
                       {issueLoading ? copy.saving : (isEnglish ? 'Save group issue' : 'Uložiť skupinový výdaj')}
                    </button>
                  )}

                  {issueFeedback && (
                    <div style={issueFeedbackType === 'ok' ? styles.feedbackOkCompact : styles.feedbackErrorCompact}>
                      {issueFeedback}
                    </div>
                  )}

                  {createdIssue && (
                    <div style={{ ...styles.createdBox, ...styles.createdBoxCompact }}>
                      <b>{createdIssue.title}</b>
                      <span>
                        MASO {createdIssue.summary?.MASO || 0} / VEGE {createdIssue.summary?.VEGE || 0} / DIETA {createdIssue.summary?.DIETA || 0} / SPOLU {createdIssue.summary?.SPOLU || 0}
                      </span>
                      {createdIssue.status === 'WAITING' && <span>{t('Platnosť začne o 15 minút.', 'Validity starts in 15 minutes.')}</span>}
                    </div>
                  )}
                </div>
                </div>
                </section>
              </div>
            )}

            <aside className="group-issue-sidebar" style={styles.sidebar}>
              {!confirmed && (
              <section style={{ ...styles.panel, order: 1 }}>
                <div style={styles.panelHeaderRow}>
                  <div style={styles.panelTitle}>{t('Skupina a výdaj', 'Group and issue')}</div>
                </div>

                <div style={styles.formGrid}>
                  <div style={styles.field}>
                    <span>{t('Registračná skupina', 'Registration group')}</span>
                    <select
                      value={selectedGroupId}
                      onChange={event => selectRegistrationGroup(event.target.value)}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="">{t('Vyberte', 'Choose')}</option>
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
                        <span>{selectedGroup?.name || t('Vyberte', 'Choose')}</span>
                        <b>{groupPickerOpen ? '^' : 'v'}</b>
                      </button>

                      {groupPickerOpen && (
                        <div className="group-picker-menu" style={styles.groupPickerMenu}>
                          <input
                            type="search"
                            value={groupQuery}
                            onChange={event => setGroupQuery(event.target.value)}
                            placeholder={t('Hľadať registračnú skupinu', 'Search registration group')}
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
                      t('Vyber dátum', 'Choose date')
                    )}
                  </label>

                  <label style={{ ...styles.field, display: 'none' }}>
                    <span>{t('Zdroj ľudí', 'People source')}</span>
                    <select
                      value={sourceMode}
                      onChange={event => {
                        setSourceMode(event.target.value as IssueSourceMode)
                        resetIssueState({ clearExisting: false, preserveMeal: true })
                      }}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="REGISTRATION_GROUP">{t('Registračná skupina', 'Registration group')}</option>
                      <option value="FOOD_GROUP">{t('Stravovacia skupina', 'Meal group')}</option>
                      <option value="ONE_OFF">{t('Jednorazový výdaj cez QR', 'One-off QR issue')}</option>
                    </select>
                  </label>

                  {false && sourceMode === 'FOOD_GROUP' && (
                    <label style={{ ...styles.field, display: 'none' }}>
                      <span>{t('Stravovacia skupina', 'Meal group')}</span>
                      <select
                        value={selectedFoodGroupId}
                        onChange={event => {
                          setSelectedFoodGroupId(event.target.value)
                          resetIssueState({ clearExisting: false, preserveMeal: true })
                        }}
                        disabled={issueLoading || foodGroupsLoading}
                        style={styles.input}
                      >
                        <option value="">{t('Vyber stravovaciu skupinu', 'Choose meal group')}</option>
                        {foodGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name} ({group.memberCount})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label style={styles.field}>
                    <span>{t('Jedlo pre nový výdaj', 'Meal for new issue')}</span>
                    <select
                      value={meal}
                      onChange={event => {
                        setMeal(event.target.value as MealSelection)
                        resetIssueState({ clearExisting: false, preserveMeal: true })
                      }}
                      disabled={issueLoading}
                      style={styles.input}
                    >
                      <option value="">{t('Vyberte', 'Choose')}</option>
                      {MEAL_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {localizedMealLabel(option.value, language)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {daySelectionReady && (
                  <div className="group-issue-action-hub" style={styles.actionHub}>
                    <button
                      type="button"
                      onClick={openPrepareSourceModal}
                      disabled={issueLoading || readOnlyDate || !meal}
                      style={{
                        ...styles.actionTile,
                        ...styles.actionTilePrimary,
                        ...(issueLoading || readOnlyDate || !meal ? styles.actionTileDisabled : {})
                      }}
                    >
                      <b>{t('Pripraviť výdaj', 'Prepare issue')}</b>
                      <span>{meal ? localizedMealLabel(meal, language) : t('Vyber jedlo', 'Choose meal')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (foodGroupSetupOpen) {
                          setFoodGroupSetupOpen(false)
                        } else {
                          void openFoodGroupSetup('NEW')
                        }
                      }}
                      disabled={issueLoading || foodGroupsLoading}
                      style={{
                        ...styles.actionTile,
                        ...(foodGroupSetupOpen ? styles.actionTileActive : {})
                      }}
                    >
                      <b>{t('Stravovacie skupiny', 'Meal groups')}</b>
                      <span>{foodGroups.length} {t('skupín', 'groups')}</span>
                    </button>
                  </div>
                )}

                {selectedGroupId && foodGroupSetupOpen && (
                  <div style={styles.foodGroupSetupPanel}>
                    <div className="group-issue-setup-tabs" style={styles.foodGroupSetupTabs}>
                      {([
                        ['NEW', t('Nová', 'New')],
                        ['EDIT', t('Upraviť', 'Edit')],
                        ['DELETE', t('Vymazať', 'Delete')],
                        ['PICKUP', t('Vyzdvihovači', 'Pickup')]
                      ] as Array<[FoodGroupSetupTab, string]>).map(([tab, label]) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => void openFoodGroupSetup(tab)}
                          disabled={foodGroupsLoading || issueLoading}
                          style={{
                            ...styles.foodGroupSetupTab,
                            ...(foodGroupSetupTab === tab ? styles.foodGroupSetupTabActive : {})
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {foodGroupSetupTab === 'NEW' && (
                      <button
                        type="button"
                        onClick={() => openFoodGroupModal('')}
                        disabled={foodGroupsLoading || issueLoading}
                        style={styles.setupBigButton}
                      >
                        <b>{t('Vytvoriť novú skupinu', 'Create new group')}</b>
                        <span>{t('Ľudia aj vyzdvihovači v dvoch krokoch.', 'People and pickup users in two steps.')}</span>
                      </button>
                    )}

                    {foodGroupSetupTab !== 'NEW' && (
                      <div style={styles.setupGroupGrid}>
                        {foodGroupsLoading ? (
                          <div style={styles.emptyBox}>{t('Načítavam...', 'Loading...')}</div>
                        ) : foodGroups.length === 0 ? (
                          <div style={styles.emptyBox}>{t('Zatiaľ nie je vytvorená žiadna stravovacia skupina.', 'No meal group has been created yet.')}</div>
                        ) : (
                          foodGroups.map(group => (
                            <button
                              key={group.id}
                              type="button"
                              onClick={() => {
                                if (foodGroupSetupTab === 'EDIT') void openFoodGroupModal(group.id)
                                if (foodGroupSetupTab === 'DELETE') void deleteFoodGroup(group)
                                if (foodGroupSetupTab === 'PICKUP') void openFoodGroupPickupModal(group.id)
                              }}
                              disabled={foodGroupsLoading || issueLoading}
                              style={{
                                ...styles.setupGroupButton,
                                ...(foodGroupSetupTab === 'DELETE' ? styles.setupGroupButtonDanger : {})
                              }}
                            >
                              <b>{group.name}</b>
                              <span>
                                {foodGroupSetupTab === 'EDIT'
                                  ? t('Upraviť ľudí', 'Edit people')
                                  : foodGroupSetupTab === 'DELETE'
                                    ? t('Vymazať skupinu', 'Delete group')
                                    : t('Nastaviť vyzdvihovačov', 'Set pickup users')}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {selectedGroup?.canManageDelegates && (
                      <button
                        type="button"
                        onClick={openDelegateModal}
                        disabled={loading}
                        style={styles.setupTextButton}
                      >
                        {t('Poverené osoby registračnej skupiny', 'Registration group delegates')} ({delegates.length})
                      </button>
                    )}
                  </div>
                )}

                {false && selectedGroupId && (
                  <div style={styles.delegateSummaryCard}>
                    <div style={styles.delegateSummaryText}>
                      <b>{t('Stravovacie skupiny', 'Meal groups')}</b>
                      <span>{foodGroups.length} {t('zoznamov pre túto registračnú skupinu', 'lists for this registration group')}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => openFoodGroupModal(selectedFoodGroupId)}
                      style={styles.smallButtonWhite}
                      disabled={foodGroupsLoading}
                    >
                      {t('Spravovať', 'Manage')}
                    </button>
                  </div>
                )}

                {false && selectedGroup?.canManageDelegates && (
                  <div style={styles.delegateSummaryCard}>
                    <div style={styles.delegateSummaryText}>
                      <b>{t('Poverené osoby, ktoré môžu vytvárať hromadný výdaj', 'Delegated people who can create bulk issues')}</b>
                      <span>{delegates.length} {t('osôb', 'people')}</span>
                    </div>

                    <button
                      type="button"
                      onClick={openDelegateModal}
                      style={styles.smallButtonWhite}
                    >
                      {t('Spravovať', 'Manage')}
                    </button>
                  </div>
                )}
              </section>
              )}

              {!confirmed && daySelectionReady && (
                <section style={{ ...styles.panel, order: 3 }}>
                  <div style={styles.delegateHeader}>
                    <div>
                      <h2 style={styles.delegateTitle}>{t('Výdaje pre deň', 'Issues for the day')}</h2>
                      <p style={styles.delegateHint}>{selectedGroup?.name || '-'} / {fullDateLabel(date)}</p>
                    </div>
                    <span style={styles.countBadge}>{existingIssues.length}</span>
                  </div>

                  {readOnlyDate && (
                    <div style={styles.readOnlyNotice}>
                      {t('Starší dátum je iba na prezeranie. Existujúce výdaje môžeš otvoriť, ale nie upravovať.', 'Older dates are read-only. You can open existing issues, but not edit them.')}
                    </div>
                  )}

                  {existingLoading ? (
                    <div style={styles.emptyBox}>{t('Načítavam existujúce výdaje...', 'Loading existing issues...')}</div>
                  ) : existingIssues.length === 0 ? (
                    <div style={styles.emptyBox}>{t('Pre tento deň zatiaľ nie je vytvorený žiadny výdaj.', 'No issue has been created for this day yet.')}</div>
                  ) : (
                    <div style={styles.existingIssuesList}>
                      {existingIssues.map(issue => {
                        const issueWaitingInfo = issue.status === 'WAITING'
                          ? waitingInfo(issue.validAfter, nowMs)
                          : null
                        const fullyIssuedIssue = (issue.summary?.SPOLU || 0) === 0
                        const isReadOnlyIssue = readOnlyDate || fullyIssuedIssue
                        const canChangeIssue = canEditExistingIssues && !isReadOnlyIssue

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
                                {fullyIssuedIssue && <span style={styles.issuedInlineStatus}> - {t('vydané', 'issued')}</span>}
                              </b>
                              <small>
                                <span style={styles.mealBadge}>{localizedMealLabel(issue.meal, language)}</span>
                                MASO {issue.summary?.MASO || 0} / VEGE {issue.summary?.VEGE || 0} / DIETA {issue.summary?.DIETA || 0} / SPOLU {issue.summary?.SPOLU || 0}
                              </small>
                              {issueWaitingInfo && (
                                <span style={styles.waitingInline}>
                                  {issueWaitingInfo.active
                                    ? `${t('Začne platiť o', 'Starts in')} ${issueWaitingInfo.countdown}`
                                    : t('Platnosť je aktívna', 'Validity is active')}
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
                                title={canChangeIssue ? t('Zmeniť výdaj', 'Edit issue') : t('Pozrieť výdaj', 'View issue')}
                              >
                                {canChangeIssue ? 'Z' : 'i'}
                              </button>
                              {!isReadOnlyIssue && (
                                <button
                                  type="button"
                                  onClick={() => cancelExistingIssue(issue)}
                                  disabled={issueLoading}
                                  style={styles.smallRemoveButton}
                                  title={t('Zrušiť výdaj', 'Cancel issue')}
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

                  <div style={{ ...styles.prepareActions, display: 'none' }}>
                    <label style={{ ...styles.field, display: 'none' }}>
                      <span>{t('Zdroj ľudí', 'People source')}</span>
                      <select
                        value={sourceMode}
                        onChange={event => {
                          setSourceMode(event.target.value as IssueSourceMode)
                          resetIssueState({ clearExisting: false, preserveMeal: true })
                        }}
                        disabled={issueLoading || readOnlyDate}
                        style={styles.input}
                      >
                        <option value="REGISTRATION_GROUP">{t('Registračná skupina', 'Registration group')}</option>
                        <option value="FOOD_GROUP">{t('Stravovacia skupina', 'Meal group')}</option>
                        <option value="ONE_OFF">{t('Jednorazový výdaj cez QR', 'One-off QR issue')}</option>
                      </select>
                    </label>

                    {false && sourceMode === 'FOOD_GROUP' && (
                      <div style={styles.prepareFoodGroupRow}>
                        <label style={{ ...styles.field, flex: 1 }}>
                          <span>{t('Stravovacia skupina', 'Meal group')}</span>
                          <select
                            value={selectedFoodGroupId}
                            onChange={event => {
                              setSelectedFoodGroupId(event.target.value)
                              resetIssueState({ clearExisting: false, preserveMeal: true })
                            }}
                            disabled={issueLoading || readOnlyDate || foodGroupsLoading}
                            style={styles.input}
                          >
                            <option value="">{t('Vyber stravovaciu skupinu', 'Choose meal group')}</option>
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
                          {t('Spravovať', 'Manage')}
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={openPrepareSourceModal}
                      disabled={issueLoading || readOnlyDate || !meal}
                      style={{ ...styles.primaryButton, alignSelf: 'end', width: '100%' }}
                    >
                      {issueLoading
                        ? t('Načítavam...', 'Loading...')
                        : readOnlyDate
                          ? t('Starší dátum je iba na prezeranie', 'Older date is read-only')
                          : false
                            ? t('Vyber stravovaciu skupinu', 'Choose meal group')
                            : meal ? t('Pripraviť nový výdaj', 'Prepare new issue') : t('Vyber jedlo pre nový výdaj', 'Choose meal for new issue')}
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

        {prepareSourceModalOpen && selectedGroup && (
          <div style={styles.modalOverlay} onClick={() => !issueLoading && setPrepareSourceModalOpen(false)}>
            <div style={styles.sourceModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>{isEnglish ? 'Choose people source' : 'Vyber zdroj osôb'}</b>
                  <span>{selectedGroup.name} / {localizedMealLabel(meal, language)} / {fullDateLabel(date)}</span>
                </div>

                <div style={styles.modalHeaderActions}>
                  {prepareSourceStep === 'DETAIL' && (
                    <button
                      type="button"
                      onClick={() => setPrepareSourceStep('SOURCE')}
                      style={styles.iconBackButton}
                      title={copy.back}
                      aria-label={copy.back}
                      disabled={issueLoading}
                    >
                      ←
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setPrepareSourceModalOpen(false)}
                    style={styles.qrCloseButton}
                    disabled={issueLoading}
                    title={isEnglish ? 'Close' : 'Zatvoriť'}
                    aria-label={isEnglish ? 'Close' : 'Zatvoriť'}
                  >
                    x
                  </button>
                </div>
              </div>

              {prepareSourceStep === 'SOURCE' && (
              <div style={styles.sourceChoiceGrid}>
                <button
                  type="button"
                  onClick={() => selectSourceMode('FOOD_GROUP', 'DETAIL')}
                  style={{
                    ...styles.sourceChoiceButton,
                    ...(sourceMode === 'FOOD_GROUP' ? styles.sourceChoiceButtonActive : {})
                  }}
                  disabled={issueLoading}
                >
                  <b>{isEnglish ? 'Meal groups' : 'Stravovacie skupiny'}</b>
                  <span>{isEnglish ? 'Saved custom lists' : 'Uložené vlastné zoznamy'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => selectSourceMode('ONE_OFF')}
                  style={{
                    ...styles.sourceChoiceButton,
                    ...(sourceMode === 'ONE_OFF' ? styles.sourceChoiceButtonActive : {})
                  }}
                  disabled={issueLoading}
                >
                  <b>{isEnglish ? 'QR group' : 'Skupina QR'}</b>
                  <span>{t('Vytvoríš skenovaním', 'Create by scanning')}</span>
                </button>
              </div>
              )}

              {prepareSourceStep === 'DETAIL' && sourceMode === 'FOOD_GROUP' && (
                <div style={styles.sourceFoodGroupBox}>
                  <div style={styles.issueSourceHeader}>
                    <div>
                      <b>{t('Stravovacie skupiny', 'Meal groups')}</b>
                      <div style={styles.emptyInlineText}>
                        {t(
                          'Vyber skupinu pre tento výdaj. Členov aj oprávnených prevziať upravíš cez tlačidlo Upraviť.',
                          'Choose a meal group for this issue. Edit members and pickup permissions with the Edit button.'
                        )}
                      </div>
                    </div>
                    <div style={styles.modalHeaderActions}>
                      <button
                        type="button"
                        onClick={() => openFoodGroupModal('')}
                        style={styles.smallButtonWhite}
                        disabled={foodGroupsLoading || issueLoading}
                      >
                        {t('Nová', 'New')}
                      </button>
                      {selectedFoodGroupId && (
                      <button
                        type="button"
                        onClick={() => openFoodGroupModal(selectedFoodGroupId)}
                        style={styles.smallButtonWhite}
                        disabled={foodGroupsLoading || issueLoading}
                      >
                        {t('Upraviť', 'Edit')}
                      </button>
                      )}
                    </div>
                  </div>

                  {foodGroupsLoading && <div style={styles.emptyBox}>{t('Načítavam stravovacie skupiny...', 'Loading meal groups...')}</div>}

                  {!foodGroupsLoading && foodGroups.length === 0 ? (
                    <div style={styles.emptyBox}>{t('Zatiaľ nie je vytvorená žiadna stravovacia skupina.', 'No meal group has been created yet.')}</div>
                  ) : (
                    <div style={styles.foodGroupCardGrid}>
                      {foodGroups.map(group => {
                        const selected = selectedFoodGroupId === group.id

                        return (
                          <div
                            key={group.id}
                            style={{
                              ...styles.foodGroupCard,
                              ...(selected ? styles.foodGroupCardActive : {})
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFoodGroupId(group.id)
                                setFoodGroupMessage('')
                              }}
                              style={styles.foodGroupCardMain}
                              disabled={issueLoading || foodGroupsLoading}
                            >
                              <b>{group.name}</b>
                              <span>{group.memberCount} {t('osôb', 'people')}</span>
                            </button>

                            <div style={styles.foodGroupCardActions}>
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation()
                                  void deleteFoodGroup(group)
                                }}
                                style={styles.smallRemoveButton}
                                disabled={foodGroupsLoading || issueLoading}
                                title={t('Zrušiť skupinu', 'Delete group')}
                                aria-label={t('Zrušiť skupinu', 'Delete group')}
                              >
                                x
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {foodGroupMessage && (
                    <div style={foodGroupMessageType === 'ok' ? styles.feedbackOkCompact : styles.feedbackErrorCompact}>
                      {foodGroupMessage}
                    </div>
                  )}
                </div>
              )}

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={continuePrepareFromSourceModal}
                  disabled={issueLoading || (sourceMode === 'FOOD_GROUP' && prepareSourceStep === 'DETAIL' && !selectedFoodGroupId)}
                  style={styles.primaryButton}
                >
                  {issueLoading
                    ? t('Načítavam...', 'Loading...')
                    : sourceMode === 'FOOD_GROUP' && prepareSourceStep === 'DETAIL'
                      ? t('Príprava výdaja', 'Prepare issue')
                      : t('Pokračovať', 'Continue')}
                </button>
              </div>
            </div>
          </div>
        )}

        {qrModalOpen && (
          <div style={styles.modalOverlay} onClick={() => setQrModalOpen(false)}>
            <div style={styles.qrModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>{t('Pridať cez QR', 'Add by QR')}</b>
                  <span>{t('Skenujte QR kódy postupne. Osoby sa budú pridávať do pripravovaného výdaja.', 'Scan QR codes one by one. People will be added to the prepared issue.')}</span>
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
                  <b>{t('Presunúť označených', 'Move selected')}</b>
                  <span>{selectedMovableIssuePeople.length} {t('osôb', 'people')} / {localizedMealLabel(meal, language)} / {fullDateLabel(date)}</span>
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
                    <b>{t('Cieľový výdaj', 'Target issue')}</b>
                    <span>{moveTargetIssues.length} {t('možností', 'options')}</span>
                  </div>

                  {moveTargetIssues.length === 0 ? (
                    <div style={styles.emptyBox}>{t('Pre tento dátum a jedlo neexistuje iný skupinový výdaj.', 'There is no other group issue for this date and meal.')}</div>
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
                  {issueLoading ? t('Presúvam...', 'Moving...') : `${t('Presunúť', 'Move')} (${selectedMovableIssuePeople.length})`}
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
                  <b>{t('Stravovacia skupina', 'Meal group')}</b>
                  <span>
                    {foodGroupModalPickupStep
                      ? t('Oprávnení prevziať', 'Allowed to pick up')
                      : foodGroupEditId ? foodGroupName : selectedGroup.name}
                  </span>
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
                  {!foodGroupEditId && (
                    <label style={styles.field}>
                      <span style={styles.label}>{t('Názov skupiny', 'Group name')}</span>
                      <input
                        type="text"
                        value={foodGroupName}
                        onChange={event => setFoodGroupName(event.target.value)}
                        placeholder={t('Napr. Amazonky menší tím', 'E.g. Amazonky smaller team')}
                        style={styles.input}
                        disabled={foodGroupsLoading}
                      />
                    </label>
                  )}

                  {foodGroupModalMembersStep ? (
                    <>
                  <div style={{ ...styles.segment, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                    <button
                      type="button"
                      onClick={() => switchFoodGroupMemberMode('group')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupMemberGroupMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      {t('Zo skupiny', 'From group')}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchFoodGroupMemberMode('outside')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupMemberOutsideMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      {t('Mimo skupiny', 'Outside group')}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchFoodGroupMemberMode('qr')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupMemberQrMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      QR
                    </button>
                  </div>

                  {(foodGroupMemberGroupMode || foodGroupMemberOutsideMode) && (
                  <label style={styles.field}>
                    <span style={styles.label}>
                      {foodGroupMemberOutsideMode ? t('Vyhľadať mimo skupiny', 'Search outside group') : t('Vyhľadať v skupine', 'Search in group')}
                    </span>
                    <input
                      type="search"
                      value={foodGroupSearchQuery}
                      onChange={event => searchFoodGroupMembers(event.target.value, foodGroupMemberOutsideMode ? 'outside' : 'group')}
                      placeholder={foodGroupMemberOutsideMode ? t('Zadaj aspoň 3 znaky mimo skupiny', 'Enter at least 3 characters outside the group') : t('Hľadaj v aktuálnej skupine', 'Search in the current group')}
                      style={styles.input}
                      disabled={!selectedGroupId}
                    />
                  </label>
                  )}

                  {foodGroupsLoading && <div style={styles.emptyBox}>{t('Načítavam...', 'Loading...')}</div>}

                  <div style={styles.toolbarLeft}>
                    <button
                      type="button"
                      onClick={selectAllFoodGroupMembers}
                      disabled={foodGroupsLoading || foodGroupCandidateUsers.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Označiť všetko', 'Select all')}
                    </button>
                    <button
                      type="button"
                      onClick={clearFoodGroupMembers}
                      disabled={foodGroupsLoading || foodGroupMemberIds.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Odznačiť všetko', 'Clear all')}
                    </button>
                  </div>

                  {foodGroupMemberQrMode && (
                    <QrCameraScanner
                      disabled={foodGroupsLoading || !selectedGroupId}
                      onScan={addFoodGroupMemberByQr}
                    />
                  )}

                  <div style={styles.searchResults}>
                    {foodGroupCandidateUsers.length === 0 ? (
                      <div style={styles.emptyBox}>{t('Vyhľadaj osobu alebo uprav existujúcu skupinu.', 'Search for a person or edit an existing group.')}</div>
                    ) : (
                      foodGroupCandidateUsers.map(user => {
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
                              <small>
                                {selected ? t('V skupine', 'In group') : t('Kliknutím označíš', 'Click to select')}
                                {user.foodChoice ? ` · ${user.foodChoice}` : ''}
                              </small>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                    </>
                  ) : (
                    <>
                  <div style={styles.pickupStepCard}>
                    <div style={styles.pickupStepInfo}>
                      <b>{t('Oprávnení prevziať', 'Allowed to pick up')}</b>
                      <span>{foodGroupPickupUserIds.length} {t('označených', 'selected')} / {foodGroupPickupCandidateUsers.length} {t('v zozname', 'listed')}</span>
                    </div>
                  </div>

                  <div style={{ ...styles.segment, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                    <button
                      type="button"
                      onClick={() => switchFoodGroupPickupMode('group')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupPickupGroupMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      {t('Zo skupiny', 'From group')}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchFoodGroupPickupMode('outside')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupPickupOutsideMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      {t('Mimo skupiny', 'Outside group')}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchFoodGroupPickupMode('qr')}
                      style={{
                        ...styles.segmentButton,
                        ...(foodGroupPickupQrMode ? styles.segmentButtonActive : {})
                      }}
                    >
                      QR
                    </button>
                  </div>

                  {(foodGroupPickupGroupMode || foodGroupPickupOutsideMode) && (
                    <label style={styles.field}>
                      <span style={styles.label}>
                        {foodGroupPickupOutsideMode ? t('Vyhľadať mimo skupiny', 'Search outside group') : t('Vyhľadať v skupine', 'Search in group')}
                      </span>
                      <input
                        type="search"
                        value={foodGroupPickupQuery}
                        onChange={event => searchFoodGroupPickupUsers(event.target.value, foodGroupPickupOutsideMode ? 'outside' : 'group')}
                        placeholder={foodGroupPickupOutsideMode ? t('Zadaj aspoň 3 znaky mimo skupiny', 'Enter at least 3 characters outside the group') : t('Hľadaj v aktuálnej skupine', 'Search in the current group')}
                        style={styles.input}
                        disabled={!selectedGroupId}
                      />
                    </label>
                  )}

                  {foodGroupPickupLoading && <div style={styles.emptyBox}>{t('Načítavam...', 'Loading...')}</div>}

                  <div style={styles.toolbarLeft}>
                    <button
                      type="button"
                      onClick={selectAllFoodGroupPickupUsers}
                      disabled={foodGroupPickupLoading || foodGroupPickupCandidateUsers.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Označiť všetko', 'Select all')}
                    </button>
                    <button
                      type="button"
                      onClick={clearFoodGroupPickupUsers}
                      disabled={foodGroupPickupLoading || foodGroupPickupUserIds.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Odznačiť všetko', 'Clear all')}
                    </button>
                  </div>

                  {foodGroupPickupQrMode && (
                    <QrCameraScanner
                      disabled={foodGroupPickupLoading || !selectedGroupId}
                      onScan={addFoodGroupPickupUserByQr}
                    />
                  )}

                  <div style={styles.searchResults}>
                    {foodGroupPickupCandidateUsers.length === 0 ? (
                      <div style={styles.emptyBox}>
                        {foodGroupPickupQrMode
                          ? t('Naskenuj QR osoby, ktorú chceš pridať medzi oprávnených prevziať.', 'Scan the QR code of the person you want to allow for pickup.')
                          : foodGroupPickupOutsideMode
                            ? t('Pre vyhľadávanie mimo skupiny zadaj aspoň 3 znaky.', 'Enter at least 3 characters to search outside the group.')
                            : t('V tejto registračnej skupine nie je nikto na výber.', 'There is nobody to choose from in this registration group.')}
                      </div>
                    ) : (
                      foodGroupPickupCandidateUsers.map(user => {
                        const selected = foodGroupPickupUserIds.includes(user.id)

                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleFoodGroupPickupUser(user)}
                            disabled={foodGroupPickupLoading}
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
                              <small>{selected ? t('Oprávnený prevziať', 'Allowed to pick up') : t('Kliknutím označíš', 'Click to select')}</small>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                    </>
                  )}
                </div>
              </div>

              <div style={styles.modalFooter}>
                {foodGroupMessage && (
                  <div style={foodGroupMessageType === 'ok' ? styles.feedbackOkCompact : styles.feedbackErrorCompact}>
                    {foodGroupMessage}
                  </div>
                )}
                {foodGroupModalMembersStep ? (
                  <button
                    type="button"
                    onClick={continueFoodGroupModal}
                    disabled={foodGroupsLoading}
                    style={styles.primaryButton}
                  >
                    {t('Ďalej', 'Next')}
                  </button>
                ) : (
                  <div style={styles.modalFooterActions}>
                    <button
                      type="button"
                      onClick={() => setFoodGroupModalStep('MEMBERS')}
                      disabled={foodGroupsLoading || foodGroupPickupLoading}
                      style={styles.secondaryButton}
                    >
                      {copy.back}
                    </button>
                    <button
                      type="button"
                      onClick={saveFoodGroup}
                      disabled={foodGroupsLoading || foodGroupPickupLoading || !foodGroupName.trim()}
                      style={styles.primaryButton}
                    >
                      {foodGroupsLoading ? copy.saving : `${t('Uložiť skupinu', 'Save group')} (${foodGroupMemberIds.length})`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {delegatesPanelOpen && selectedGroup && (
          <div style={styles.modalOverlay} onClick={closeDelegateModal}>
            <div style={styles.peopleModal} onClick={event => event.stopPropagation()}>
              <div style={styles.qrModalHeader}>
                <div style={styles.modalTitleBlock}>
                  <b>{t('Správa poverených osôb', 'Delegated people management')}</b>
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
                  <div style={styles.infoBox}>{t('Túto časť môže meniť iba manager registračnej skupiny.', 'Only a registration group manager can edit this section.')}</div>
                </div>
              ) : (
                <>
                  <div style={styles.modalScrollBody}>
                    <div style={styles.searchBox}>
                    <div style={styles.peopleSectionHeader}>
                      <b>{t('Poverené osoby', 'Delegated people')}</b>
                      <span>{pendingDelegateUserIds.length} {t('označených', 'selected')} / {delegateCandidates.length} {t('v zozname', 'listed')}</span>
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
                          {t('Zo skupiny', 'From group')}
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
                          {t('Mimo skupiny', 'Outside group')}
                        </button>
                      </div>
                    )}

                    <label style={styles.field}>
                      <span style={styles.label}>
                        {delegateSearchAll ? t('Vyhľadať mimo registračnej skupiny', 'Search outside registration group') : t('Vyhľadať v registračnej skupine', 'Search in registration group')}
                      </span>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={event => searchUsers(event.target.value)}
                        placeholder={delegateSearchAll ? t('Zadaj aspoň 3 znaky mimo skupiny', 'Enter at least 3 characters outside the group') : t('Zoznam skupiny alebo hľadaj od 3 znakov', 'Group list or search from 3 characters')}
                        style={styles.input}
                      />
                    </label>

                    <label style={styles.field}>
                      <span style={styles.label}>{t('Poznámka', 'Note')}</span>
                      <input
                        type="text"
                        value={delegateNote}
                        onChange={event => setDelegateNote(event.target.value)}
                        placeholder={t('Voliteľné', 'Optional')}
                        style={styles.input}
                      />
                    </label>

                    {loading && <div style={styles.emptyBox}>{t('Načítavam...', 'Loading...')}</div>}

                    <div style={styles.searchResults}>
                      {!delegateListReady ? (
                        <div style={styles.emptyBox}>{t('Načítavam osoby zo skupiny...', 'Loading people from the group...')}</div>
                      ) : delegateCandidates.length === 0 ? (
                        <div style={styles.emptyBox}>
                          {delegateSearchAll
                            ? t('Pre vyhľadávanie mimo skupiny zadaj aspoň 3 znaky.', 'Enter at least 3 characters to search outside the group.')
                            : t('V skupine nie je nikto ďalší na pridanie.', 'There is nobody else to add in the group.')}
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
                                    ? selected ? t('Už označený', 'Already selected') : t('Kliknutím pridáš', 'Click to add')
                                    : changed
                                      ? selected ? t('Bude pridaný po uložení', 'Will be added after saving') : t('Bude odobratý po uložení', 'Will be removed after saving')
                                      : selected ? t('Poverený', 'Delegated') : t('Kliknutím označíš', 'Click to select')}
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
                      {loading ? copy.saving : `${t('Uložiť zmeny', 'Save changes')} (${pendingDelegateUserIds.length})`}
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
                  <b>{t('Oprávnení prevziať', 'Allowed to pick up')}</b>
                  <span>{t('Osoby, ktoré môžu prevziať tento skupinový výdaj.', 'People who can pick up this group issue.')}</span>
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
                    <b>{t('Oprávnení prevziať', 'Allowed to pick up')}</b>
                    <span>{pendingPickupUserIds.length} {t('označených', 'selected')} / {pickupCandidateUsers.length} {t('v zozname', 'listed')}</span>
                  </div>

                  <div
                    style={{
                      ...styles.segment,
                      gridTemplateColumns: selectedGroup?.canSearchAllDelegates ? 'repeat(4, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))'
                    }}
                  >
                      <button
                        type="button"
                        onClick={() => {
                          switchPickupMode('selected')
                        }}
                        style={{
                          ...styles.segmentButton,
                          ...(pickupMode === 'selected' ? styles.segmentButtonActive : {})
                        }}
                      >
                        {t('Vybratí', 'Selected')}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          switchPickupMode('group')
                        }}
                        style={{
                          ...styles.segmentButton,
                          ...(pickupMode === 'group' ? styles.segmentButtonActive : {})
                        }}
                      >
                        {t('Zo skupiny', 'From group')}
                      </button>

                      {selectedGroup?.canSearchAllDelegates && (
                        <button
                          type="button"
                          onClick={() => {
                            switchPickupMode('outside')
                          }}
                          style={{
                            ...styles.segmentButton,
                            ...(pickupMode === 'outside' ? styles.segmentButtonActive : {})
                          }}
                        >
                          {t('Mimo skupiny', 'Outside group')}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          switchPickupMode('qr')
                        }}
                        style={{
                          ...styles.segmentButton,
                          ...(pickupMode === 'qr' ? styles.segmentButtonActive : {})
                        }}
                      >
                        QR
                      </button>
                    </div>

                  {(pickupGroupMode || pickupSearchOutside) && (
                    <label style={styles.field}>
                      <span style={styles.label}>
                        {pickupSearchOutside ? t('Vyhľadať mimo skupiny', 'Search outside group') : t('Vyhľadať v skupine', 'Search in group')}
                      </span>
                      <input
                        type="search"
                        value={pickupQuery}
                        onChange={event => searchPickupUsers(event.target.value, pickupSearchOutside ? 'outside' : 'group')}
                        placeholder={pickupSearchOutside ? t('Zadaj aspoň 3 znaky mimo skupiny', 'Enter at least 3 characters outside the group') : t('Zadaj aspoň 3 znaky v skupine', 'Enter at least 3 characters in the group')}
                        style={styles.input}
                        disabled={issueLoading}
                      />
                    </label>
                  )}

                  {pickupQrMode && (
                    <QrCameraScanner
                      disabled={issueLoading || issueReadOnly || !selectedGroupId}
                      onScan={addPickupUserByQr}
                    />
                  )}

                  {pickupLoading && <div style={styles.emptyBox}>{t('Vyhľadávam...', 'Searching...')}</div>}

                  <div style={styles.toolbarLeft}>
                    <button
                      type="button"
                      onClick={selectAllPickupCandidates}
                      disabled={issueLoading || issueReadOnly || pickupCandidateUsers.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Označiť všetko', 'Select all')}
                    </button>
                    <button
                      type="button"
                      onClick={clearPickupCandidates}
                      disabled={issueLoading || issueReadOnly || pendingPickupUserIds.length === 0}
                      style={styles.bulkButton}
                    >
                      {t('Odznačiť všetko', 'Clear all')}
                    </button>
                  </div>

                  <div style={styles.searchResults}>
                    {pickupCandidateUsers.length === 0 ? (
                      <div style={styles.emptyBox}>
                        {pickupQrMode
                          ? t('Naskenuj QR osoby, ktorú chceš pridať medzi oprávnených prevziať.', 'Scan the QR code of the person you want to allow for pickup.')
                          : pickupSearchOutside
                            ? t('Pre vyhľadávanie mimo skupiny zadaj aspoň 3 znaky.', 'Enter at least 3 characters to search outside the group.')
                            : pickupGroupMode
                              ? sourceMode === 'REGISTRATION_GROUP'
                                ? t('Zadaj aspoň 3 znaky a vyhľadaj osobu v skupine.', 'Enter at least 3 characters and search for a person in the group.')
                                : t('V tejto skupine nie je nikto na výber.', 'There is nobody to choose from in this group.')
                              : t('Najprv označ osoby vo výdaji.', 'Select people in the issue first.')}
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
                            onClick={() => togglePendingPickupUser(user, pickupSearchOutside || pickupQrMode ? 'outside' : 'group')}
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
                                {pickupQrMode
                                  ? selected ? t('Označený cez QR', 'Selected by QR') : t('Kliknutím označíš', 'Click to select')
                                  : pickupSearchOutside
                                  ? selected ? t('Už označený', 'Already selected') : t('Kliknutím pridáš', 'Click to add')
                                  : pickupSelectedMode
                                    ? selected ? t('Oprávnený', 'Allowed') : t('Z osôb vo výdaji', 'From issue people')
                                  : changed
                                    ? selected ? t('Bude pridaný po uložení', 'Will be added after saving') : t('Bude odobratý po uložení', 'Will be removed after saving')
                                    : selected ? t('Oprávnený', 'Allowed') : t('Zo skupiny', 'From group')}
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
                    ? copy.saving
                    : editingIssueId
                      ? `${t('Uložiť zmeny', 'Save changes')} (${pendingPickupUserIds.length})`
                      : `${t('Potvrdiť prevzatie', 'Confirm pickup')} (${pendingPickupUserIds.length})`}
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
    border: '1px solid #ddd6fe',
    borderRadius: 10,
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    boxShadow: 'inset 4px 0 0 #7c3aed, 0 6px 18px rgba(76, 29, 149, 0.06)'
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 950,
    color: '#4c1d95'
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
    background: '#fff',
    color: '#4c1d95',
    border: '1px solid #ddd6fe',
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
    border: '1px solid #ddd6fe',
    borderRadius: 10,
    padding: 12,
    boxShadow: '0 8px 22px rgba(76, 29, 149, 0.06)'
  },
  mainPanel: {
    minWidth: 0,
    background: '#fff',
    border: '1px solid #ddd6fe',
    borderRadius: 10,
    padding: 12,
    boxShadow: '0 8px 22px rgba(76, 29, 149, 0.06)',
    order: 4
  },
  issueEditorModal: {
    width: '100%',
    maxWidth: 900,
    maxHeight: '100%',
    overflow: 'hidden',
    minWidth: 0,
    background: '#fff',
    borderRadius: 18,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'flex',
    flexDirection: 'column'
  },
  prepHeading: {
    background: '#fff',
    padding: '14px 14px 10px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    borderBottom: '1px solid #e5e7eb',
    color: '#111827',
    fontSize: 13,
    fontWeight: 900,
    flex: '0 0 auto'
  },
  prepHeadingInfo: {
    display: 'grid',
    gap: 4,
    minWidth: 0
  },
  issueTitleCompact: {
    display: 'inline-grid',
    gridTemplateColumns: 'minmax(0, auto) 26px',
    alignItems: 'center',
    gap: 6,
    width: 'fit-content',
    maxWidth: '100%',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    background: '#f9fafb',
    color: '#374151',
    padding: '3px 4px 3px 9px',
    fontSize: 11,
    fontWeight: 900
  },
  issueTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    minWidth: 0
  },
  issueTitleLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: 900
  },
  compactTitleInput: {
    width: 170,
    maxWidth: '48vw',
    minWidth: 0,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: '#111827',
    fontSize: 11,
    fontWeight: 900
  },
  issueEditorBody: {
    padding: '8px 14px 14px 14px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0
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
  actionHub: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    marginTop: 12
  },
  actionTile: {
    minHeight: 82,
    border: '1px solid #d8b4fe',
    borderRadius: 8,
    background: '#fff',
    color: '#4c1d95',
    padding: 12,
    display: 'grid',
    alignContent: 'center',
    gap: 4,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 900,
    boxShadow: '0 8px 18px rgba(76, 29, 149, 0.08)'
  },
  actionTilePrimary: {
    background: '#6d28d9',
    borderColor: '#6d28d9',
    color: '#fff',
    boxShadow: '0 12px 24px rgba(109, 40, 217, 0.22)'
  },
  actionTileActive: {
    background: '#f5f3ff',
    borderColor: '#7c3aed',
    boxShadow: 'inset 0 0 0 1px #7c3aed, 0 10px 20px rgba(76, 29, 149, 0.12)'
  },
  actionTileDisabled: {
    background: '#ede9fe',
    borderColor: '#ddd6fe',
    color: '#6b7280',
    boxShadow: 'none'
  },
  foodGroupSetupPanel: {
    marginTop: 10,
    border: '1px solid #ddd6fe',
    borderRadius: 8,
    background: '#faf7ff',
    padding: 9,
    display: 'grid',
    gap: 9
  },
  foodGroupSetupTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 5
  },
  foodGroupSetupTab: {
    minHeight: 38,
    border: '1px solid #ddd6fe',
    borderRadius: 7,
    background: '#fff',
    color: '#4c1d95',
    padding: '0 6px',
    fontSize: 11,
    fontWeight: 950
  },
  foodGroupSetupTabActive: {
    background: '#4c1d95',
    borderColor: '#4c1d95',
    color: '#fff'
  },
  setupBigButton: {
    minHeight: 70,
    border: '1px solid #7c3aed',
    borderRadius: 8,
    background: '#fff',
    color: '#111827',
    padding: 12,
    display: 'grid',
    alignContent: 'center',
    gap: 4,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 900
  },
  setupGroupGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(136px, 1fr))',
    gap: 7,
    maxHeight: 240,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain'
  },
  setupGroupButton: {
    minHeight: 60,
    border: '1px solid #ddd6fe',
    borderRadius: 8,
    background: '#fff',
    color: '#111827',
    padding: 10,
    display: 'grid',
    alignContent: 'center',
    gap: 3,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 900
  },
  setupGroupButtonDanger: {
    borderColor: '#fecaca',
    background: '#fff7f7',
    color: '#991b1b'
  },
  setupTextButton: {
    minHeight: 36,
    border: '1px solid #e5e7eb',
    borderRadius: 7,
    background: '#fff',
    color: '#374151',
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 900,
    textAlign: 'left'
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
    color: '#111827',
    cursor: 'pointer',
    appearance: 'auto',
    WebkitAppearance: 'menulist'
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
    color: '#6d28d9',
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
  modalFooterActions: {
    display: 'grid',
    gridTemplateColumns: 'minmax(90px, 0.35fr) minmax(0, 1fr)',
    gap: 8
  },
  primaryButton: {
    minHeight: 40,
    background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)',
    color: '#fff',
    border: '1px solid #6d28d9',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 950,
    boxShadow: '0 8px 18px rgba(109, 40, 217, 0.18)'
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
  secondaryButtonActive: {
    borderColor: '#7c3aed',
    background: '#ede9fe',
    color: '#4c1d95',
    boxShadow: 'inset 0 0 0 1px #7c3aed'
  },
  compactButton: {
    minHeight: 30,
    borderRadius: 6,
    padding: '0 9px',
    fontSize: 11,
    fontWeight: 950
  },
  compactDarkButton: {
    minHeight: 30,
    background: '#4c1d95',
    color: '#fff',
    border: '1px solid #4c1d95',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 11,
    fontWeight: 950
  },
  compactIconButton: {
    width: 24,
    height: 24,
    borderRadius: 999,
    border: '1px solid #ddd6fe',
    background: '#fff',
    color: '#4c1d95',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1
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
    gap: 6,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    flex: '0 0 auto'
  },
  toolbarLeft: {
    display: 'flex',
    flex: '1 1 auto',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0
  },
  toolbarRight: {
    display: 'flex',
    flex: '0 0 auto',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginLeft: 'auto'
  },
  qrOnlyToolbar: {
    display: 'grid',
    width: '100%',
    flex: '1 1 100%'
  },
  pickupStepCard: {
    border: '1px solid #c4b5fd',
    borderRadius: 8,
    background: '#f5f3ff',
    padding: 7,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  issueStickyFooter: {
    position: 'relative',
    zIndex: 3,
    margin: '8px -14px -14px -14px',
    padding: '7px 14px max(7px, env(safe-area-inset-bottom)) 14px',
    display: 'grid',
    gap: 5,
    borderTop: '1px solid #e5e7eb',
    background: '#fff',
    boxShadow: '0 -10px 22px rgba(17, 24, 39, 0.08)'
  },
  pickupStepInfo: {
    display: 'grid',
    gap: 1,
    minWidth: 0,
    color: '#1e3a8a',
    fontSize: 11,
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
    marginTop: 5,
    maxHeight: 'none',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain',
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
    marginTop: 6,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    color: '#374151',
    fontSize: 12,
    fontWeight: 900,
    flex: '0 0 auto'
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
  createdBoxCompact: {
    marginTop: 0,
    padding: 8,
    gap: 3,
    fontSize: 11
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
    background: '#4c1d95',
    color: '#fff',
    border: '1px solid #6d28d9',
    borderRadius: 8,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 900,
    boxShadow: '0 6px 14px rgba(76, 29, 149, 0.16)'
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
    background: 'rgba(17, 24, 39, 0.68)',
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
  sourceModal: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '100%',
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: '#fff',
    borderRadius: 18,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'grid',
    gap: 12
  },
  sourceChoiceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
    padding: '0 14px'
  },
  sourceChoiceButton: {
    minHeight: 78,
    display: 'grid',
    alignContent: 'center',
    justifyItems: 'center',
    gap: 5,
    textAlign: 'center',
    border: '1px solid #c4b5fd',
    borderRadius: 12,
    background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 58%, #8b5cf6 100%)',
    color: '#fff',
    padding: 12,
    fontSize: 12,
    fontWeight: 850,
    boxShadow: '0 10px 24px rgba(109, 40, 217, 0.22)'
  },
  sourceChoiceButtonActive: {
    borderColor: '#facc15',
    background: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 55%, #7c3aed 100%)',
    boxShadow: 'inset 0 0 0 2px rgba(250, 204, 21, 0.9), 0 14px 28px rgba(76, 29, 149, 0.28)'
  },
  sourceFoodGroupBox: {
    margin: '0 14px',
    display: 'grid',
    gap: 10,
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    background: '#faf7ff',
    padding: 12,
    boxShadow: 'inset 4px 0 0 #7c3aed'
  },
  issueSourcePanel: {
    display: 'grid',
    gap: 10,
    border: '1px solid #ddd6fe',
    borderRadius: 10,
    background: '#faf7ff',
    padding: 10,
    boxShadow: 'inset 4px 0 0 #7c3aed'
  },
  issueSourceHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
    color: '#111827',
    fontSize: 13,
    fontWeight: 900
  },
  foodGroupButtonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8,
    maxHeight: 150,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain'
  },
  foodGroupChoiceButton: {
    minHeight: 46,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    color: '#111827',
    padding: '8px 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 850
  },
  foodGroupChoiceButtonActive: {
    borderColor: '#7c3aed',
    background: '#ede9fe',
    color: '#4c1d95',
    boxShadow: 'inset 0 0 0 1px #7c3aed'
  },
  foodGroupCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 9,
    maxHeight: 280,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorY: 'contain'
  },
  foodGroupCard: {
    position: 'relative',
    minHeight: 72,
    border: '1px solid #ddd6fe',
    borderRadius: 10,
    background: '#fff',
    overflow: 'hidden',
    boxShadow: '0 8px 18px rgba(76, 29, 149, 0.08)'
  },
  foodGroupCardActive: {
    borderColor: '#7c3aed',
    background: '#f5f3ff',
    boxShadow: 'inset 0 0 0 1px #7c3aed, 0 10px 20px rgba(76, 29, 149, 0.14)'
  },
  foodGroupCardMain: {
    width: '100%',
    minHeight: 72,
    border: 0,
    background: 'transparent',
    color: '#111827',
    padding: '12px 68px 12px 12px',
    display: 'grid',
    alignContent: 'center',
    gap: 4,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 900
  },
  foodGroupCardActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    display: 'flex',
    gap: 5
  },
  emptyInlineText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 850
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
  modalHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flex: '0 0 auto'
  },
  iconBackButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: '1px solid #ddd6fe',
    background: '#fff',
    color: '#4c1d95',
    fontSize: 18,
    fontWeight: 950,
    lineHeight: 1
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
