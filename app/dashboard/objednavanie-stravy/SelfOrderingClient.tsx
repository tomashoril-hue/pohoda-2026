'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { appText, localeFor, type AppLanguage } from '@/lib/i18n'

type MealType = 'OBED' | 'VECERA'
type FoodType = 'MASO' | 'VEGE' | 'DIETA'

type Entitlement = {
  datum: string
  obed: boolean
  vecera: boolean
}

type Deadline = {
  datum: string
  typ_jedla: MealType
  deadline_at: string | null
  locked: boolean
}

type CalendarDay = {
  datum: string
  obed: boolean
  vecera: boolean
}

function normalizeFood(value: string | null | undefined): FoodType {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIETA'
  return 'MASO'
}

function foodLabel(value: FoodType, language: AppLanguage) {
  if (value === 'MASO') return language === 'EN' ? 'MEAT' : 'MÄSO'
  if (value === 'DIETA') return language === 'EN' ? 'DIET' : 'DIÉTA'
  return 'VEGE'
}

function mealShort(value: MealType) {
  return value === 'OBED' ? 'O' : 'V'
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatWeekday(value: string, language: AppLanguage) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(localeFor(language), {
    weekday: 'short'
  })
}

function formatDay(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('sk-SK', {
    day: 'numeric',
    month: 'numeric'
  })
}

