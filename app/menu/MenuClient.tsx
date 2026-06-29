'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { appText, localeFor, type AppLanguage } from '@/lib/i18n'

type MealType = 'OBED' | 'VECERA'
type MenuVariant = 'MASO' | 'VEGE' | 'DIETA'
type Variant = MenuVariant | 'BEZ_ZAUJMU'

type MenuItem = {
  id: string
  datum: string
  typ_jedla: MealType
  varianta: MenuVariant
  nazov: string
  popis: string | null
}

type Selection = {
  user_id: string
  datum: string
  typ_jedla: MealType
  volba: Variant
}

type Deadline = {
  datum: string
  typ_jedla: MealType
  deadline_at: string | null
  locked: boolean
}

type Entitlement = {
  datum: string
  obed: boolean
  vecera: boolean
}

type CachedMenuSelections = {
  version: 1
  userId: string
  savedAt: string
  selections: Selection[]
}

type DeadlineState = {
  locked: boolean
  blockedByAdmin: boolean
  closedByTime: boolean
  deadlineText: string
  countdown: string
  showCountdown: boolean
  danger: boolean
  label: string
}

function normalizeVariant(value: string | null | undefined): Variant | null {
  const normalized = String(value || '').trim().toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIETA'

  return null
}

function variantLabel(value: string | null | undefined, language: AppLanguage = 'SK') {
  const normalized = normalizeVariant(value)
  if (normalized === 'BEZ_ZAUJMU') return language === 'EN' ? 'NO INTEREST' : 'NEMÁM ZÁUJEM'
  if (normalized === 'DIETA') return language === 'EN' ? 'DIET' : 'DIÉTA'
  if (normalized === 'MASO') return language === 'EN' ? 'MEAT' : 'MÄSO'
  return value
}

function noInterestLabel(meal: MealType, language: AppLanguage = 'SK') {
  if (language === 'EN') return meal === 'OBED' ? 'I do not want lunch' : 'I do not want dinner'
  return meal === 'OBED' ? 'Nemám záujem o obed' : 'Nemám záujem o večeru'
}

const menuSelectionsCacheKey = (userId: string) => `pohoda-pass:menu-selections:v1:${userId}`

function normalizeSelectionsForCache(userId: string, input: Selection[]) {
  const map = new Map<string, Selection>()

  input.forEach((selection) => {
    const typ = selection.typ_jedla === 'VECERA' ? 'VECERA' : selection.typ_jedla === 'OBED' ? 'OBED' : null
    const volba = normalizeVariant(selection.volba)

    if (!typ || !volba || !/^\d{4}-\d{2}-\d{2}$/.test(selection.datum)) return

    map.set(`${selection.datum}-${typ}`, {
      user_id: userId,
      datum: selection.datum,
      typ_jedla: typ,
      volba,
    })
  })

  return Array.from(map.values())
    .sort((a, b) => `${a.datum}-${a.typ_jedla}`.localeCompare(`${b.datum}-${b.typ_jedla}`))
    .slice(-120)
}

