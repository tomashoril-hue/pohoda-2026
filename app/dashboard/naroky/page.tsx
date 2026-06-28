import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { appText, localeFor } from '@/lib/i18n'
import { requestLanguage } from '@/lib/i18nServer'
import { supabaseServer } from '@/lib/supabaseServer'

type EntitlementRow = {
  datum: string
  obed: boolean
  vecera: boolean
}

type CalendarDay = {
  iso: string
  day: number
  inMonth: boolean
  obed: boolean
  vecera: boolean
}

const WEEKDAYS_SK = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysIso(iso: string, days: number) {
  const date = parseIsoDate(iso)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDate(value: string, language: 'SK' | 'EN') {
  return new Intl.DateTimeFormat(localeFor(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(parseIsoDate(value))
}

function monthTitle(year: number, month: number, language: 'SK' | 'EN') {
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric'
  }).format(new Date(year, month, 1))
}

function buildMonth(year: number, month: number, rowsByDate: Map<string, EntitlementRow>) {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const mondayOffset = (first.getDay() + 6) % 7
  const days: CalendarDay[] = []

  for (let i = 0; i < mondayOffset; i += 1) {
    days.push({
      iso: '',
      day: 0,
      inMonth: false,
      obed: false,
      vecera: false
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIsoDate(new Date(year, month, day))
    const row = rowsByDate.get(iso)

    days.push({
      iso,
      day,
      inMonth: true,
      obed: !!row?.obed,
      vecera: !!row?.vecera
    })
  }

  while (days.length % 7 !== 0) {
    days.push({
      iso: '',
      day: 0,
      inMonth: false,
      obed: false,
      vecera: false
    })
  }

  return days
}

function getMonthKeys(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  const keys: { year: number; month: number }[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)

  while (cursor <= end) {
    keys.push({ year: cursor.getFullYear(), month: cursor.getMonth() })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return keys
}

export default async function FoodEntitlementsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const language = await requestLanguage(user)
  const copy = appText(language)
  const weekdays = language === 'EN' ? WEEKDAYS_EN : WEEKDAYS_SK
  const today = todayIsoDate()
  const until = addDaysIso(today, 120)

  const { data } = await supabaseServer
    .from('user_food_entitlements')
    .select('datum, obed, vecera')
    .eq('user_id', user.id)
    .gte('datum', today)
    .lte('datum', until)
    .order('datum', { ascending: true })

  const entitlements = (data || []) as EntitlementRow[]
  const activeRows = entitlements.filter(row => row.obed || row.vecera)
  const rowsByDate = new Map(entitlements.map(row => [row.datum, row]))
  const lastEntitlementDate = activeRows[activeRows.length - 1]?.datum || until
  const monthKeys = getMonthKeys(today, lastEntitlementDate)

  const lunchCount = activeRows.filter(row => row.obed).length
  const dinnerCount = activeRows.filter(row => row.vecera).length
  const dayCount = activeRows.length

  return (
    <main className="entitlements-page" style={styles.page}>
      <style>{`
        .entitlements-page a[href],
        .entitlements-page button {
          touch-action: manipulation;
          transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .entitlements-page a[href]:active,
        .entitlements-page button:not(:disabled):active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @media (max-width: 560px) {
          .entitlements-page {
            padding: 10px !important;
          }

          .entitlements-top {
            margin-bottom: 8px !important;
            gap: 8px !important;
            align-items: flex-start !important;
          }

          .entitlements-logo {
            height: 38px !important;
            max-width: 172px !important;
          }

          .entitlements-date {
            display: none !important;
          }

          .entitlements-card {
            padding: 12px !important;
            border-radius: 16px !important;
          }

          .entitlements-title-row {
            margin-bottom: 8px !important;
          }

          .entitlements-title {
            font-size: 25px !important;
            line-height: 1 !important;
          }

          .entitlements-name {
            font-size: 12px !important;
            margin: 5px 0 0 !important;
          }

          .entitlements-summary {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 7px !important;
            margin-top: 10px !important;
          }

          .entitlements-summary-box {
            min-height: 54px !important;
            padding: 7px 5px !important;
            border-radius: 12px !important;
          }

          .entitlements-summary-box strong {
            font-size: 20px !important;
            line-height: 1 !important;
          }

          .entitlements-summary-box span {
            font-size: 10px !important;
            line-height: 1.1 !important;
          }

          .entitlements-legend {
            margin-top: 10px !important;
            gap: 7px !important;
            font-size: 11px !important;
          }

          .entitlements-calendar-stack {
            margin-top: 12px !important;
            gap: 12px !important;
          }

          .entitlements-month {
            padding: 10px !important;
            border-radius: 14px !important;
          }

          .entitlements-month-title {
            font-size: 18px !important;
            margin-bottom: 9px !important;
          }

          .entitlements-weekdays {
            gap: 4px !important;
            font-size: 10px !important;
          }

          .entitlements-month-grid {
            gap: 4px !important;
          }

          .entitlements-day {
            min-height: 40px !important;
            border-radius: 10px !important;
            padding: 4px !important;
            font-size: 12px !important;
          }

          .entitlements-tag {
            width: 16px !important;
            height: 16px !important;
            border-width: 1px !important;
            font-size: 9px !important;
          }

          .entitlements-range {
            margin-top: 12px !important;
            border-radius: 12px !important;
            font-size: 11px !important;
            padding: 8px 10px !important;
          }
        }
      `}</style>

      <div className="entitlements-top" style={styles.topBar}>
        <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
          <img className="entitlements-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        </Link>
        <div style={styles.topActions}>
          <div className="entitlements-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
          <Link href="/dashboard" style={styles.homeButton} title={copy.backToDashboard} aria-label={copy.backToDashboard}>
            <HomeIcon />
          </Link>
        </div>
      </div>

      <section className="entitlements-card" style={styles.card}>
        <div className="entitlements-title-row" style={styles.titleRow}>
          <div>
            <h1 className="entitlements-title" style={styles.title}>{copy.foodEntitlements}</h1>
            <p className="entitlements-name" style={styles.name}>
              {user.meno} {user.priezvisko}
            </p>
          </div>
        </div>

        <div className="entitlements-summary" style={styles.summaryGrid}>
          <div className="entitlements-summary-box" style={styles.summaryBox}>
            <strong>{dayCount}</strong>
            <span>{copy.days}</span>
          </div>

          <div className="entitlements-summary-box" style={styles.summaryBoxPink}>
            <strong>{lunchCount}</strong>
            <span>{copy.lunch}</span>
          </div>

          <div className="entitlements-summary-box" style={styles.summaryBoxGreen}>
            <strong>{dinnerCount}</strong>
            <span>{copy.dinner}</span>
          </div>
        </div>

        <div className="entitlements-legend" style={styles.legend}>
          <span><b style={styles.lunchDot} /> {copy.lunch}</span>
          <span><b style={styles.dinnerDot} /> {copy.dinner}</span>
          <span><b style={styles.bothDot} /> {copy.lunchDinner}</span>
        </div>

        {activeRows.length === 0 ? (
          <div style={styles.emptyBox}>
            {copy.noUpcomingEntitlements}
          </div>
        ) : (
          <div className="entitlements-calendar-stack" style={styles.calendarStack}>
            {monthKeys.map(({ year, month }) => {
              const days = buildMonth(year, month, rowsByDate)

              return (
                <section className="entitlements-month" key={`${year}-${month}`} style={styles.monthCard}>
                  <h2 className="entitlements-month-title" style={styles.monthTitle}>
                    {monthTitle(year, month, language)}
                  </h2>

                  <div className="entitlements-weekdays" style={styles.weekdays}>
                    {weekdays.map(day => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>

                  <div className="entitlements-month-grid" style={styles.monthGrid}>
                    {days.map((day, index) => {
                      const hasAny = day.obed || day.vecera
                      const hasBoth = day.obed && day.vecera

                      return (
                        <div
                          className="entitlements-day"
                          key={day.iso || `empty-${index}`}
                          style={{
                            ...styles.dayCell,
                            ...(day.inMonth ? {} : styles.emptyDay),
                            ...(hasAny ? styles.activeDay : {}),
                            ...(hasBoth ? styles.bothDay : {})
                          }}
                        >
                          {day.inMonth && (
                            <>
                              <strong>{day.day}</strong>
                              {hasAny && (
                                <div style={styles.mealTags}>
                                  {day.obed && <span className="entitlements-tag" style={styles.lunchTag}>O</span>}
                                  {day.vecera && <span className="entitlements-tag" style={styles.dinnerTag}>V</span>}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {activeRows.length > 0 && (
          <div className="entitlements-range" style={styles.rangeBox}>
            {language === 'EN' ? 'Displayed from' : 'Zobrazené od'} {formatDate(today, language)} {language === 'EN' ? 'to' : 'do'} {formatDate(lastEntitlementDate, language)}.
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16
  },
  topActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap'
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
    boxShadow: '0 18px 44px rgba(31, 24, 61, 0.26)'
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6
  },
  title: {
    fontSize: 34,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  name: {
    fontSize: 13,
    fontWeight: 850,
    margin: '7px 0 0',
    color: '#5b5870'
  },
  summaryGrid: {
    marginTop: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8
  },
  summaryBox: {
    border: '1px solid #ded8f2',
    borderRadius: 12,
    padding: '9px 8px',
    background: '#fbfbfd',
    display: 'grid',
    gap: 2,
    justifyItems: 'center',
    minHeight: 62,
    fontWeight: 950
  },
  summaryBoxPink: {
    border: '1px solid #e879f9',
    borderRadius: 12,
    padding: '9px 8px',
    background: '#fdf4ff',
    color: '#86198f',
    display: 'grid',
    gap: 2,
    justifyItems: 'center',
    minHeight: 62,
    fontWeight: 950
  },
  summaryBoxGreen: {
    border: '1px solid #86efac',
    borderRadius: 12,
    padding: '9px 8px',
    background: '#dcfce7',
    color: '#166534',
    display: 'grid',
    gap: 2,
    justifyItems: 'center',
    minHeight: 62,
    fontWeight: 950
  },
  legend: {
    marginTop: 12,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    fontWeight: 900,
    fontSize: 12,
    color: '#374151'
  },
  lunchDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 999,
    background: '#f25be6',
    verticalAlign: 'middle'
  },
  dinnerDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 999,
    background: '#56db3f',
    verticalAlign: 'middle'
  },
  bothDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 999,
    background: '#000',
    verticalAlign: 'middle'
  },
  emptyBox: {
    marginTop: 14,
    border: '1px dashed #d1d5db',
    borderRadius: 12,
    padding: 12,
    background: '#fbfbfd',
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 850
  },
  calendarStack: {
    marginTop: 14,
    display: 'grid',
    gap: 14
  },
  monthCard: {
    border: '1px solid #e1deea',
    borderRadius: 16,
    padding: 12,
    background: '#fbfbfd'
  },
  monthTitle: {
    margin: '0 0 10px',
    fontSize: 22,
    fontWeight: 950,
    textTransform: 'capitalize'
  },
  weekdays: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 5,
    marginBottom: 6,
    fontSize: 11,
    fontWeight: 950,
    textAlign: 'center',
    color: '#6b667c'
  },
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 5
  },
  dayCell: {
    minHeight: 50,
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 6,
    display: 'grid',
    alignContent: 'space-between',
    background: '#fff',
    fontWeight: 900,
    color: '#312b46'
  },
  emptyDay: {
    borderColor: 'transparent',
    background: 'transparent'
  },
  activeDay: {
    borderColor: '#c4b5fd',
    background: '#fff'
  },
  bothDay: {
    boxShadow: 'inset 0 0 0 2px #7417e8'
  },
  mealTags: {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    minWidth: 0
  },
  lunchTag: {
    width: 18,
    height: 18,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f25be6',
    color: '#fff',
    borderRadius: 999,
    padding: 0,
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1
  },
  dinnerTag: {
    width: 18,
    height: 18,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#56db3f',
    color: '#111827',
    borderRadius: 999,
    padding: 0,
    fontSize: 10,
    fontWeight: 950,
    lineHeight: 1
  },
  rangeBox: {
    marginTop: 14,
    background: '#f3f4f6',
    color: '#374151',
    borderRadius: 999,
    padding: '8px 12px',
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 850
  }
}