function formatDateTime(value: string | null, language: AppLanguage) {
  if (!value) return ''
  return new Date(value).toLocaleString(localeFor(language), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function bratislavaDefaultDeadline(datum: string, meal: MealType) {
  const d = new Date(`${datum}T12:00:00`)
  d.setDate(d.getDate() - 1)
  d.setHours(meal === 'OBED' ? 16 : 17, 0, 0, 0)
  return d
}

function graceUntil(openedAt: string | null) {
  if (!openedAt) return null
  return new Date(new Date(openedAt).getTime() + 24 * 60 * 60 * 1000)
}

export default function SelfOrderingClient({
  language = 'SK',
  userName,
  defaultFood,
  openedAt,
  orderDates,
  entitlements,
  deadlines
}: {
  language?: AppLanguage
  userName: string
  defaultFood: string
  openedAt: string | null
  completedAt: string | null
  orderDates: string[]
  entitlements: Entitlement[]
  deadlines: Deadline[]
}) {
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const t = (sk: string, en: string) => isEnglish ? en : sk
  const [selectedFood, setSelectedFood] = useState<FoodType>(normalizeFood(defaultFood))
  const initialDays = useMemo<CalendarDay[]>(() => {
    const entitlementByDate = new Map(entitlements.map(item => [item.datum, item]))

    return Array.from(new Set(orderDates))
      .sort()
      .map(datum => {
        const entitlement = entitlementByDate.get(datum)
        return {
          datum,
          obed: !!entitlement?.obed,
          vecera: !!entitlement?.vecera
        }
      })
  }, [entitlements, orderDates])
  const [days, setDays] = useState<CalendarDay[]>(initialDays)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [pressedKey, setPressedKey] = useState('')
  const grace = graceUntil(openedAt)
  const graceActive = grace ? Date.now() <= grace.getTime() : true

  useEffect(() => {
    setDays(initialDays)
  }, [initialDays])

  const deadlineByKey = useMemo(() => {
    return new Map(deadlines.map(item => [`${item.datum}|${item.typ_jedla}`, item]))
  }, [deadlines])

  const isMealLocked = (datum: string, meal: MealType) => {
    if (graceActive) return false

    const deadline = deadlineByKey.get(`${datum}|${meal}`)
    if (deadline?.locked) return true

    const deadlineAt = deadline?.deadline_at
      ? new Date(deadline.deadline_at)
      : bratislavaDefaultDeadline(datum, meal)

    return Date.now() > deadlineAt.getTime()
  }

  const toggleMeal = (datum: string, meal: MealType) => {
    if (isMealLocked(datum, meal)) return

    const key = `${datum}-${meal}`
    setPressedKey(key)
    window.setTimeout(() => setPressedKey(''), 160)
    setDays(current => current.map(day => {
      if (day.datum !== datum) return day
      return meal === 'OBED'
        ? { ...day, obed: !day.obed }
        : { ...day, vecera: !day.vecera }
    }))
  }

  const save = async () => {
    setSaving(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/self-ordering/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultFood: selectedFood,
          days
        })
      })
      const json = await res.json().catch(() => ({ error: t('Server nevrátil platnú odpoveď.', 'The server did not return a valid response.') }))

      if (!res.ok || json.error) throw new Error(json.error || t('Objednávku sa nepodarilo uložiť.', 'The order could not be saved.'))

      if (Array.isArray(json.skipped) && json.skipped.length > 0) {
        setMessage(`${t('Niektoré zmeny sa neuložili:', 'Some changes were not saved:')} ${json.skipped.join(', ')}`)
        setMessageType('error')
      } else {
        setMessage(t('Objednávka bola uložená.', 'Order has been saved.'))
        setMessageType('ok')
      }
    } catch (err: any) {
      setMessage(err?.message || t('Objednávku sa nepodarilo uložiť.', 'The order could not be saved.'))
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="self-order-page" style={styles.page}>
      <style>{`
        .self-order-page button,
        .self-order-page a[href] {
          touch-action: manipulation;
          transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease, background 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .self-order-page button:not(:disabled):active,
        .self-order-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @media (max-width: 560px) {
          .self-order-page {
            padding: 10px !important;
          }

          .self-order-top {
            margin-bottom: 8px !important;
            gap: 8px !important;
            align-items: flex-start !important;
          }

          .self-order-logo {
            height: 38px !important;
            max-width: 172px !important;
          }

          .self-order-date {
            display: none !important;
          }

          .self-order-user {
            font-size: 10px !important;
            padding: 4px 7px !important;
            max-width: min(70vw, 300px) !important;
          }

          .self-order-card {
            padding: 12px !important;
            border-radius: 16px !important;
          }

          .self-order-title {
            font-size: 25px !important;
            line-height: 1 !important;
          }

          .self-order-food {
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 7px !important;
          }

          .self-order-food-button {
            min-height: 38px !important;
            padding: 5px 4px !important;
          }

          .self-order-calendar {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 6px !important;
          }

          .self-order-day {
            padding: 6px !important;
          }

          .self-order-day-date {
            font-size: 14px !important;
          }

          .self-order-save {
            width: 100% !important;
          }
        }
      `}</style>

      <div className="self-order-top" style={styles.topBar}>
        <div style={styles.logoGroup}>
          <div style={styles.logoStack}>
            <img className="self-order-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
            <div className="self-order-user" style={styles.userBadge}>
              {t('Prihlásený:', 'Signed in:')} <b>{userName || '-'}</b>
            </div>
          </div>
          <div className="self-order-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>
        <div style={styles.topControls}>
          <Link href="/dashboard" style={styles.homeButton} title={copy.backToDashboard} aria-label={copy.backToDashboard}>
            <HomeIcon />
          </Link>
        </div>
      </div>

      <section className="self-order-card" style={styles.card}>
        <h1 className="self-order-title" style={styles.title}>{t('Objednaj si stravu', 'Order your meals')}</h1>

        <section style={styles.compactBlock}>
          <div style={styles.blockLabel}>{t('Predvolená strava', 'Default meal')}</div>
          <div className="self-order-food" style={styles.foodGrid}>
            {(['MASO', 'VEGE', 'DIETA'] as FoodType[]).map(food => (
              <button
                key={food}
                className="self-order-food-button"
                type="button"
                onClick={() => setSelectedFood(food)}
                disabled={saving}
                style={{
                  ...styles.foodButton,
                  ...(selectedFood === food ? styles.foodButtonActive : {})
                }}
              >
                <b>{foodLabel(food, language)}</b>
              </button>
            ))}
          </div>
        </section>

        <section style={styles.compactBlock}>
          <div style={styles.blockLabel}>{t('Vyber dni', 'Choose days')}</div>
          {days.length === 0 ? (
            <div style={styles.emptyBox}>{t('Nie sú dostupné dátumy na objednanie.', 'No dates are available for ordering.')}</div>
          ) : (
            <div className="self-order-calendar" style={styles.calendarGrid}>
              {days.map(day => (
                <div key={day.datum} className="self-order-day" style={styles.dayCard}>
                  <div style={styles.dayHeader}>
                    <span>{formatWeekday(day.datum, language)}</span>
                    <b className="self-order-day-date">{formatDay(day.datum)}</b>
                  </div>

                  <div style={styles.mealToggleRow}>
                    {(['OBED', 'VECERA'] as MealType[]).map(meal => {
                      const active = meal === 'OBED' ? day.obed : day.vecera
                      const locked = isMealLocked(day.datum, meal)
                      const disabled = saving || locked
                      const key = `${day.datum}-${meal}`

                      return (
                        <button
                          key={meal}
                          type="button"
                          onClick={() => toggleMeal(day.datum, meal)}
                          disabled={disabled}
                          title={locked ? t('Po uzávierke', 'After deadline') : ''}
                          style={{
                            ...styles.mealToggle,
                            ...(active ? styles.mealToggleActive : {}),
                            ...(pressedKey === key ? styles.mealTogglePressed : {}),
                            ...(disabled ? styles.mealToggleDisabled : {})
                          }}
                        >
                          {mealShort(meal)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={styles.footer}>
          <button className="self-order-save" type="button" onClick={save} disabled={saving || days.length === 0} style={styles.saveButton}>
            {saving ? t('Ukladám...', 'Saving...') : t('Uložiť', 'Save')}
          </button>
          {graceActive ? (
            <span style={styles.smallNote}>
              {grace ? `${t('Bez uzávierky do', 'No deadline until')} ${formatDateTime(grace.toISOString(), language)}` : t('Bez uzávierky pri prvom objednaní', 'No deadline for first ordering')}
            </span>
          ) : (
            <span style={styles.smallNote}>{t('Platia štandardné uzávierky.', 'Standard deadlines apply.')}</span>
          )}
        </div>

        {message && (
          <div
            style={{
              ...styles.message,
              ...(messageType === 'ok' ? styles.messageOk : styles.messageError)
            }}
          >
            {message}
          </div>
        )}
      </section>
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
  topControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8
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
  title: {
    fontSize: 34,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  compactBlock: {
    display: 'grid',
    gap: 7
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    color: '#5b5870'
  },
  foodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8
  },
  foodButton: {
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    padding: '6px 7px',
    background: '#fafafa',
    minHeight: 42,
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontWeight: 950,
    color: '#211b35'
  },
  foodButtonActive: {
    background: '#56db3f',
    borderColor: '#2fb51b',
    boxShadow: '0 6px 14px rgba(47, 181, 27, 0.24)'
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 7
  },
  dayCard: {
    border: '1px solid #e1deea',
    borderRadius: 12,
    padding: 7,
    background: '#fbfbfd',
    display: 'grid',
    gap: 6,
    minWidth: 0
  },
  dayHeader: {
    display: 'grid',
    justifyItems: 'center',
    gap: 1,
    fontWeight: 900,
    fontSize: 10,
    color: '#6b667c',
    textTransform: 'uppercase'
  },
  mealToggleRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4
  },
  mealToggle: {
    minHeight: 27,
    border: '1px solid #d8d5e2',
    borderRadius: 9,
    background: '#fff',
    fontSize: 12,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#312b46'
  },
  mealToggleActive: {
    background: '#56db3f',
    borderColor: '#2fb51b',
    boxShadow: '0 4px 10px rgba(47, 181, 27, 0.22)'
  },
  mealTogglePressed: {
    transform: 'translate(1px, 1px)',
    boxShadow: '0 2px 5px rgba(47, 181, 27, 0.18)'
  },
  mealToggleDisabled: {
    opacity: 0.35,
    filter: 'grayscale(1)',
    cursor: 'not-allowed'
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    borderTop: '1px solid #ebe7f5',
    paddingTop: 10
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
  smallNote: {
    fontSize: 12,
    fontWeight: 850,
    color: '#374151'
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
  emptyBox: {
    border: '1px dashed #d1d5db',
    borderRadius: 12,
    padding: 12,
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 850
  }
}
