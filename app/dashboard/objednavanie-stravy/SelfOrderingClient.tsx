'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { appText, localeFor, type AppLanguage } from '@/lib/i18n'

type MealType = 'OBED' | 'VECERA'
type FoodType = 'MASO' | 'VEGE' | 'DIETA'

type MenuItem = {
  datum: string
  typ_jedla: MealType
  varianta: FoodType
  nazov: string
  popis: string | null
}

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

function foodShort(value: FoodType) {
  if (value === 'MASO') return 'M'
  if (value === 'DIETA') return 'D'
  return 'V'
}

function mealShort(value: MealType) {
  return value === 'OBED' ? 'O' : 'V'
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
  menu,
  entitlements,
  deadlines
}: {
  language?: AppLanguage
  userName: string
  defaultFood: string
  openedAt: string | null
  completedAt: string | null
  menu: MenuItem[]
  entitlements: Entitlement[]
  deadlines: Deadline[]
}) {
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const t = (sk: string, en: string) => isEnglish ? en : sk
  const [selectedFood, setSelectedFood] = useState<FoodType>(normalizeFood(defaultFood))
  const [days, setDays] = useState<CalendarDay[]>(() => {
    const entitlementByDate = new Map(entitlements.map(item => [item.datum, item]))

    return Array.from(new Set(menu.map(item => item.datum)))
      .sort()
      .map(datum => {
        const entitlement = entitlementByDate.get(datum)
        return {
          datum,
          obed: !!entitlement?.obed,
          vecera: !!entitlement?.vecera
        }
      })
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [pressedKey, setPressedKey] = useState('')
  const grace = graceUntil(openedAt)
  const graceActive = grace ? Date.now() <= grace.getTime() : true

  const availableMeals = useMemo(() => {
    const keys = new Set<string>()
    menu.forEach(item => keys.add(`${item.datum}|${item.typ_jedla}`))
    return keys
  }, [menu])

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
    if (!availableMeals.has(`${datum}|${meal}`) || isMealLocked(datum, meal)) return

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
            padding: 12px !important;
          }

          .self-order-top {
            margin-bottom: 10px !important;
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
            font-size: 11px !important;
            padding: 6px 9px !important;
            border-width: 2px !important;
          }

          .self-order-card {
            padding: 14px !important;
            border-radius: 20px !important;
            box-shadow: 6px 6px 0 #000 !important;
          }

          .self-order-title {
            font-size: 30px !important;
            line-height: 0.95 !important;
          }

          .self-order-food {
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 7px !important;
          }

          .self-order-food-button {
            min-height: 48px !important;
            padding: 7px 5px !important;
          }

          .self-order-calendar {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }

          .self-order-day {
            padding: 8px !important;
          }

          .self-order-day-date {
            font-size: 17px !important;
          }

          .self-order-save {
            width: 100% !important;
          }
        }
      `}</style>

      <div className="self-order-top" style={styles.topBar}>
        <div style={styles.logoGroup}>
          <img className="self-order-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
          <div className="self-order-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>
        <div style={styles.topControls}>
          <div className="self-order-user" style={styles.userBadge}>
            {t('Prihlásený:', 'Signed in:')} <b>{userName || '-'}</b>
          </div>
          <Link href="/dashboard" style={styles.backButton}>{copy.back}</Link>
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
                <span>{foodShort(food)}</span>
                <b>{foodLabel(food, language)}</b>
              </button>
            ))}
          </div>
        </section>

        <section style={styles.compactBlock}>
          <div style={styles.blockLabel}>{t('Vyber dni', 'Choose days')}</div>
          {days.length === 0 ? (
            <div style={styles.emptyBox}>{t('Jedálny lístok zatiaľ nie je dostupný.', 'Menu is not available yet.')}</div>
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
                      const available = availableMeals.has(`${day.datum}|${meal}`)
                      const locked = isMealLocked(day.datum, meal)
                      const disabled = saving || !available || locked
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
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: 24,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 18px',
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
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  topControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8
  },
  userBadge: {
    border: '2px solid #000',
    borderRadius: 999,
    background: '#fff',
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 850,
    boxShadow: '2px 2px 0 #000',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  backButton: {
    color: '#fff',
    background: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '8px 12px',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 900,
    boxShadow: '2px 2px 0 #000'
  },
  card: {
    maxWidth: 680,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 22,
    boxShadow: '10px 10px 0 #000',
    display: 'grid',
    gap: 14
  },
  title: {
    fontSize: 42,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  compactBlock: {
    display: 'grid',
    gap: 8
  },
  blockLabel: {
    fontSize: 13,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  foodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 9
  },
  foodButton: {
    border: '3px solid #000',
    borderRadius: 14,
    padding: '8px 7px',
    background: '#fff',
    minHeight: 54,
    display: 'grid',
    alignItems: 'center',
    justifyItems: 'center',
    gap: 1,
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontWeight: 950
  },
  foodButtonActive: {
    background: '#56db3f',
    boxShadow: '4px 4px 0 #000'
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 9
  },
  dayCard: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: 9,
    background: '#f9fafb',
    display: 'grid',
    gap: 8
  },
  dayHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    fontWeight: 900,
    fontSize: 12,
    color: '#374151'
  },
  mealToggleRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 7
  },
  mealToggle: {
    minHeight: 40,
    border: '3px solid #000',
    borderRadius: 12,
    background: '#fff',
    fontSize: 18,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  mealToggleActive: {
    background: '#56db3f',
    boxShadow: '3px 3px 0 #000'
  },
  mealTogglePressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: '1px 1px 0 #000'
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
    borderTop: '2px solid #000',
    paddingTop: 12
  },
  saveButton: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '11px 18px',
    background: '#7417e8',
    color: '#fff',
    fontSize: 15,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif',
    boxShadow: '4px 4px 0 #000'
  },
  smallNote: {
    fontSize: 12,
    fontWeight: 850,
    color: '#374151'
  },
  message: {
    border: '2px solid',
    borderRadius: 14,
    padding: 11,
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
    border: '2px dashed #d1d5db',
    borderRadius: 14,
    padding: 14,
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 850
  }
}
