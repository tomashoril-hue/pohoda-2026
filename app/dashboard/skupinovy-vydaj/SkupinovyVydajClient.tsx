'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import QrCameraScanner from './QrCameraScanner'

type MealType = 'OBED' | 'VECERA'
type MealSelection = MealType | ''

type RegistrationGroupOption = {
  id: string
  name: string
  canManageDelegates: boolean
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
  email: string
  choice: 'MASO' | 'VEGE' | 'DIETA'
  source: 'REGISTRATION_GROUP' | 'SEARCH' | 'QR'
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

const SHOW_DELEGATES = false
const MEAL_OPTIONS: Array<{ value: MealType, label: string }> = [
  { value: 'OBED', label: 'Obed' },
  { value: 'VECERA', label: 'Vecera' }
]

function fullDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '-'

  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function mealLabel(value: MealSelection) {
  return MEAL_OPTIONS.find(option => option.value === value)?.label || 'Vyberte jedlo'
}

function sourceLabel(value: IssuePerson['source']) {
  if (value === 'REGISTRATION_GROUP') return 'Skupina'
  if (value === 'QR') return 'QR'
  return 'Vyhladane'
}

export default function SkupinovyVydajClient({ initialDate, groups, delegatesByGroupId }: Props) {
  const [date, setDate] = useState(initialDate)
  const [meal, setMeal] = useState<MealSelection>('')
  const [selectionOpen, setSelectionOpen] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [issueTitle, setIssueTitle] = useState('')
  const [issuePeople, setIssuePeople] = useState<IssuePerson[]>([])
  const [selectedIssueUserIds, setSelectedIssueUserIds] = useState<string[]>([])
  const [pickupUserIds, setPickupUserIds] = useState<string[]>([])
  const [existingIssues, setExistingIssues] = useState<ExistingIssue[]>([])
  const [editingIssueId, setEditingIssueId] = useState('')
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueFeedback, setIssueFeedback] = useState('')
  const [issueFeedbackType, setIssueFeedbackType] = useState<'ok' | 'error'>('ok')
  const [createdIssue, setCreatedIssue] = useState<any>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [existingLoading, setExistingLoading] = useState(false)
  const [existingIssuesLoaded, setExistingIssuesLoaded] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState(groups.length === 1 ? groups[0]?.id || '' : '')
  const [delegateMap, setDelegateMap] = useState<Record<string, Delegate[]>>(delegatesByGroupId)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [delegateNote, setDelegateNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'error'>('ok')

  const selectedGroup = useMemo(() => {
    return groups.find(group => group.id === selectedGroupId) || null
  }, [groups, selectedGroupId])

  const delegates = selectedGroupId ? delegateMap[selectedGroupId] || [] : []
  const selectionReady = Boolean(date && selectedGroupId)
  const selectedIssuePeople = issuePeople.filter(person => selectedIssueUserIds.includes(person.id))
  const selectedSummary = selectedIssuePeople.reduce((summary, person) => {
    summary[person.choice] += 1
    summary.SPOLU += 1
    return summary
  }, { MASO: 0, VEGE: 0, DIETA: 0, SPOLU: 0 })

  function setMessage(message: string, type: 'ok' | 'error' = 'ok') {
    setFeedback(message)
    setFeedbackType(type)
  }

  function setIssueMessage(message: string, type: 'ok' | 'error' = 'ok') {
    setIssueFeedback(message)
    setIssueFeedbackType(type)
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

  function resetIssueState(options: { clearExisting?: boolean } = {}) {
    const clearExisting = options.clearExisting ?? true

    setConfirmed(false)
    setMeal('')
    setIssueTitle('')
    setIssuePeople([])
    setSelectedIssueUserIds([])
    setPickupUserIds([])
    if (clearExisting) {
      setExistingIssues([])
      setExistingIssuesLoaded(false)
    }
    setEditingIssueId('')
    setIssueFeedback('')
    setCreatedIssue(null)
  }

  async function loadExistingIssuesFor(
    nextGroupId = selectedGroupId,
    nextDate = date,
    nextMeal: MealSelection = ''
  ) {
    if (!nextGroupId || !nextDate) {
      setExistingIssues([])
      setExistingIssuesLoaded(false)
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
      setExistingIssuesLoaded(true)
      return issues
    } finally {
      setExistingLoading(false)
    }
  }

  async function showSelectionResult(nextGroupId: string, nextDate: string) {
    resetIssueState()
    if (!nextGroupId || !nextDate) {
      setSelectionOpen(true)
      setExistingIssues([])
      setExistingIssuesLoaded(false)
      return
    }

    setSelectionOpen(false)

    try {
      await loadExistingIssuesFor(nextGroupId, nextDate)
    } catch (err: any) {
      setIssueMessage(err?.message || 'Existujuce vydaje sa nepodarilo nacitat.', 'error')
    }
  }

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
      setSelectedIssueUserIds(people.map(person => person.id))
      setPickupUserIds(people[0]?.id ? [people[0].id] : [])
      setEditingIssueId('')
      await loadExistingIssuesFor(selectedGroupId, date)
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
      const people: IssuePerson[] = issue.people || []

      setEditingIssueId(issue.id)
      setMeal(issue.meal || '')
      setIssueTitle(issue.title || '')
      setIssuePeople(people)
      setSelectedIssueUserIds(people.map(person => person.id))
      setPickupUserIds((issue.pickupUserIds || []).filter((id: string) => people.some(person => person.id === id)))
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

      if (editingIssueId === issue.id) resetIssueState()
      await loadExistingIssuesFor()
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
        message: 'Najprv vyber datum, jedlo a registracnu skupinu.'
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
  }

  function toggleIssuePerson(userId: string) {
    setSelectedIssueUserIds(current => {
      const next = current.includes(userId)
        ? current.filter(id => id !== userId)
        : [...current, userId]

      setPickupUserIds(pickupCurrent => pickupCurrent.filter(id => next.includes(id)))
      return next
    })
  }

  function togglePickupUser(userId: string) {
    if (!selectedIssueUserIds.includes(userId)) return

    setPickupUserIds(current => {
      if (current.includes(userId)) return current.filter(id => id !== userId)
      return [...current, userId]
    })
  }

  async function saveIssue() {
    if (!selectedGroupId || !date || !meal || selectedIssuePeople.length === 0) {
      setIssueMessage('Vyber aspon jednu osobu.', 'error')
      return
    }

    const wasEditing = Boolean(editingIssueId)

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

      resetIssueState()
      setQrModalOpen(false)
      setSelectionOpen(false)
      await loadExistingIssuesFor()
      setIssueMessage(successMessage)
    } catch (err: any) {
      setIssueMessage(err?.message || 'Skupinovy vydaj sa nepodarilo ulozit.', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  async function searchUsers(query: string) {
    setSearchQuery(query)
    setSearchResults([])

    if (!selectedGroupId || query.trim().length < 2) return

    setLoading(true)
    setMessage('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        q: query
      })
      const res = await fetch(`/api/skupinovy-vydaj/delegates/search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhladavanie zlyhalo.')

      setSearchResults(json.users || [])
    } catch (err: any) {
      setMessage(err?.message || 'Vyhladavanie zlyhalo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function addDelegate(user: SearchUser) {
    if (!selectedGroupId) return

    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/delegates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          registrationGroupId: selectedGroupId,
          note: delegateNote
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo pridat.')

      setDelegateMap(current => ({
        ...current,
        [selectedGroupId]: json.delegates || []
      }))
      setSearchQuery('')
      setSearchResults([])
      setDelegateNote('')
      setMessage(json.message || 'Poverena osoba bola pridana.')
    } catch (err: any) {
      setMessage(err?.message || 'Poverenu osobu sa nepodarilo pridat.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function removeDelegate(delegate: Delegate) {
    if (!window.confirm(`Odobrat poverenie pre ${delegate.name}?`)) return

    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/delegates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegateId: delegate.id })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo odobrat.')

      setDelegateMap(current => ({
        ...current,
        [delegate.registrationGroupId]: json.delegates || []
      }))
      setMessage(json.message || 'Poverena osoba bola odobrana.')
    } catch (err: any) {
      setMessage(err?.message || 'Poverenu osobu sa nepodarilo odobrat.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="group-issue-page" style={styles.page}>
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
          .group-issue-page { padding: 10px !important; }
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
                      setSelectionOpen(true)
                      resetIssueState({ clearExisting: false })
                      void loadExistingIssuesFor()
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

                <div style={styles.issueToolbar}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIssueUserIds(issuePeople.map(person => person.id))
                      setPickupUserIds(current => current.filter(id => issuePeople.some(person => person.id === id)))
                    }}
                    disabled={issueLoading || issuePeople.length === 0}
                    style={styles.smallButton}
                  >
                    Oznacit vsetkych
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIssueUserIds([])
                      setPickupUserIds([])
                    }}
                        disabled={issueLoading || issuePeople.length === 0}
                        style={styles.smallButtonWhite}
                      >
                        Odznacit
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrModalOpen(true)}
                        disabled={issueLoading || !selectedGroupId || !date || !meal}
                        style={styles.darkButton}
                      >
                        Pridat cez QR
                      </button>
                    </div>

                    <div style={styles.peopleSectionHeader}>
                  <b>Osoby vo vydaji</b>
                  <span>{selectedIssueUserIds.length}/{issuePeople.length} oznacenych</span>
                </div>

                <div style={styles.issuePeopleList}>
                  {issuePeople.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento datum a jedlo nie je aktualne nikto vydatelny.</div>
                  ) : (
                    issuePeople.map(person => {
                      const selected = selectedIssueUserIds.includes(person.id)
                      const pickup = pickupUserIds.includes(person.id)

                      return (
                        <div
                          key={person.id}
                          className="issue-person-row"
                          style={{
                            ...styles.issuePersonRow,
                            ...(selected ? styles.issuePersonRowSelected : {})
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
                              <b>{person.name}</b>
                              {person.email && <small>{person.email}</small>}
                            </span>
                          </label>

                          <div className="issue-person-meta" style={styles.personMeta}>
                            <span style={styles.choicePill}>{person.choice}</span>
                            <span style={styles.sourcePill}>{sourceLabel(person.source)}</span>
                            <label style={styles.pickupLabel}>
                              <input
                                type="checkbox"
                                checked={pickup}
                                disabled={!selected}
                                onChange={() => togglePickupUser(person.id)}
                              />
                              Prevziat
                            </label>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                    <button
                      type="button"
                  onClick={saveIssue}
                  disabled={issueLoading || selectedSummary.SPOLU === 0}
                  style={{ ...styles.primaryButton, marginTop: 14, width: '100%' }}
                >
                  {issueLoading ? 'Ukladam...' : editingIssueId ? 'Ulozit upravy' : 'Vytvorit skupinovy vydaj'}
                </button>

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
                {selectionReady && !selectionOpen ? (
                  <div style={styles.selectedChoiceCard}>
                    <div style={styles.selectedChoiceInfo}>
                      <span style={styles.summaryLabel}>Vybrate</span>
                      <b>{selectedGroup?.name || '-'}</b>
                      <small>{fullDateLabel(date)}</small>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectionOpen(true)
                        resetIssueState({ clearExisting: false })
                        void loadExistingIssuesFor()
                      }}
                      style={styles.smallButtonWhite}
                    >
                      Zmenit
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={styles.panelHeaderRow}>
                      <div style={styles.panelTitle}>Vyber vydaja</div>
                      <span style={styles.kicker}>Krok 1</span>
                    </div>

                    <div style={styles.formGrid}>
                      <label style={styles.field}>
                        <span>Datum</span>
                        {renderDateInput(
                          date,
                          value => {
                            setDate(value)
                            void showSelectionResult(selectedGroupId, value)
                          },
                          issueLoading,
                          'Vyber datum'
                        )}
                      </label>

                      <label style={styles.field}>
                        <span>Registracna skupina</span>
                        <select
                          value={selectedGroupId}
                          onChange={event => {
                            const nextGroupId = event.target.value
                            setSelectedGroupId(nextGroupId)
                            setSearchQuery('')
                            setSearchResults([])
                            setFeedback('')
                            void showSelectionResult(nextGroupId, date)
                          }}
                          style={styles.input}
                        >
                          <option value="">Vyberte</option>
                          {groups.map(group => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      {selectionReady && (
                        <button
                          type="button"
                          onClick={() => void showSelectionResult(selectedGroupId, date)}
                          disabled={issueLoading}
                          style={styles.primaryButton}
                        >
                          Zobrazit vydaje
                        </button>
                      )}
                    </div>
                  </>
                )}
              </section>
              )}

              {!confirmed && selectionReady && (!selectionOpen || existingIssuesLoaded) && (
                <section style={{ ...styles.panel, order: 2 }}>
                  <div style={styles.delegateHeader}>
                    <div>
                      <h2 style={styles.delegateTitle}>Vydaje pre tento den</h2>
                      <p style={styles.delegateHint}>{selectedGroup?.name || '-'} / {fullDateLabel(date)}</p>
                    </div>
                    <span style={styles.countBadge}>{existingIssues.length}</span>
                  </div>

                  {existingLoading ? (
                    <div style={styles.emptyBox}>Nacitavam existujuce vydaje...</div>
                  ) : existingIssues.length === 0 ? (
                    <div style={styles.emptyBox}>Pre tento vyber zatial nie je vytvoreny ziaden vydaj.</div>
                  ) : (
                    <div style={styles.existingIssuesList}>
                      {existingIssues.map(issue => (
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
                      ))}
                    </div>
                  )}

                  <div style={styles.prepareActions}>
                    <label style={styles.field}>
                      <span style={styles.label}>Jedlo</span>
                      <select
                        value={meal}
                        onChange={event => setMeal(event.target.value as MealSelection)}
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
                    <button
                      type="button"
                      onClick={() => {
                        if (meal) void loadIssuePeople(meal)
                      }}
                      disabled={issueLoading || !meal}
                      style={{ ...styles.primaryButton, alignSelf: 'end' }}
                    >
                      {issueLoading ? 'Nacitavam...' : 'Pripravit vydaj'}
                    </button>
                  </div>

                  {!confirmed && issueFeedback && (
                    <div style={issueFeedbackType === 'ok' ? styles.feedbackOk : styles.feedbackError}>
                      {issueFeedback}
                    </div>
                  )}
                </section>
              )}

              {SHOW_DELEGATES && (
              <section style={{ ...styles.panel, order: 4 }}>
                <div style={styles.delegateHeader}>
                  <div>
                    <h2 style={styles.delegateTitle}>Povereni ludia</h2>
                    <p style={styles.delegateHint}>Povereny vydaj plati az po 15 minutach.</p>
                  </div>
                  <span style={styles.countBadge}>{delegates.length}</span>
                </div>

                {!selectedGroup?.canManageDelegates ? (
                  <div style={styles.infoBox}>Tuto cast moze menit iba manager registracnej skupiny.</div>
                ) : (
                  <>
                    <div style={styles.delegateList}>
                      {delegates.length === 0 ? (
                        <div style={styles.emptyBox}>Zatial nie je povereny nikto.</div>
                      ) : (
                        delegates.map(delegate => (
                          <div className="delegate-row" key={delegate.id} style={styles.delegateRow}>
                            <div style={styles.delegateName}>
                              <b>{delegate.name}</b>
                              {delegate.email && <span>{delegate.email}</span>}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeDelegate(delegate)}
                              disabled={loading}
                              style={styles.removeButton}
                              title="Odobrat poverenie"
                            >
                              x
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={styles.searchBox}>
                      <label style={styles.field}>
                        <span style={styles.label}>Vyhladat osobu</span>
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={event => searchUsers(event.target.value)}
                          placeholder="Meno, priezvisko alebo email"
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

                      {searchResults.length > 0 && (
                        <div style={styles.searchResults}>
                          {searchResults.map(user => (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => addDelegate(user)}
                              disabled={loading || delegates.some(delegate => delegate.userId === user.id)}
                              style={styles.resultButton}
                            >
                              <b>{user.name}</b>
                              {user.email && <span>{user.email}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {feedback && (
                  <div style={feedbackType === 'ok' ? styles.feedbackOk : styles.feedbackError}>
                    {feedback}
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
                <div>
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
                disabled={issueLoading || !selectedGroupId || !date}
                onScan={addIssuePersonByQr}
              />
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
    fontFamily: 'Arial, Helvetica, sans-serif'
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
    order: 3
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
  prepareActions: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(140px, auto)',
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
    marginTop: 12,
    maxHeight: 560,
    overflow: 'auto',
    paddingRight: 3
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
    gap: 3,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 850
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
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  qrModal: {
    width: '100%',
    maxWidth: 430,
    maxHeight: 'calc(100vh - 32px)',
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
    fontSize: 20,
    fontWeight: 900,
    lineHeight: 1
  }
}
