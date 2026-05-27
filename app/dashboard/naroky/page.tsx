import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
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

const WEEKDAYS = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne']

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(parseIsoDate(value))
}

function monthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat('sk-SK', {
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
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. - 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Nároky na stravu</div>

        <div style={styles.titleRow}>
          <div>
            <h1 style={styles.title}>Kalendár</h1>
            <p style={styles.name}>
              {user.meno} {user.priezvisko}
            </p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            Späť
          </Link>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryBox}>
            <strong>{dayCount}</strong>
            <span>dní</span>
          </div>

          <div style={styles.summaryBoxPink}>
            <strong>{lunchCount}</strong>
            <span>obed</span>
          </div>

          <div style={styles.summaryBoxGreen}>
            <strong>{dinnerCount}</strong>
            <span>večera</span>
          </div>
        </div>

        <div style={styles.legend}>
          <span><b style={styles.lunchDot} /> Obed</span>
          <span><b style={styles.dinnerDot} /> Večera</span>
          <span><b style={styles.bothDot} /> Obed + večera</span>
        </div>

        {activeRows.length === 0 ? (
          <div style={styles.emptyBox}>
            Zatiaľ nemáš priradené nadchádzajúce nároky na stravu.
          </div>
        ) : (
          <div style={styles.calendarStack}>
            {monthKeys.map(({ year, month }) => {
              const days = buildMonth(year, month, rowsByDate)

              return (
                <section key={`${year}-${month}`} style={styles.monthCard}>
                  <h2 style={styles.monthTitle}>
                    {monthTitle(year, month)}
                  </h2>

                  <div style={styles.weekdays}>
                    {WEEKDAYS.map(day => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>

                  <div style={styles.monthGrid}>
                    {days.map((day, index) => {
                      const hasAny = day.obed || day.vecera
                      const hasBoth = day.obed && day.vecera

                      return (
                        <div
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
                                  {day.obed && <span style={styles.lunchTag}>O</span>}
                                  {day.vecera && <span style={styles.dinnerTag}>V</span>}
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
          <div style={styles.rangeBox}>
            Zobrazené od {formatDate(today)} do {formatDate(lastEntitlementDate)}.
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
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
  card: {
    maxWidth: 880,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16
  },
  title: {
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  name: {
    fontSize: 24,
    fontWeight: 900,
    marginTop: 10
  },
  backButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    fontWeight: 900,
    textDecoration: 'none'
  },
  summaryGrid: {
    marginTop: 24,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12
  },
  summaryBox: {
    border: '3px solid #000',
    borderRadius: 20,
    padding: 16,
    background: '#fff',
    display: 'grid',
    gap: 4,
    justifyItems: 'center'
  },
  summaryBoxPink: {
    border: '3px solid #000',
    borderRadius: 20,
    padding: 16,
    background: '#f25be6',
    display: 'grid',
    gap: 4,
    justifyItems: 'center'
  },
  summaryBoxGreen: {
    border: '3px solid #000',
    borderRadius: 20,
    padding: 16,
    background: '#56db3f',
    display: 'grid',
    gap: 4,
    justifyItems: 'center'
  },
  legend: {
    marginTop: 18,
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'center',
    fontWeight: 900
  },
  lunchDot: {
    display: 'inline-block',
    width: 13,
    height: 13,
    borderRadius: 999,
    background: '#f25be6',
    border: '2px solid #000',
    verticalAlign: 'middle'
  },
  dinnerDot: {
    display: 'inline-block',
    width: 13,
    height: 13,
    borderRadius: 999,
    background: '#56db3f',
    border: '2px solid #000',
    verticalAlign: 'middle'
  },
  bothDot: {
    display: 'inline-block',
    width: 13,
    height: 13,
    borderRadius: 999,
    background: '#000',
    border: '2px solid #000',
    verticalAlign: 'middle'
  },
  emptyBox: {
    marginTop: 24,
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18,
    background: '#f25be6',
    fontSize: 18,
    fontWeight: 900
  },
  calendarStack: {
    marginTop: 22,
    display: 'grid',
    gap: 18
  },
  monthCard: {
    border: '3px solid #000',
    borderRadius: 24,
    padding: 16,
    background: '#fff'
  },
  monthTitle: {
    margin: '0 0 14px',
    fontSize: 28,
    fontWeight: 950,
    textTransform: 'capitalize'
  },
  weekdays: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 6,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 950,
    textAlign: 'center'
  },
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 6
  },
  dayCell: {
    minHeight: 58,
    border: '2px solid #d1d5db',
    borderRadius: 14,
    padding: 7,
    display: 'grid',
    alignContent: 'space-between',
    background: '#f8f8f8',
    fontWeight: 900
  },
  emptyDay: {
    borderColor: 'transparent',
    background: 'transparent'
  },
  activeDay: {
    borderColor: '#000',
    background: '#fff'
  },
  bothDay: {
    boxShadow: 'inset 0 0 0 3px #000'
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
    width: 20,
    height: 20,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f25be6',
    border: '2px solid #000',
    borderRadius: 999,
    padding: 0,
    fontSize: 11,
    lineHeight: 1
  },
  dinnerTag: {
    width: 20,
    height: 20,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#56db3f',
    border: '2px solid #000',
    borderRadius: 999,
    padding: 0,
    fontSize: 11,
    lineHeight: 1
  },
  rangeBox: {
    marginTop: 18,
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 14px',
    display: 'inline-block',
    fontSize: 13,
    fontWeight: 900
  }
}