function readCachedMenuSelections(userId: string) {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(menuSelectionsCacheKey(userId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CachedMenuSelections>
    if (parsed.version !== 1 || parsed.userId !== userId || !Array.isArray(parsed.selections)) return null

    return normalizeSelectionsForCache(userId, parsed.selections)
  } catch {
    return null
  }
}

function writeCachedMenuSelections(userId: string, selections: Selection[]) {
  if (typeof window === 'undefined') return

  try {
    const payload: CachedMenuSelections = {
      version: 1,
      userId,
      savedAt: new Date().toISOString(),
      selections: normalizeSelectionsForCache(userId, selections),
    }

    window.localStorage.setItem(menuSelectionsCacheKey(userId), JSON.stringify(payload))
  } catch {
    // Local cache is only a fallback for offline display.
  }
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function MenuClient({
  language = 'SK',
  userId,
  today,
  defaultFood,
  menu,
  selections,
  deadlines,
  entitlements = null,
  submitUrl = '/api/menu/select',
  submitExtraBody,
  kioskMode = false,
  heading,
  description,
  infoTitle,
  infoBody,
  selectedPersonName,
  topSlot,
  onActivity,
}: {
  language?: AppLanguage
  userId: string
  today: string
  defaultFood: string | null
  menu: MenuItem[]
  selections: Selection[]
  deadlines: Deadline[]
  entitlements?: Entitlement[] | null
  submitUrl?: string
  submitExtraBody?: Record<string, string>
  kioskMode?: boolean
  heading?: string
  description?: string
  infoTitle?: string
  infoBody?: string
  selectedPersonName?: string
  topSlot?: ReactNode
  onActivity?: () => void
}) {
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const effectiveHeading = heading || copy.mealSelection
  const effectiveDescription = description || (isEnglish
    ? 'Choose your meal for each day. After the deadline the selection can no longer be changed.'
    : 'Vyber si jedlo na každý deň. Po uzávierke už výber nebude možné meniť.')
  const [selectedDate, setSelectedDate] = useState(today)
  const [localSelections, setLocalSelections] = useState<Selection[]>(selections)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [pressedKey, setPressedKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (kioskMode || typeof navigator === 'undefined') return

    if (navigator.onLine) {
      writeCachedMenuSelections(userId, selections)
      return
    }

    const cachedSelections = readCachedMenuSelections(userId)
    if (cachedSelections) setLocalSelections(cachedSelections)
  }, [kioskMode, selections, userId])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return

    const handleOnline = () => {
      setOnline(true)
      setSavingKey(null)
      setPressedKey(null)
      setMessage('')
      onActivity?.()
    }
    const handleOffline = () => {
      setOnline(false)
      setSavingKey(null)
      setPressedKey(null)
      setMessage(isEnglish
        ? 'The device is offline. Meal selection can be changed after the internet connection is restored.'
        : 'Telefón je offline. Výber stravy bude možné meniť po obnovení internetu.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [onActivity])

  const dates = useMemo(() => {
    return Array.from(new Set(menu.map((m) => m.datum)))
  }, [menu])

  const defaultFoodLabel = useMemo(() => {
    const normalized = normalizeVariant(defaultFood)
    if (normalized === 'MASO') return isEnglish ? 'MEAT' : 'MÄSO'
    if (normalized === 'VEGE') return 'VEGE'
    if (normalized === 'DIETA') return isEnglish ? 'DIET' : 'DIÉTA'
    return isEnglish ? 'not set' : 'nenastavená'
  }, [defaultFood, isEnglish])

  const canSelectDiet = normalizeVariant(defaultFood) === 'DIETA'

  const emptyDeadlineState = (): DeadlineState => ({
    locked: false,
    blockedByAdmin: false,
    closedByTime: false,
    deadlineText: '',
    countdown: '',
    showCountdown: false,
    danger: false,
    label: '',
  })

  const defaultDeadlineAt = (datum: string, typ: MealType) => {
    const d = new Date(`${datum}T12:00:00`)
    d.setDate(d.getDate() - 1)
    const hour = typ === 'OBED' ? 16 : 17
    d.setHours(hour, 0, 0, 0)
    return d
  }

  const getSelected = (datum: string, typ: MealType) => {
    return (
      localSelections.find((s) => s.datum === datum && s.typ_jedla === typ)
        ?.volba || null
    )
  }

  const hasMealEntitlement = (datum: string, typ: MealType) => {
    if (!Array.isArray(entitlements)) return true

    const entitlement = entitlements.find((item) => item.datum === datum)
    return typ === 'OBED' ? !!entitlement?.obed : !!entitlement?.vecera
  }

  const formatDateLabel = (date: string) => {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString(localeFor(language), {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    })
  }

  const formatFullDate = (date: string) => {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString(localeFor(language), {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  const todayFullLabel = () => {
    const d = new Date(today + 'T12:00:00')
    return d.toLocaleDateString(localeFor(language), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatDeadline = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleString(localeFor(language), {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getDeadlineState = (datum: string, typ: MealType): DeadlineState => {
    // Pred mountom nič nezamykáme vizuálne, aby nevznikol hydration mismatch.
    // Reálnu ochranu stále robí API /api/menu/select.
    if (!mounted) {
      return emptyDeadlineState()
    }

    const deadline = deadlines.find(
      (d) => d.datum === datum && d.typ_jedla === typ
    )

    const effectiveDeadlineAt = deadline?.deadline_at
      ? new Date(deadline.deadline_at)
      : defaultDeadlineAt(datum, typ)

    if (deadline?.locked) {
      return {
        locked: true,
        blockedByAdmin: true,
        closedByTime: false,
        deadlineText: formatDeadline(effectiveDeadlineAt.toISOString()),
        countdown: '',
        showCountdown: false,
        danger: false,
        label: isEnglish ? 'LOCKED' : 'BLOKOVANÉ',
      }
    }

    if (now !== null) {
      const diff = effectiveDeadlineAt.getTime() - now

      if (diff <= 0) {
        return {
          locked: true,
          blockedByAdmin: false,
          closedByTime: true,
          deadlineText: formatDeadline(effectiveDeadlineAt.toISOString()),
          countdown: '',
          showCountdown: false,
          danger: false,
          label: isEnglish ? 'CLOSED' : 'UZATVORENÉ',
        }
      }

      return {
        locked: false,
        blockedByAdmin: false,
        closedByTime: false,
        deadlineText: formatDeadline(effectiveDeadlineAt.toISOString()),
        countdown: diff <= 60 * 60 * 1000 ? formatCountdown(diff) : '',
        showCountdown: diff <= 60 * 60 * 1000,
        danger: diff <= 5 * 60 * 1000,
        label: isEnglish ? 'OPEN' : 'OTVORENÉ',
      }
    }

    return {
      locked: false,
      blockedByAdmin: false,
      closedByTime: false,
      deadlineText: formatDeadline(effectiveDeadlineAt.toISOString()),
      countdown: '',
      showCountdown: false,
      danger: false,
      label: '',
    }
  }

  const handleSelect = async (datum: string, typ: MealType, volba: Variant) => {
    onActivity?.()
    const state = getDeadlineState(datum, typ)

    if (!online) {
      setMessage(isEnglish
        ? 'The device is offline. Meal selection can be changed after the internet connection is restored.'
        : 'Telefón je offline. Výber stravy bude možné meniť po obnovení internetu.')
      return
    }

    if (state.locked) {
      setMessage(state.label)
      return
    }

    if (!hasMealEntitlement(datum, typ)) {
      setMessage(isEnglish
        ? 'You do not have meal entitlement for this day.'
        : 'Nemáš nárok na stravu pre tento deň.')
      return
    }

    const key = `${datum}-${typ}`
    const optionKey = `${key}-${volba}`
    setSavingKey(key)
    setPressedKey(optionKey)
    setMessage('')

    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum, typ_jedla: typ, volba, ...(submitExtraBody || {}) }),
    }).catch(() => null)

    if (!res) {
      setMessage(isEnglish
        ? 'The device is offline or the connection dropped. Try again after the internet connection is restored.'
        : 'Telefón je offline alebo spojenie vypadlo. Skús to znova po obnovení internetu.')
      setSavingKey(null)
      setPressedKey(null)
      return
    }

    let result: any = {}

    try {
      result = await res.json()
    } catch {
      setMessage(isEnglish ? 'The server did not return a valid response.' : 'Server nevrátil platnú odpoveď.')
      setSavingKey(null)
      setPressedKey(null)
      return
    }

    if (!res.ok) {
      setMessage(result.error || (isEnglish ? 'The selection could not be saved.' : 'Nepodarilo sa uložiť výber.'))
      setSavingKey(null)
      setPressedKey(null)
      return
    }

    setLocalSelections((prev) => {
      const filtered = prev.filter(
        (s) => !(s.datum === datum && s.typ_jedla === typ)
      )

      const nextSelections = [
        ...filtered,
        {
          user_id: userId,
          datum,
          typ_jedla: typ,
          volba,
        },
      ]

      if (!kioskMode) writeCachedMenuSelections(userId, nextSelections)

      return nextSelections
    })

    setMessage(isEnglish ? 'Selection saved.' : 'Výber bol uložený.')
    if (volba === 'BEZ_ZAUJMU') {
      setMessage(isEnglish ? 'Meal signed off.' : 'Jedlo bolo odhlásené.')
    }

    setSavingKey(null)
    setPressedKey(null)
    onActivity?.()
  }

  const renderMealSection = (typ: MealType) => {
    const items = menu.filter(
      (m) =>
        m.datum === selectedDate &&
        m.typ_jedla === typ &&
        (normalizeVariant(m.varianta) !== 'DIETA' || canSelectDiet)
    )

    const selected = getSelected(selectedDate, typ)
    const selectedVariant = normalizeVariant(selected)
    const noInterestSelected = selectedVariant === 'BEZ_ZAUJMU'
    const isSaving = savingKey === `${selectedDate}-${typ}`
    const state = getDeadlineState(selectedDate, typ)
    const mealEntitlement = hasMealEntitlement(selectedDate, typ)
    const mealDisabled = state.locked || !mealEntitlement
    const defaultVariant = normalizeVariant(defaultFood)
    const effectiveSelectedVariant =
      !selectedVariant && state.locked && mealEntitlement && defaultVariant
        ? defaultVariant
        : selectedVariant

    return (
      <section
        className="menu-meal-section"
        style={{
          border: '3px solid #000',
          borderRadius: 24,
          padding: 16,
          marginBottom: 18,
          background: mealDisabled ? '#e8e8e8' : '#fff',
          opacity: mealDisabled ? 0.88 : 1,
        }}
      >
        <div
          className="menu-meal-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            marginBottom: 14,
          }}
        >
          <div>
            <h2
              className="menu-meal-title"
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 900,
              }}
            >
              {typ === 'OBED' ? (isEnglish ? 'LUNCH' : 'OBED') : (isEnglish ? 'DINNER' : 'VEČERA')}
            </h2>

            {!mealEntitlement ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  fontWeight: 900,
                  color: '#b91c1c',
                }}
              >
                {isEnglish
                  ? 'You do not have meal entitlement for this day.'
                  : 'Nemáš nárok na stravu pre tento deň.'}
              </div>
            ) : state.deadlineText && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  fontWeight: 900,
                }}
              >
                {isEnglish ? 'Deadline' : 'Uzávierka'}: {state.deadlineText}
              </div>
            )}
          </div>

          <div
            className={`menu-meal-status ${state.danger ? 'deadline-blink' : ''}`}
            style={{
              background: !mealEntitlement
                ? '#b91c1c'
                : state.locked
                ? '#000'
                : state.danger
                  ? '#ff2b2b'
                  : state.showCountdown
                    ? '#f25be6'
                    : noInterestSelected
                      ? '#ef4444'
                      : selected
                      ? '#56db3f'
                      : '#fff176',
              color: !mealEntitlement || state.locked || state.danger || noInterestSelected ? '#fff' : '#000',
              border: '3px solid #000',
              borderRadius: 999,
              padding: '7px 13px',
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
              minWidth: 150,
            }}
          >
            {!mealEntitlement
              ? (isEnglish ? 'NO ENTITLEMENT' : 'BEZ NÁROKU')
              : state.locked
              ? state.label
                : state.showCountdown
                  ? `${isEnglish ? 'DEADLINE' : 'UZÁVIERKA'} ${state.countdown}`
                  : noInterestSelected
                  ? `${isEnglish ? 'Signed off' : 'Odhlásené'}: ${typ === 'OBED' ? (isEnglish ? 'lunch' : 'obed') : (isEnglish ? 'dinner' : 'večera')}`
                  : selected
                  ? `${isEnglish ? 'Selected' : 'Vybrané'}: ${variantLabel(selected, language)}`
                  : `${isEnglish ? 'Default' : 'Predvolené'}: ${defaultFoodLabel}`}
          </div>
        </div>

        <div
          className="menu-options-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
          }}
        >
          {items.map((item) => {
            const active = effectiveSelectedVariant === normalizeVariant(item.varianta)
            const optionKey = `${selectedDate}-${typ}-${item.varianta}`
            const isPressed = pressedKey === optionKey

            return (
              <button
                className="menu-option-card"
                key={item.id}
                onClick={() => handleSelect(selectedDate, typ, item.varianta)}
                disabled={isSaving || mealDisabled || !online}
                style={{
                  textAlign: 'left',
                  minHeight: 150,
                  padding: 18,
                  border: '3px solid #000',
                  borderRadius: 22,
                  background: isPressed ? '#fff176' : active ? '#56db3f' : '#fff',
                  boxShadow: isPressed ? '2px 2px 0 #000' : active && !mealDisabled ? '6px 6px 0 #000' : 'none',
                  cursor: mealDisabled || !online ? 'not-allowed' : isSaving ? 'wait' : 'pointer',
                  opacity: (mealDisabled || !online) && !active ? 0.45 : 1,
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  filter: (mealDisabled || !online) && !active ? 'grayscale(1)' : 'none',
                  transform: isPressed ? 'translate(4px, 4px)' : 'translate(0, 0)',
                  transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
                }}
              >
                <div
                  className="menu-option-badge"
                  style={{
                    display: 'inline-block',
                    background: item.varianta === 'MASO' ? '#000' : '#f25be6',
                    color: '#fff',
                    border: '3px solid #000',
                    borderRadius: 999,
                    padding: '5px 12px',
                    fontSize: 13,
                    fontWeight: 900,
                    marginBottom: 12,
                  }}
                >
                  {variantLabel(item.varianta, language)}
                </div>

                <div
                  className="menu-option-title"
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    color: '#000',
                    marginBottom: 8,
                  }}
                >
                  {item.nazov}
                </div>

                <div
                  className="menu-option-description"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    color: '#000',
                  }}
                >
                  {item.popis || (isEnglish ? 'No description' : 'Bez popisu')}
                </div>

                {(active || isPressed) && (
                  <div
                    style={{
                      marginTop: 14,
                      fontWeight: 900,
                      fontSize: 14,
                    }}
                  >
                    ✓ {isEnglish ? 'This is selected' : 'Toto máš vybrané'}
                  </div>
                )}
              </button>
            )
          })}

          {(() => {
            const active = normalizeVariant(selected) === 'BEZ_ZAUJMU'
            const optionKey = `${selectedDate}-${typ}-BEZ_ZAUJMU`
            const isPressed = pressedKey === optionKey

            return (
              <button
                className="menu-option-card menu-no-interest-card"
                key={`${typ}-bez-zaujmu`}
                onClick={() => handleSelect(selectedDate, typ, 'BEZ_ZAUJMU')}
                disabled={isSaving || mealDisabled || !online}
                style={{
                  textAlign: 'left',
                  minHeight: 150,
                  padding: 18,
                  border: '3px solid #000',
                  borderRadius: 22,
                  background: isPressed ? '#fff176' : active ? '#ff8a8a' : '#fff7ed',
                  boxShadow: isPressed ? '2px 2px 0 #000' : active && !mealDisabled ? '6px 6px 0 #000' : 'none',
                  cursor: mealDisabled || !online ? 'not-allowed' : isSaving ? 'wait' : 'pointer',
                  opacity: (mealDisabled || !online) && !active ? 0.45 : 1,
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  filter: (mealDisabled || !online) && !active ? 'grayscale(1)' : 'none',
                  transform: isPressed ? 'translate(4px, 4px)' : 'translate(0, 0)',
                  transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
                }}
              >
                <div
                  className="menu-option-badge"
                  style={{
                    display: 'inline-block',
                    background: '#ef4444',
                    color: '#fff',
                    border: '3px solid #000',
                    borderRadius: 999,
                    padding: '5px 12px',
                    fontSize: 13,
                    fontWeight: 900,
                    marginBottom: 12,
                  }}
                >
                  {isEnglish ? 'SIGN OFF' : 'ODHLÁSIŤ'}
                </div>

                <div
                  className="menu-option-title"
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    color: '#000',
                    marginBottom: 8,
                  }}
                >
                  {noInterestLabel(typ, language)}
                </div>

                {(active || isPressed) && (
                  <div
                    style={{
                      marginTop: 14,
                      fontWeight: 900,
                      fontSize: 14,
                    }}
                  >
                    ✓ Jedlo je odhlásené
                  </div>
                )}
              </button>
            )
          })()}
        </div>
      </section>
    )
  }

  return (
    <main
      className="menu-page"
      style={{
        minHeight: '100vh',
        padding: 24,
        background:
          'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: '#000',
      }}
    >
      <style>
        {`
          @keyframes deadlinePulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }

          .deadline-blink {
            animation: deadlinePulse 0.7s infinite;
          }

          .menu-home-button {
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
            -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
          }

          .menu-home-button:active {
            transform: translate(3px, 3px) scale(0.96);
            box-shadow: 1px 1px 0 #000 !important;
            filter: brightness(0.94);
          }

          @media (max-width: 560px) {
            .menu-page {
              padding: 10px !important;
            }

            .menu-top {
              margin-bottom: 8px !important;
              gap: 8px !important;
            }

            .menu-logo {
              height: 38px !important;
              max-width: 172px !important;
            }

            .menu-today {
              display: none !important;
            }

            .menu-card {
              max-width: 100% !important;
              padding: 12px !important;
              border: 1px solid #ded8f2 !important;
              border-radius: 16px !important;
              box-shadow: 0 18px 44px rgba(31, 24, 61, 0.26) !important;
            }

            .menu-card-header {
              margin-bottom: 8px !important;
              align-items: center !important;
            }

            .menu-title {
              font-size: 25px !important;
              line-height: 1 !important;
            }

            .menu-description,
            .menu-info-box {
              display: none !important;
            }

            .menu-home-button {
              width: 38px !important;
              height: 38px !important;
              border-radius: 12px !important;
              border: 1px solid #d7d3e8 !important;
              box-shadow: 0 6px 14px rgba(31, 24, 61, 0.14) !important;
              font-size: 20px !important;
            }

            .menu-date-row {
              gap: 6px !important;
              padding-bottom: 8px !important;
              margin-bottom: 10px !important;
            }

            .menu-date-button {
              padding: 8px 11px !important;
              border-width: 2px !important;
              font-size: 12px !important;
            }

            .menu-meal-section {
              padding: 10px !important;
              margin-bottom: 10px !important;
              border-width: 1px !important;
              border-radius: 14px !important;
            }

            .menu-meal-header {
              margin-bottom: 9px !important;
              gap: 8px !important;
              align-items: center !important;
            }

            .menu-meal-title {
              font-size: 20px !important;
              line-height: 1 !important;
            }

            .menu-meal-status {
              min-width: 0 !important;
              padding: 6px 9px !important;
              border-width: 1px !important;
              font-size: 11px !important;
              max-width: 52vw !important;
              white-space: normal !important;
            }

            .menu-options-grid {
              grid-template-columns: 1fr !important;
              gap: 8px !important;
            }

            .menu-option-card {
              min-height: 0 !important;
              padding: 10px !important;
              border-width: 1px !important;
              border-radius: 14px !important;
              box-shadow: none !important;
            }

            .menu-option-badge {
              padding: 4px 9px !important;
              border-width: 1px !important;
              font-size: 11px !important;
              margin-bottom: 7px !important;
            }

            .menu-option-title {
              font-size: 16px !important;
              margin-bottom: 5px !important;
            }

            .menu-option-description {
              font-size: 12px !important;
              line-height: 1.25 !important;
            }
          }
        `}
      </style>

      <div
        className="menu-top"
        style={{
          maxWidth: 980,
          margin: '0 auto 14px auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: 7,
            justifyItems: 'start',
          }}
        >
          {kioskMode ? (
            <img className="menu-logo" src="/pohoda-30.svg" alt="POHODA" style={{ height: 46 }} />
          ) : (
            <a href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              <img className="menu-logo" src="/pohoda-30.svg" alt="POHODA" style={{ height: 46 }} />
            </a>
          )}

          <div
            className="menu-today"
            style={{
              background: '#000',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 999,
              fontWeight: 900,
              border: '3px solid #000',
              fontSize: 13,
              lineHeight: 1.1,
            }}
          >
            {isEnglish ? 'Today is' : 'Dnes je'} : {todayFullLabel()}
          </div>
        </div>
        {!kioskMode && (
          <Link
            className="menu-home-button"
            href="/dashboard"
            aria-label={copy.backToDashboard}
            title={copy.backToDashboard}
            style={{
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
              boxShadow: '0 6px 14px rgba(31, 24, 61, 0.14)'
            }}
          >
            <HomeIcon />
          </Link>
        )}
      </div>

      {topSlot}

      <div
        className="menu-card"
        style={{
          maxWidth: 760,
          margin: '0 auto',
          background: '#fff',
          padding: 24,
          border: '4px solid #000',
          borderRadius: 28,
          boxShadow: '12px 12px 0 #000',
        }}
      >
        <div
          className="menu-card-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <h1
            className="menu-title"
            style={{
              margin: 0,
              fontSize: 34,
              fontWeight: 900,
            }}
          >
            {effectiveHeading}
          </h1>
        </div>

        {selectedPersonName && (
          <div
            style={{
              margin: '0 0 12px 0',
              display: 'inline-block',
              background: '#000',
              color: '#fff',
              border: '3px solid #000',
              borderRadius: 999,
              padding: '8px 14px',
              fontSize: 15,
              fontWeight: 900,
            }}
          >
            {selectedPersonName}
          </div>
        )}

        <p
          className="menu-description"
          style={{
            margin: '0 0 14px 0',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          {effectiveDescription}
        </p>

        {!online && (
          <div
            style={{
              margin: '0 0 14px 0',
              border: '3px solid #000',
              borderRadius: 18,
              padding: 12,
              background: '#fff176',
              color: '#000',
              fontSize: 14,
              fontWeight: 900,
              boxShadow: '4px 4px 0 #000',
            }}
          >
            Telefón je offline. Výber bude možné meniť po obnovení internetu.
          </div>
        )}

        <div
          className="menu-info-box"
          style={{
            margin: '0 0 20px 0',
            border: '3px solid #000',
            borderRadius: 18,
            padding: 14,
            background: '#56db3f',
            boxShadow: '5px 5px 0 #000',
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 900,
              marginBottom: 4,
            }}
          >
            {infoTitle || `Ak nič nezmeníš, platí tvoja predvolená strava: ${defaultFoodLabel}.`}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              lineHeight: 1.35,
            }}
          >
            {infoBody || 'Výber ukladáme iba vtedy, keď klikneš na konkrétnu možnosť.'}
          </div>
        </div>

        <div
          className="menu-date-row"
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 12,
            marginBottom: 18,
          }}
        >
          {dates.map((date) => {
            const active = date === selectedDate

            return (
              <button
                className="menu-date-button"
                key={date}
                onClick={() => {
                  onActivity?.()
                  setSelectedDate(date)
                }}
                style={{
                  flex: '0 0 auto',
                  padding: '12px 16px',
                  border: '3px solid #000',
                  borderRadius: 999,
                  background: active ? '#000' : '#fff',
                  color: active ? '#fff' : '#000',
                  fontWeight: 900,
                  cursor: 'pointer',
                  fontFamily: 'Arial, Helvetica, sans-serif',
                }}
              >
                {formatDateLabel(date)}
              </button>
            )
          })}
        </div>

        {renderMealSection('OBED')}
        {renderMealSection('VECERA')}

        {message && (
          <div
            style={{
              marginTop: 14,
              background:
                message.includes('Nepodarilo') ||
                message.includes('UZATVORENÉ') ||
                message.includes('BLOKOVANÉ') ||
                message.includes('uzamknutý') ||
                message.includes('vypršal') ||
                message.includes('Server')
                  ? '#f25be6'
                  : '#56db3f',
              border: '3px solid #000',
              borderRadius: 18,
              padding: 14,
              fontWeight: 900,
            }}
          >
            {message}
          </div>
        )}
      </div>
    </main>
  )
}
