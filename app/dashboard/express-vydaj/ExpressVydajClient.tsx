'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { appText, type AppLanguage } from '@/lib/i18n'

type MealType = 'OBED' | 'VECERA'
type FoodChoice = 'MASO' | 'VEGE' | 'DIETA'

type RegistrationGroupOption = {
  id: string
  name: string
  accessLabel: string
}

type ExpressPerson = {
  id: string
  name: string
  firstName?: string
  lastName?: string
  email: string
  choice: FoodChoice
}

type ExpressIssue = {
  id: string
  title: string
  status: string
  validAfter: string | null
}

type ExpressData = {
  date: string
  meal: MealType
  group: {
    id: string
    name: string
  }
  issue: ExpressIssue | null
  people: ExpressPerson[]
  selectedIds: string[]
  pickupUserIds: string[]
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '-'
  const formatted = new Intl.DateTimeFormat('sk-SK', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(`${value}T12:00:00`))

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function mealLabel(meal: MealType, language: AppLanguage) {
  if (meal === 'OBED') return language === 'EN' ? 'Lunch' : 'Obed'
  return language === 'EN' ? 'Dinner' : 'Večera'
}

function foodLabel(food: FoodChoice, language: AppLanguage) {
  if (food === 'MASO') return language === 'EN' ? 'MEAT' : 'MÄSO'
  if (food === 'DIETA') return language === 'EN' ? 'DIET' : 'DIÉTA'
  return 'VEGE'
}

function remainingLabel(validAfter: string | null, nowMs: number) {
  if (!validAfter) return ''

  const targetMs = Date.parse(validAfter)
  if (Number.isNaN(targetMs)) return ''

  const totalSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function displayPersonName(person: ExpressPerson) {
  const firstName = String(person.firstName || '').trim()
  const lastName = String(person.lastName || '').trim()
  if (lastName || firstName) return `${lastName} ${firstName}`.trim()
  return person.name
}

export default function ExpressVydajClient({
  language = 'SK',
  userName,
  groups,
  canSelectDateMeal = false,
  initialDate,
  initialMeal
}: {
  language?: AppLanguage
  userName: string
  groups: RegistrationGroupOption[]
  canSelectDateMeal?: boolean
  initialDate: string
  initialMeal: MealType
}) {
  const router = useRouter()
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const t = (sk: string, en: string) => isEnglish ? en : sk
  const [groupId, setGroupId] = useState(groups[0]?.id || '')
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [selectedMeal, setSelectedMeal] = useState<MealType>(initialMeal)
  const [data, setData] = useState<ExpressData | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pickupUserIds, setPickupUserIds] = useState<string[]>([])
  const [pickupOpen, setPickupOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [nowMs, setNowMs] = useState(Date.now())
  const [redirectAfterCountdown, setRedirectAfterCountdown] = useState(false)
  const [redirectingToQr, setRedirectingToQr] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [editingIssue, setEditingIssue] = useState(false)
  const redirectTimeoutRef = useRef<number | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const pickupSet = useMemo(() => new Set(pickupUserIds), [pickupUserIds])
  const selectedCount = selectedIds.length
  const allPersonIds = useMemo(() => (data?.people || []).map(person => person.id), [data?.people])
  const pickupPeople = useMemo(() => {
    return (data?.people || []).filter(person => pickupSet.has(person.id))
  }, [data?.people, pickupSet])
  const countdown = remainingLabel(data?.issue?.validAfter || null, nowMs)
  const countdownActive = !!data?.issue?.validAfter && Date.parse(data.issue.validAfter) > nowMs
  const hasExistingIssue = !!data?.issue
  const showStatusPanel = hasExistingIssue && !editingIssue
  const showEditor = !hasExistingIssue || editingIssue
  const pickupLabel = pickupPeople.length > 0
    ? pickupPeople.map(displayPersonName).join(', ')
    : t('Nikto nie je vybraný', 'Nobody selected')

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!redirectAfterCountdown || !data?.issue?.validAfter) return
    if (Date.parse(data.issue.validAfter) > Date.now()) return

    const messageTimeout = window.setTimeout(() => {
      setRedirectingToQr(true)
      setMessage(t('Výdaj je platný. Presmerovávam na Môj QR kód.', 'Issue is valid. Redirecting to My QR code.'))
      setMessageType('ok')
    }, 100)
    const redirectTimeout = window.setTimeout(() => {
      router.push('/dashboard/qr')
    }, 900)

    return () => {
      window.clearTimeout(messageTimeout)
      window.clearTimeout(redirectTimeout)
    }
  }, [data?.issue?.validAfter, redirectAfterCountdown, router, nowMs])

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) window.clearTimeout(redirectTimeoutRef.current)
    }
  }, [])

  const redirectToQrSoon = (messageText: string) => {
    if (redirectTimeoutRef.current) window.clearTimeout(redirectTimeoutRef.current)

    setRedirectingToQr(true)
    setMessage(messageText)
    setMessageType('ok')
    redirectTimeoutRef.current = window.setTimeout(() => {
      router.push('/dashboard/qr')
    }, 1000)
  }

  const loadData = async (
    nextGroupId = groupId,
    nextDate = selectedDate,
    nextMeal = selectedMeal
  ) => {
    if (!nextGroupId) return

    setLoading(true)
    setMessage('')
    setMessageType('')

    try {
      const params = new URLSearchParams({ registrationGroupId: nextGroupId })

      if (canSelectDateMeal) {
        params.set('date', nextDate)
        params.set('meal', nextMeal)
      }

      const res = await fetch(`/api/skupinovy-vydaj/express?${params.toString()}`)
      const json = await res.json().catch(() => ({ error: t('Server nevrátil platnú odpoveď.', 'The server did not return a valid response.') }))

      if (!res.ok || json.error) throw new Error(json.error || t('Express výdaj sa nepodarilo načítať.', 'Express issue could not be loaded.'))

      if (json.date && json.date !== selectedDate) setSelectedDate(json.date)
      if (json.meal && json.meal !== selectedMeal) setSelectedMeal(json.meal)
      const loadedCountdownActive = !!json.issue?.validAfter && Date.parse(json.issue.validAfter) > Date.now()
      setData(json)
      setSelectedIds(Array.isArray(json.selectedIds) ? json.selectedIds : [])
      setPickupUserIds(Array.isArray(json.pickupUserIds) ? json.pickupUserIds : [])
      setPickupOpen(false)
      setRedirectAfterCountdown(loadedCountdownActive)
      setEditingIssue(!json.issue)
    } catch (err: any) {
      setData(null)
      setSelectedIds([])
      setPickupUserIds([])
      setPickupOpen(false)
      setRedirectAfterCountdown(false)
      setEditingIssue(false)
      setMessage(err?.message || t('Express výdaj sa nepodarilo načítať.', 'Express issue could not be loaded.'))
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData(groupId, selectedDate, selectedMeal)
  }, [groupId, selectedDate, selectedMeal])

  const togglePerson = (personId: string) => {
    if (saving) return

    setSelectedIds(current => {
      if (current.includes(personId)) return current.filter(id => id !== personId)
      return [...current, personId]
    })
  }

  const togglePickupUser = (personId: string) => {
    if (saving) return

    setPickupUserIds(current => {
      if (current.includes(personId)) return current.filter(id => id !== personId)
      return [...current, personId]
    })
  }

  const prepareIssue = () => {
    if (loading || saving || selectedIds.length === 0) return

    setMessage('')
    setMessageType('')
    setPickupOpen(true)
  }

  const save = async () => {
    if (!groupId || saving) return

    setSaving(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/express', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: groupId,
          userIds: selectedIds,
          pickupUserIds,
          ...(canSelectDateMeal ? {
            date: selectedDate,
            meal: selectedMeal
          } : {})
        })
      })
      const json = await res.json().catch(() => ({ error: t('Server nevrátil platnú odpoveď.', 'The server did not return a valid response.') }))

      if (!res.ok || json.error) throw new Error(json.error || t('Express výdaj sa nepodarilo uložiť.', 'Express issue could not be saved.'))

      setData(current => ({
        date: json.date || current?.date || '',
        meal: json.meal || current?.meal || 'OBED',
        group: current?.group || { id: groupId, name: '' },
        issue: json.issue || null,
        people: current?.people || [],
        selectedIds: Array.isArray(json.selectedIds) ? json.selectedIds : selectedIds,
        pickupUserIds: Array.isArray(json.pickupUserIds) ? json.pickupUserIds : pickupUserIds
      }))
      if (json.date && json.date !== selectedDate) setSelectedDate(json.date)
      if (json.meal && json.meal !== selectedMeal) setSelectedMeal(json.meal)
      setSelectedIds(Array.isArray(json.selectedIds) ? json.selectedIds : selectedIds)
      setPickupUserIds(Array.isArray(json.pickupUserIds) ? json.pickupUserIds : pickupUserIds)
      const savedValidAfter = json.issue?.validAfter || null
      const savedCountdownActive = !!savedValidAfter && Date.parse(savedValidAfter) > Date.now()

      if (savedCountdownActive) {
        setRedirectAfterCountdown(true)
        setEditingIssue(false)
        setMessage(t('Express výdaj je pripravený. Začne platiť po odpočte.', 'Express issue is ready. It will become valid after the countdown.'))
        setMessageType('ok')
      } else {
        setRedirectAfterCountdown(false)
        redirectToQrSoon(t('Express výdaj je uložený a platný. Presmerovávam na Môj QR kód.', 'Express issue is saved and valid. Redirecting to My QR code.'))
      }
    } catch (err: any) {
      setMessage(err?.message || t('Express výdaj sa nepodarilo uložiť.', 'Express issue could not be saved.'))
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  const cancelCurrentIssue = async () => {
    if (!data?.issue?.id || cancelling) return
    if (!confirm(t('Naozaj chceš zrušiť tento express výdaj?', 'Do you really want to cancel this express issue?'))) return

    setCancelling(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/issues', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: data.issue.id })
      })
      const json = await res.json().catch(() => ({ error: t('Server nevrátil platnú odpoveď.', 'The server did not return a valid response.') }))

      if (!res.ok || json.error) throw new Error(json.error || t('Express výdaj sa nepodarilo zrušiť.', 'Express issue could not be cancelled.'))

      setRedirectAfterCountdown(false)
      setMessage(json.message || t('Express výdaj bol zrušený.', 'Express issue has been cancelled.'))
      setMessageType('ok')
      await loadData(groupId, selectedDate, selectedMeal)
    } catch (err: any) {
      setMessage(err?.message || t('Express výdaj sa nepodarilo zrušiť.', 'Express issue could not be cancelled.'))
      setMessageType('error')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <main className="express-page" style={styles.page}>
      <style>{`
        .express-page button,
        .express-page a[href],
        .express-page select {
          touch-action: manipulation;
          transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease, background 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .express-page button:not(:disabled):active,
        .express-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @keyframes expressSpin {
          to { transform: rotate(360deg); }
        }

        .express-spinner {
          animation: expressSpin 850ms linear infinite;
        }

        @media (max-width: 560px) {
          .express-page { padding: 10px !important; }
          .express-top { margin-bottom: 8px !important; gap: 8px !important; align-items: flex-start !important; }
          .express-logo { height: 38px !important; max-width: 172px !important; }
          .express-date { display: none !important; }
          .express-user { font-size: 10px !important; padding: 4px 7px !important; max-width: min(70vw, 300px) !important; }
          .express-card { padding: 12px !important; border-radius: 16px !important; }
          .express-title { font-size: 25px !important; line-height: 1 !important; }
          .express-admin-controls { grid-template-columns: 1fr !important; width: 100% !important; overflow: visible !important; }
          .express-admin-field { width: 100% !important; max-width: 100% !important; }
          .express-date-native { position: absolute !important; inset: 0 !important; width: 100% !important; max-width: 100% !important; min-width: 0 !important; height: 100% !important; opacity: 0 !important; }
          .express-meta { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 6px !important; }
          .express-meta-group { grid-column: 1 / -1 !important; }
          .express-counter-box { padding: 8px 6px !important; text-align: center !important; }
          .express-actions { grid-template-columns: 1fr 1fr !important; gap: 6px !important; }
          .express-actions button { padding: 7px 6px !important; font-size: 11px !important; white-space: nowrap !important; }
          .express-save { width: 100% !important; }
          .express-person { padding: 8px !important; }
          .express-person-name { font-size: 14px !important; }
        }
      `}</style>

      <div className="express-top" style={styles.topBar}>
        <div style={styles.logoGroup}>
          <div style={styles.logoStack}>
            <img className="express-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
            <div className="express-user" style={styles.userBadge}>
              {t('Prihlásený:', 'Signed in:')} <b>{userName || '-'}</b>
            </div>
          </div>
          <div className="express-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>
        <button type="button" onClick={() => router.push('/dashboard')} disabled={saving} style={styles.homeButton} title={copy.backToDashboard} aria-label={copy.backToDashboard}>
          <HomeIcon />
        </button>
      </div>

      <section className="express-card" style={styles.card}>
        <div style={styles.titleRow}>
          <div>
            <h1 className="express-title" style={styles.title}>{t('Express výdaj', 'Express issue')}</h1>
            <div style={styles.subtitle}>
              {data ? `${mealLabel(data.meal, language)} · ${formatDate(data.date)}` : t('Načítavam dnešný výdaj', 'Loading today issue')}
            </div>
          </div>

        </div>

        {groups.length > 1 && (
          <label style={styles.field}>
            <span style={styles.fieldLabel}>{t('Registračná skupina', 'Registration group')}</span>
            <select
              value={groupId}
              onChange={event => setGroupId(event.target.value)}
              disabled={loading || saving}
              style={styles.select}
            >
              {groups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
        )}

        {canSelectDateMeal && (
          <div className="express-admin-controls" style={styles.adminControls}>
            <label className="express-admin-field" style={styles.adminField}>
              <span style={styles.fieldLabel}>{t('Dátum', 'Date')}</span>
              <div style={styles.datePickerBox}>
                <span style={styles.datePickerText}>{formatDate(selectedDate)}</span>
                <input
                  className="express-date-native"
                  type="date"
                  value={selectedDate}
                  onChange={event => setSelectedDate(event.target.value)}
                  disabled={loading || saving}
                  aria-label={t('Dátum', 'Date')}
                  style={styles.dateNativeInput}
                />
              </div>
            </label>
            <div className="express-admin-field" style={styles.adminField}>
              <span style={styles.fieldLabel}>{t('Jedlo', 'Meal')}</span>
              <div style={styles.mealSwitch}>
                {(['OBED', 'VECERA'] as MealType[]).map(meal => (
                  <button
                    key={meal}
                    type="button"
                    onClick={() => setSelectedMeal(meal)}
                    disabled={loading || saving}
                    style={{
                      ...styles.mealButton,
                      ...(selectedMeal === meal ? styles.mealButtonActive : {})
                    }}
                  >
                    {mealLabel(meal, language)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {data && !showStatusPanel && (
          <div className="express-meta" style={styles.metaGrid}>
            <div className="express-meta-group" style={styles.metaBox}>
              <span>{t('Skupina', 'Group')}</span>
              <b>{data.group.name}</b>
            </div>
            <div className="express-counter-box" style={styles.metaBox}>
              <span>{t('Označených', 'Selected')}</span>
              <b>{selectedCount}</b>
            </div>
            <div className="express-counter-box" style={styles.metaBox}>
              <span>{t('Prevezme', 'Pickup')}</span>
              <b>{pickupUserIds.length}</b>
            </div>
            <div className="express-counter-box" style={styles.metaBox}>
              <span>{t('Vydateľných', 'Issuable')}</span>
              <b>{data.people.length}</b>
            </div>
          </div>
        )}

        {showStatusPanel && data?.issue && (
          <section style={countdownActive ? styles.issueStatusPanelWaiting : styles.issueStatusPanelReady}>
            <div style={styles.statusPanelHeader}>
              <div>
                <div style={styles.statusPanelEyebrow}>{t('Express výdaj', 'Express issue')}</div>
                <h2 style={styles.statusPanelTitle}>{data.group.name || '-'}</h2>
                <div style={styles.statusPanelMeta}>{mealLabel(data.meal, language)} · {formatDate(data.date)}</div>
              </div>
            </div>

            {countdownActive ? (
              <div style={styles.inlineCountdownBox}>
                <span>{t('Začne platiť o', 'Valid in')}</span>
                <b>{countdown}</b>
              </div>
            ) : (
              <div style={styles.inlineReadyBox}>{t('Výdaj je platný', 'Issue is valid')}</div>
            )}

            <div style={styles.statusPanelStats}>
              <div style={styles.statusPanelStatBox}><span>{t('Označených', 'Selected')}</span><b>{selectedCount}</b></div>
              <div style={styles.statusPanelStatBox}><span>{t('Prevezme', 'Pickup')}</span><b>{pickupUserIds.length}</b></div>
              <div style={styles.statusPanelStatBox}><span>{t('Vydateľných', 'Issuable')}</span><b>{data.people.length}</b></div>
            </div>

            <div style={styles.statusPanelActions}>
              {!countdownActive && (
                <button type="button" onClick={() => router.push('/dashboard/qr')} disabled={saving || cancelling} style={styles.statusPrimaryButton}>
                  {t('Môj QR kód', 'My QR code')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditingIssue(true)
                  setPickupOpen(false)
                  setRedirectAfterCountdown(false)
                }}
                disabled={saving || cancelling}
                style={countdownActive ? styles.statusPrimaryButton : styles.statusSecondaryButton}
              >
                {t('Upraviť výdaj', 'Edit issue')}
              </button>
              <button type="button" onClick={() => void cancelCurrentIssue()} disabled={saving || cancelling} style={styles.statusDangerButton}>
                {cancelling ? t('Ruším...', 'Cancelling...') : t('Zrušiť výdaj', 'Cancel issue')}
              </button>
            </div>
          </section>
        )}

        {showEditor && (
        <div style={styles.actionBar}>
          <div className="express-actions" style={styles.quickActions}>
            {pickupOpen ? (
              <>
                <button type="button" onClick={() => setPickupOpen(false)} disabled={loading || saving} style={styles.smallButtonMuted}>
                  {t('Späť', 'Back')}
                </button>
                <button type="button" onClick={() => setPickupUserIds([])} disabled={loading || saving || pickupUserIds.length === 0} style={styles.smallButtonMuted}>
                  {t('Nikto', 'None')}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setSelectedIds(allPersonIds)} disabled={loading || saving || allPersonIds.length === 0} style={styles.smallButton}>
                  {t('Všetci', 'All')}
                </button>
                <button type="button" onClick={() => setSelectedIds([])} disabled={loading || saving || selectedIds.length === 0} style={styles.smallButtonMuted}>
                  {t('Nikto', 'None')}
                </button>
              </>
            )}
          </div>
          <button
            className="express-save"
            type="button"
            onClick={pickupOpen ? () => void save() : prepareIssue}
            disabled={loading || saving || selectedIds.length === 0 || (pickupOpen && pickupUserIds.length === 0)}
            style={styles.saveButton}
          >
            {saving ? t('Ukladám...', 'Saving...') : t('Pripraviť výdaj', 'Prepare issue')}
          </button>
        </div>
        )}

        {showEditor && data && pickupOpen && (
          <section style={styles.pickupPanel}>
            <div style={styles.pickupHeader}>
              <div>
                <div style={styles.pickupTitle}>{t('Prevezme osoba', 'Pickup person')}</div>
                <div style={styles.pickupSubtitle}>{pickupLabel}</div>
              </div>
            </div>

            <div style={styles.pickupList}>
              {data.people.map(person => {
                const picked = pickupSet.has(person.id)

                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => togglePickupUser(person.id)}
                    disabled={saving}
                    style={{
                      ...styles.pickupPersonButton,
                      ...(picked ? styles.pickupPersonButtonActive : {})
                    }}
                  >
                    <span style={picked ? styles.checkOn : styles.checkOff}>{picked ? '✓' : ''}</span>
                    <span style={styles.pickupPersonText}>{displayPersonName(person)}</span>
                    <span style={styles.foodBadge}>{foodLabel(person.choice, language)}</span>
                  </button>
                )
              })}
            </div>

          </section>
        )}

        {showEditor && !pickupOpen && (loading ? (
          <div style={styles.emptyBox}>{t('Načítavam ľudí...', 'Loading people...')}</div>
        ) : data?.people.length ? (
          <div style={styles.peopleList}>
            {data.people.map(person => {
              const selected = selectedSet.has(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => togglePerson(person.id)}
                  disabled={saving}
                  className="express-person"
                  style={{
                    ...styles.personRow,
                    ...(selected ? styles.personRowSelected : {})
                  }}
                >
                  <span style={selected ? styles.checkOn : styles.checkOff}>{selected ? '✓' : ''}</span>
                  <span style={styles.personText}>
                    <b className="express-person-name" style={styles.personName}>{displayPersonName(person)}</b>
                    <span style={styles.personEmail}>{person.email || '-'}</span>
                  </span>
                  <span style={styles.foodBadge}>{foodLabel(person.choice, language)}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div style={styles.emptyBox}>{t('Pre aktuálny výdaj tu nie je nikto vydateľný.', 'There is nobody issuable for the current meal.')}</div>
        ))}

        {message && (
          <div style={{
            ...styles.message,
            ...(messageType === 'ok' ? styles.messageOk : styles.messageError)
          }}>
            {message}
          </div>
        )}
      </section>

      {redirectingToQr && (
        <div style={styles.modalOverlay}>
          <section style={styles.redirectModal}>
            <div className="express-spinner" style={styles.spinner} />
            <h2 style={styles.redirectTitle}>{t('Výdaj je platný', 'Issue is valid')}</h2>
            <p style={styles.modalText}>{t('Presmerovávam na Môj QR kód.', 'Redirecting to My QR code.')}</p>
          </section>
        </div>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 48%, #56db3f 100%)',
    padding: 18,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#141414'
  },
  topBar: {
    maxWidth: 760,
    margin: '0 auto 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  logoStack: {
    display: 'grid',
    gap: 5,
    minWidth: 0
  },
  logo: {
    height: 50,
    maxWidth: 238,
    objectFit: 'contain',
    filter: 'drop-shadow(0 2px 10px rgba(0, 0, 0, 0.22))'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontWeight: 900,
    fontSize: 14
  },
  userBadge: {
    border: '1px solid #d7d3e8',
    borderRadius: 999,
    background: '#fff',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 850,
    width: 'fit-content',
    maxWidth: 'min(78vw, 420px)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  homeButton: {
    color: '#1f2937',
    background: '#fff',
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    width: 38,
    height: 38,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    cursor: 'pointer',
    fontFamily: 'Arial, Helvetica, sans-serif',
    boxShadow: '0 6px 14px rgba(31, 24, 61, 0.14)'
  },
  card: {
    maxWidth: 760,
    margin: '0 auto',
    background: 'rgba(255, 255, 255, 0.97)',
    border: '1px solid #ded8f2',
    borderRadius: 20,
    padding: 16,
    boxShadow: '0 18px 44px rgba(31, 24, 61, 0.26)',
    display: 'grid',
    gap: 12
  },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  title: {
    fontSize: 34,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  subtitle: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: 900,
    color: '#5b5870'
  },
  timerBadge: {
    background: '#fef3c7',
    color: '#92400e',
    border: '1px solid #f59e0b',
    borderRadius: 999,
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  readyBadge: {
    background: '#dcfce7',
    color: '#166534',
    border: '1px solid #86efac',
    borderRadius: 999,
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  issueStatusPanelWaiting: {
    border: '1px solid #f59e0b',
    borderRadius: 18,
    background: 'linear-gradient(180deg, #fff7ed 0%, #ffffff 100%)',
    padding: 14,
    display: 'grid',
    gap: 12,
    boxShadow: '0 12px 28px rgba(146, 64, 14, 0.12)'
  },
  issueStatusPanelReady: {
    border: '1px solid #86efac',
    borderRadius: 18,
    background: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
    padding: 14,
    display: 'grid',
    gap: 12,
    boxShadow: '0 12px 28px rgba(22, 101, 52, 0.12)'
  },
  statusPanelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  statusPanelEyebrow: {
    fontSize: 12,
    fontWeight: 950,
    color: '#5b21b6',
    textTransform: 'uppercase'
  },
  statusPanelTitle: {
    margin: '3px 0 0',
    fontSize: 28,
    lineHeight: 1,
    fontWeight: 950,
    color: '#211b35'
  },
  statusPanelMeta: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: 900,
    color: '#5b5870'
  },
  statusPillWaiting: {
    border: '1px solid #f59e0b',
    borderRadius: 999,
    background: '#fef3c7',
    color: '#92400e',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  statusPillReady: {
    border: '1px solid #86efac',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  inlineCountdownBox: {
    border: '1px solid #fed7aa',
    borderRadius: 16,
    background: '#fff7ed',
    padding: '12px 14px',
    display: 'grid',
    justifyItems: 'center',
    gap: 4,
    color: '#92400e',
    fontWeight: 950
  },
  inlineReadyBox: {
    border: '1px solid #bbf7d0',
    borderRadius: 16,
    background: '#dcfce7',
    padding: '12px 14px',
    color: '#166534',
    fontSize: 17,
    fontWeight: 950,
    textAlign: 'center'
  },
  statusPanelStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8
  },
  statusPanelStatBox: {
    border: '1px solid #e1deea',
    borderRadius: 14,
    background: '#fff',
    padding: '10px 8px',
    display: 'grid',
    gap: 3,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: 900,
    color: '#5b5870'
  },
  statusPanelActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8
  },
  statusPrimaryButton: {
    border: '1px solid #5b21b6',
    borderRadius: 999,
    padding: '11px 14px',
    background: '#7417e8',
    color: '#fff',
    fontSize: 14,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  statusSecondaryButton: {
    border: '1px solid #d7d3e8',
    borderRadius: 999,
    padding: '11px 14px',
    background: '#fff',
    color: '#211b35',
    fontSize: 14,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  statusDangerButton: {
    border: '1px solid #fecaca',
    borderRadius: 999,
    padding: '11px 14px',
    background: '#fee2e2',
    color: '#991b1b',
    fontSize: 14,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  field: {
    display: 'grid',
    gap: 6
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    color: '#5b5870'
  },
  select: {
    width: '100%',
    minHeight: 42,
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    background: '#fff',
    padding: '8px 10px',
    fontSize: 15,
    fontWeight: 900,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#211b35'
  },
  adminControls: {
    display: 'grid',
    gridTemplateColumns: 'minmax(170px, 0.8fr) minmax(220px, 1fr)',
    gap: 8,
    alignItems: 'end',
    minWidth: 0,
    width: '100%',
    maxWidth: '100%'
  },
  adminField: {
    display: 'grid',
    gap: 6,
    minWidth: 0,
    maxWidth: '100%'
  },
  datePickerBox: {
    position: 'relative',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    minHeight: 42,
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    background: '#fff',
    padding: '8px 10px',
    fontSize: 15,
    fontWeight: 900,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#211b35',
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden'
  },
  datePickerText: {
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    pointerEvents: 'none'
  },
  dateNativeInput: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    minWidth: 0,
    maxWidth: '100%',
    opacity: 0,
    cursor: 'pointer'
  },
  mealSwitch: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d7d3e8',
    borderRadius: 14,
    background: '#f8fafc',
    padding: 4
  },
  mealButton: {
    minHeight: 34,
    minWidth: 0,
    border: '1px solid transparent',
    borderRadius: 10,
    background: 'transparent',
    color: '#4b5563',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  mealButtonActive: {
    background: '#7417e8',
    color: '#fff',
    borderColor: '#5b21b6',
    boxShadow: '0 6px 14px rgba(116, 23, 232, 0.2)'
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr',
    gap: 8
  },
  metaBox: {
    border: '1px solid #e1deea',
    borderRadius: 12,
    padding: 10,
    background: '#fbfbfd',
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTop: '1px solid #ebe7f5',
    paddingTop: 10,
    flexWrap: 'wrap'
  },
  quickActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  smallButton: {
    border: '1px solid #2fb51b',
    borderRadius: 999,
    padding: '8px 12px',
    background: '#56db3f',
    color: '#111827',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  smallButtonMuted: {
    border: '1px solid #d7d3e8',
    borderRadius: 999,
    padding: '8px 12px',
    background: '#fff',
    color: '#374151',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  smallButtonPurple: {
    border: '1px solid #6d28d9',
    borderRadius: 999,
    padding: '8px 12px',
    background: '#ede9fe',
    color: '#4c1d95',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  smallButtonWarning: {
    border: '1px solid #f59e0b',
    borderRadius: 999,
    padding: '8px 12px',
    background: '#fef3c7',
    color: '#92400e',
    fontSize: 13,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  saveButton: {
    border: '1px solid #5b21b6',
    borderRadius: 999,
    padding: '10px 16px',
    background: '#7417e8',
    color: '#fff',
    fontSize: 14,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif',
    boxShadow: '0 8px 18px rgba(116, 23, 232, 0.24)'
  },
  pickupPanel: {
    border: '1px solid #ded8f2',
    borderRadius: 14,
    background: '#fbfbfd',
    padding: 10,
    display: 'grid',
    gap: 9
  },
  pickupHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  pickupTitle: {
    fontSize: 13,
    fontWeight: 950,
    color: '#211b35'
  },
  pickupSubtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: 850,
    color: '#6b667c',
    lineHeight: 1.25
  },
  pickupList: {
    display: 'grid',
    gap: 6,
    maxHeight: 250,
    overflowY: 'auto',
    paddingRight: 2
  },
  pickupPersonButton: {
    width: '100%',
    border: '1px solid #e1deea',
    borderRadius: 12,
    padding: 8,
    background: '#fff',
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#211b35'
  },
  pickupPersonButtonActive: {
    background: '#eef2ff',
    borderColor: '#a78bfa',
    boxShadow: '0 6px 14px rgba(109, 40, 217, 0.12)'
  },
  pickupPersonText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 900
  },
  peopleList: {
    display: 'grid',
    gap: 7,
    maxHeight: 'min(58vh, 520px)',
    overflowY: 'auto',
    paddingRight: 2
  },
  personRow: {
    width: '100%',
    border: '1px solid #e1deea',
    borderRadius: 12,
    padding: 10,
    background: '#fff',
    display: 'grid',
    gridTemplateColumns: '28px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 9,
    textAlign: 'left',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#211b35'
  },
  personRowSelected: {
    background: '#f0fdf4',
    borderColor: '#86efac',
    boxShadow: '0 6px 14px rgba(22, 163, 74, 0.12)'
  },
  checkOn: {
    width: 24,
    height: 24,
    borderRadius: 8,
    background: '#56db3f',
    border: '1px solid #2fb51b',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950
  },
  checkOff: {
    width: 24,
    height: 24,
    borderRadius: 8,
    background: '#fff',
    border: '1px solid #d7d3e8',
    display: 'inline-flex'
  },
  personText: {
    display: 'grid',
    gap: 2,
    minWidth: 0
  },
  personName: {
    fontSize: 15,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  personEmail: {
    fontSize: 11,
    fontWeight: 800,
    color: '#6b667c',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  foodBadge: {
    border: '1px solid #d7d3e8',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 11,
    fontWeight: 950,
    background: '#f8fafc',
    color: '#312b46'
  },
  emptyBox: {
    border: '1px dashed #d1d5db',
    borderRadius: 12,
    padding: 12,
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 850
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.35
  },
  messageOk: {
    background: '#dcfce7',
    borderColor: '#86efac',
    color: '#166534'
  },
  messageError: {
    background: '#fee2e2',
    borderColor: '#fecaca',
    color: '#991b1b'
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 70,
    background: 'rgba(17, 24, 39, 0.52)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  redirectModal: {
    width: 'min(88vw, 360px)',
    border: '1px solid #bbf7d0',
    borderRadius: 22,
    background: '#fff',
    padding: 24,
    boxShadow: '0 24px 60px rgba(17, 24, 39, 0.34)',
    textAlign: 'center',
    display: 'grid',
    justifyItems: 'center',
    gap: 10
  },
  modalText: {
    margin: 0,
    color: '#5b5870',
    fontSize: 13,
    lineHeight: 1.42,
    fontWeight: 850
  },
  spinner: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: '5px solid #bbf7d0',
    borderTopColor: '#16a34a'
  },
  redirectTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 950,
    color: '#166534'
  }
}
