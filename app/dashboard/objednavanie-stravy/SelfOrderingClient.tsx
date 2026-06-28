'use client'

import { useMemo, useState } from 'react'
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

function mealLabel(value: MealType, language: AppLanguage) {
  return value === 'OBED'
    ? (language === 'EN' ? 'Lunch' : 'Obed')
    : (language === 'EN' ? 'Dinner' : 'Večera')
}

function formatDate(value: string, language: AppLanguage) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(localeFor(language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
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

function graceUntil(openedAt: string | null) {
  if (!openedAt) return null
  return new Date(new Date(openedAt).getTime() + 24 * 60 * 60 * 1000)
}

export default function SelfOrderingClient({
  language = 'SK',
  userName,
  defaultFood,
  openedAt,
  completedAt,
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
  const [days, setDays] = useState(() => {
    const entitlementByDate = new Map(entitlements.map(item => [item.datum, item]))

    return Array.from(new Set(menu.map(item => item.datum))).map(datum => {
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

  const menuByDateMeal = useMemo(() => {
    const map = new Map<string, MenuItem[]>()

    menu.forEach(item => {
      const key = `${item.datum}|${item.typ_jedla}`
      map.set(key, [...(map.get(key) || []), item])
    })

    return map
  }, [menu])

  const deadlineByDateMeal = useMemo(() => {
    return new Map(deadlines.map(item => [`${item.datum}|${item.typ_jedla}`, item]))
  }, [deadlines])

  const toggleMeal = (datum: string, meal: MealType) => {
    const key = `${datum}-${meal}`
    setPressedKey(key)
    window.setTimeout(() => setPressedKey(''), 180)
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
        setMessage(`${t('Časť zmien sa neuložila:', 'Some changes were not saved:')} ${json.skipped.join(', ')}`)
        setMessageType('error')
      } else {
        setMessage(t('Objednávka stravy bola uložená.', 'Meal order has been saved.'))
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
    <main style={styles.page}>
      <style>{`
        .self-ordering button,
        .self-ordering a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
          -webkit-tap-highlight-color: rgba(116, 23, 232, 0.22);
        }
        .self-ordering button:not(:disabled):active,
        .self-ordering a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
        }
        @media (max-width: 720px) {
          .self-ordering { padding: 12px !important; }
          .self-ordering-card { padding: 16px !important; border-radius: 20px !important; box-shadow: 6px 6px 0 #000 !important; }
          .self-ordering-title { font-size: 28px !important; }
          .self-ordering-days { grid-template-columns: 1fr !important; }
          .self-ordering-top { flex-direction: column !important; align-items: stretch !important; }
        }
      `}</style>

      <section className="self-ordering self-ordering-card" style={styles.card}>
        <div style={styles.topBar}>
          <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
          <Link href="/dashboard" style={styles.homeButton}>{copy.backToDashboard}</Link>
        </div>

        <div className="self-ordering-top" style={styles.hero}>
          <div>
            <div style={styles.kicker}>{t('Samostatné objednávanie stravy', 'Self meal ordering')}</div>
            <h1 className="self-ordering-title" style={styles.title}>{t('Objednaj si stravu', 'Order your meals')}</h1>
            <p style={styles.subtitle}>
              {userName ? `${userName} · ` : ''}
              {completedAt
                ? t('Objednávku môžeš upraviť, ak ešte neprešla uzávierka.', 'You can adjust the order if the deadline has not passed.')
                : t('Vyber si predvolenú stravu a označ dni, kedy chceš obed alebo večeru.', 'Choose your default meal type and select days when you want lunch or dinner.')}
            </p>
          </div>

          <div style={graceActive ? styles.graceBadge : styles.closedBadge}>
            {graceActive
              ? `${t('Prvých 24 hodín bez uzávierky', 'First 24 hours ignore deadlines')}${grace ? ` · ${formatDateTime(grace.toISOString(), language)}` : ''}`
              : t('Platia už štandardné uzávierky', 'Standard deadlines apply now')}
          </div>
        </div>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>{t('Predvolená strava', 'Default meal type')}</div>
          <div style={styles.foodGrid}>
            {(['MASO', 'VEGE', 'DIETA'] as FoodType[]).map(food => (
              <button
                key={food}
                type="button"
                onClick={() => setSelectedFood(food)}
                disabled={saving}
                style={{
                  ...styles.foodButton,
                  ...(selectedFood === food ? styles.foodButtonActive : {})
                }}
              >
                {foodLabel(food, language)}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>{t('Dni a jedlá', 'Days and meals')}</div>
          {days.length === 0 ? (
            <div style={styles.emptyBox}>{t('Jedálny lístok zatiaľ nie je dostupný.', 'Menu is not available yet.')}</div>
          ) : (
            <div className="self-ordering-days" style={styles.daysGrid}>
              {days.map(day => (
                <div key={day.datum} style={styles.dayCard}>
                  <div>
                    <b>{formatDate(day.datum, language)}</b>
                    <span style={styles.dateSmall}>{day.datum}</span>
                  </div>

                  {(['OBED', 'VECERA'] as MealType[]).map(meal => {
                    const active = meal === 'OBED' ? day.obed : day.vecera
                    const key = `${day.datum}-${meal}`
                    const items = menuByDateMeal.get(`${day.datum}|${meal}`) || []
                    const deadline = deadlineByDateMeal.get(`${day.datum}|${meal}`)

                    return (
                      <button
                        key={meal}
                        type="button"
                        onClick={() => toggleMeal(day.datum, meal)}
                        disabled={saving || items.length === 0}
                        style={{
                          ...styles.mealButton,
                          ...(active ? styles.mealButtonActive : {}),
                          ...(pressedKey === key ? styles.mealButtonPressed : {})
                        }}
                      >
                        <span>
                          <b>{mealLabel(meal, language)}</b>
                          <small>{items.length > 0 ? items.map(item => `${foodLabel(item.varianta, language)}: ${item.nazov}`).join(' / ') : t('Nie je v jedálnom lístku', 'Not in menu')}</small>
                        </span>
                        <em>{active ? t('Objednané', 'Ordered') : t('Neobjednané', 'Not ordered')}</em>
                        {!graceActive && deadline?.deadline_at && <small>{t('Uzávierka', 'Deadline')}: {formatDateTime(deadline.deadline_at, language)}</small>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={styles.footer}>
          <button type="button" onClick={save} disabled={saving || days.length === 0} style={styles.saveButton}>
            {saving ? t('Ukladám...', 'Saving...') : t('Uložiť objednávku', 'Save order')}
          </button>
          <Link href="/menu" style={styles.secondaryButton}>{t('Výber stravy', 'Meal selection')}</Link>
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

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f6f2ff',
    padding: 20,
    color: '#111',
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  card: {
    maxWidth: 1060,
    margin: '0 auto',
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 24,
    boxShadow: '8px 8px 0 #000',
    padding: 22,
    display: 'grid',
    gap: 18
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  logo: {
    height: 48,
    maxWidth: 220
  },
  homeButton: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '9px 14px',
    background: '#fff',
    color: '#000',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start'
  },
  kicker: {
    display: 'inline-flex',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 11px',
    fontSize: 12,
    fontWeight: 950,
    marginBottom: 10
  },
  title: {
    margin: 0,
    fontSize: 42,
    lineHeight: 1,
    fontWeight: 950
  },
  subtitle: {
    margin: '8px 0 0',
    color: '#374151',
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.45
  },
  graceBadge: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    background: '#fff176',
    fontSize: 12,
    fontWeight: 950,
    maxWidth: 280
  },
  closedBadge: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    background: '#f3f4f6',
    fontSize: 12,
    fontWeight: 950,
    maxWidth: 280
  },
  section: {
    display: 'grid',
    gap: 10
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 950
  },
  foodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 10
  },
  foodButton: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: '14px 12px',
    background: '#fff',
    fontSize: 18,
    fontWeight: 950
  },
  foodButtonActive: {
    background: '#56db3f',
    boxShadow: '5px 5px 0 #000'
  },
  daysGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 12
  },
  dayCard: {
    border: '3px solid #000',
    borderRadius: 18,
    padding: 12,
    background: '#f9fafb',
    display: 'grid',
    gap: 9
  },
  dateSmall: {
    display: 'block',
    marginTop: 2,
    fontSize: 12,
    fontWeight: 850,
    color: '#6b7280'
  },
  mealButton: {
    border: '2px solid #111',
    borderRadius: 14,
    padding: 10,
    background: '#fff',
    textAlign: 'left',
    display: 'grid',
    gap: 5,
    fontSize: 13,
    fontWeight: 900
  },
  mealButtonActive: {
    background: '#dcfce7',
    boxShadow: '4px 4px 0 #000'
  },
  mealButtonPressed: {
    transform: 'translate(3px, 3px)',
    boxShadow: '1px 1px 0 #000'
  },
  footer: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap'
  },
  saveButton: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    background: '#7417e8',
    color: '#fff',
    fontSize: 15,
    fontWeight: 950
  },
  secondaryButton: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    background: '#fff',
    color: '#000',
    fontSize: 15,
    fontWeight: 950,
    textDecoration: 'none'
  },
  message: {
    border: '2px solid',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.4
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
    padding: 16,
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 850
  }
}
