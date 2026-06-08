import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import DashboardInvites from './DashboardInvites'
import DashboardDatePicker from './DashboardDatePicker'

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${value}T12:00:00`))
  } catch {
    return value
  }
}

function normalizeDateParam(value: string | string[] | undefined, fallback: string) {
  const rawValue = Array.isArray(value) ? value[0] : value

  if (!rawValue || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return fallback
  }

  const parsed = new Date(`${rawValue}T12:00:00`)

  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }

  return rawValue
}

function mealLabel(value: string) {
  if (value === 'OBED') return 'OBED'
  if (value === 'VECERA') return 'VEČERA'
  return value
}

function choiceLabel(value: string | null | undefined, defaultValue?: string | null) {
  if (value === 'BEZ_ZAUJMU') return 'ODHLÁSENÉ'
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  if (isDietFood(value)) return 'DIÉTA'

  if (defaultValue === 'MASO') return 'PREDVOLENÉ MASO'
  if (defaultValue === 'VEGE') return 'PREDVOLENÉ VEGE'
  if (isDietFood(defaultValue)) return 'PREDVOLENÁ DIÉTA'

  return 'NEZADANÉ'
}

function isDietFood(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'DIETA' || normalized === 'DIÉTA'
}

function menuVariantLabel(value: string | null | undefined) {
  return isDietFood(value) ? 'DIÉTA' : value
}

function entitlementLabel(value: boolean | null | undefined, hasRow: boolean) {
  if (!hasRow) return 'NEZNÁME'
  return value ? 'ÁNO' : 'NIE'
}

function issuedLabel(status: string | null | undefined) {
  if (status === 'VYDANE') return 'VYDANÉ'
  if (status === 'STORNOVANE') return 'STORNOVANÉ'
  return 'NEVYDANÉ'
}

function bulkLabel(value: any) {
  if (!value) return 'NIE'

  if (value.status === 'PLANNED') return 'PRIPRAVENÝ'
  if (value.status === 'REMOVED') return 'VYRADENÝ'
  if (value.status === 'INDIVIDUAL_ISSUED') return 'PREVZAL OSOBNE'
  if (value.status === 'BULK_ISSUED') return 'VYDANÉ HROMADNE'

  return value.status || 'NIE'
}

function activeRegistrationGroupName(period: any, fallbackGroup: any) {
  const group = Array.isArray(period?.registration_groups)
    ? period.registration_groups[0]
    : period?.registration_groups

  if (group?.name) return group.name
  if (fallbackGroup?.name) return fallbackGroup.name

  return '-'
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ datum?: string | string[] | undefined }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const today = todayIsoDate()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const selectedDate = normalizeDateParam(resolvedSearchParams.datum, today)
  const isTodaySelected = selectedDate === today

  const { data: memberships } = await supabaseServer
    .from('group_members')
    .select(`
      role,
      group_id,
      groups (
        id,
        name
      )
    `)
    .eq('user_id', user.id)

  const { data: pendingInvites } = await supabaseServer
    .from('group_invites')
    .select(`
      id,
      email,
      status,
      created_at,
      groups (
        id,
        name
      )
    `)
    .eq('email', String(user.email || '').toLowerCase())
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })

  const { data: activeRegistrationPeriod } = await supabaseServer
    .from('user_registration_group_periods')
    .select(`
      registration_group_id,
      valid_from,
      valid_to,
      registration_groups (
        name
      )
    `)
    .eq('user_id', user.id)
    .lte('valid_from', selectedDate)
    .or(`valid_to.is.null,valid_to.gte.${selectedDate}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: fallbackRegistrationGroup } = user.registration_group_id
    ? await supabaseServer
      .from('registration_groups')
      .select('name')
      .eq('id', user.registration_group_id)
      .maybeSingle()
    : { data: null }

  const { data: entitlement } = await supabaseServer
    .from('user_food_entitlements')
    .select('datum, obed, vecera')
    .eq('user_id', user.id)
    .eq('datum', selectedDate)
    .maybeSingle()

  const { data: selections } = await supabaseServer
    .from('vyber_jedal')
    .select('typ_jedla, volba')
    .eq('user_id', user.id)
    .eq('datum', selectedDate)

  const { data: menuItems } = await supabaseServer
    .from('jedalny_listok')
    .select('typ_jedla, varianta, nazov, popis')
    .eq('datum', selectedDate)
    .eq('aktivne', true)
    .order('typ_jedla', { ascending: true })
    .order('poradie', { ascending: true })

  const { data: issuedMeals } = await supabaseServer
    .from('vydaj_jedal')
    .select('typ_jedla, status, sposob, issued_at')
    .eq('user_id', user.id)
    .eq('datum', selectedDate)
    .order('issued_at', { ascending: false })

  const { data: bulkItems } = await supabaseServer
    .from('hromadny_vydaj_polozky')
    .select(`
      id,
      status,
      hromadne_vydaje (
        id,
        datum,
        typ_jedla,
        status,
        group_id,
        groups (
          name
        )
      )
    `)
    .eq('user_id', user.id)
    .in('status', ['PLANNED', 'REMOVED', 'INDIVIDUAL_ISSUED', 'BULK_ISSUED'])

  const hasMembership = !!memberships && memberships.length > 0
  const hasPendingInvites = !!pendingInvites && pendingInvites.length > 0
  const hasEntitlementRow = !!entitlement
  const registrationGroupName = activeRegistrationGroupName(activeRegistrationPeriod, fallbackRegistrationGroup)
  const globalAccess = await getGlobalAccess(user.id)
  const canOpenPersonalista = globalAccess.canUsePersonalista
  const canOpenFoodIssue = globalAccess.canUseFoodIssue
  const canOpenMenuDeadline = globalAccess.isAdmin

  const getSelection = (typJedla: string) => {
    return (selections || []).find((item: any) => item.typ_jedla === typJedla)
  }

  const getMenuText = (typJedla: string, showDiet: boolean) => {
    const items = (menuItems || []).filter((item: any) => {
      const variant = String(item.varianta || '').trim().toUpperCase()

      return (
        item.typ_jedla === typJedla &&
        (variant === 'MASO' || variant === 'VEGE' || (showDiet && isDietFood(variant)))
      )
    })

    if (!items.length) return 'Jedlo nie je zadané'

    return items
      .map((item: any) => `${menuVariantLabel(item.varianta)}: ${item.nazov}`)
      .join('\n')
  }

  const getIssued = (typJedla: string) => {
    return (issuedMeals || []).find((item: any) => {
      return item.typ_jedla === typJedla && item.status === 'VYDANE'
    })
  }

  const getBulk = (typJedla: string) => {
    return (bulkItems || []).find((item: any) => {
      const issue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      return (
        issue?.datum === selectedDate &&
        issue?.typ_jedla === typJedla &&
        (issue?.status === 'READY' || issue?.status === 'WAITING')
      )
    })
  }

  const obedSelection = getSelection('OBED')
  const veceraSelection = getSelection('VECERA')
  const defaultFood = user.typ_stravy || user.typStravy || null
  const showDiet = isDietFood(defaultFood)

  const todayMeals = [
    {
      typJedla: 'OBED',
      entitlement: entitlementLabel(entitlement?.obed, hasEntitlementRow),
      selection: obedSelection,
      menuText: getMenuText('OBED', showDiet),
      issued: getIssued('OBED'),
      bulk: getBulk('OBED')
    },
    {
      typJedla: 'VECERA',
      entitlement: entitlementLabel(entitlement?.vecera, hasEntitlementRow),
      selection: veceraSelection,
      menuText: getMenuText('VECERA', showDiet),
      issued: getIssued('VECERA'),
      bulk: getBulk('VECERA')
    }
  ]

  return (
    <main className="dashboard-page" style={styles.page}>
      <style>{`
        .dashboard-page button,
        .dashboard-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .dashboard-page button:not(:disabled):active,
        .dashboard-page a[href]:active {
          transform: scale(0.97);
          filter: brightness(0.92);
          box-shadow: 0 0 0 3px rgba(86, 219, 63, 0.28) !important;
        }

        .dashboard-page button:disabled {
          cursor: wait;
          opacity: 0.72;
        }

        @media (max-width: 720px) {
          .dashboard-page { padding: 12px !important; }
          .dashboard-top-bar { margin-bottom: 12px !important; gap: 10px !important; }
          .dashboard-logo { height: 42px !important; max-width: 190px !important; }
          .dashboard-date { font-size: 12px !important; padding: 7px 10px !important; }
          .dashboard-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .dashboard-badge { display: none !important; }
          .dashboard-title { font-size: 34px !important; }
          .dashboard-name { font-size: 20px !important; margin-top: 6px !important; }
          .dashboard-logout { min-width: 0 !important; height: 38px !important; padding: 0 13px !important; font-size: 12px !important; box-shadow: 3px 3px 0 #000 !important; }
          .dashboard-info { margin-top: 14px !important; padding: 12px !important; font-size: 13px !important; line-height: 1.35 !important; }
          .dashboard-info p { margin: 4px 0 !important; }
          .dashboard-today-box { border: 0 !important; background: transparent !important; padding: 0 !important; margin-top: 18px !important; }
          .dashboard-today-title { font-size: 22px !important; }
          .dashboard-date-picker { font-size: 12px !important; padding: 7px 10px !important; }
          .dashboard-today-meal { border: 2px solid rgba(0,0,0,0.24) !important; background: rgba(255,255,255,0.9) !important; border-radius: 18px !important; padding: 12px !important; }
          .dashboard-meal-title { font-size: 18px !important; }
          .dashboard-entitlement { border-width: 2px !important; font-size: 10px !important; padding: 5px 8px !important; }
          .dashboard-meal-choice { padding: 10px !important; }
        }
      `}</style>
      <div className="dashboard-top-bar" style={styles.topBar}>
        <a href="/dashboard" style={styles.logoLink} aria-label="Späť na dashboard">
          <img className="dashboard-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        </a>
        <div className="dashboard-date" style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section className="dashboard-card" style={styles.card}>
        <div style={styles.titleRow}>
          <div>
            <h1 className="dashboard-title" style={styles.title}>Vitaj</h1>

            <p className="dashboard-name" style={styles.name}>
              {user.meno} {user.priezvisko}
            </p>
          </div>

          <a className="dashboard-logout" href="/logout" style={styles.logoutCircle} title="Odhlásiť sa">
            Odhlásiť
          </a>
        </div>

        <div className="dashboard-info" style={styles.infoBox}>
          <p><b>E-mail:</b> {user.email || '-'}</p>
          <p><b>Registračná skupina:</b> {registrationGroupName}</p>
          <p><b>Typ stravy:</b> {menuVariantLabel(defaultFood) || '-'}</p>
        </div>

        <section className="dashboard-today-box" style={styles.todayBox}>
          <div style={styles.todayHeader}>
            <div>
              <div style={styles.todaySmall}>{isTodaySelected ? 'Dnes' : 'Vybraný deň'}</div>
              <h2 className="dashboard-today-title" style={styles.todayTitle}>
                {isTodaySelected ? 'Dnešná strava' : 'Strava na deň'}
              </h2>
            </div>

            <DashboardDatePicker
              selectedDate={selectedDate}
              today={today}
              formattedDate={formatDate(selectedDate)}
            />
          </div>

          <div style={styles.todayGrid}>
            {todayMeals.map(meal => {
              const bulkIssue = meal.bulk
              const issue = bulkIssue
                ? Array.isArray(bulkIssue.hromadne_vydaje)
                  ? bulkIssue.hromadne_vydaje[0]
                  : bulkIssue.hromadne_vydaje
                : null

              const group = issue?.groups
                ? Array.isArray(issue.groups)
                  ? issue.groups[0]
                  : issue.groups
                : null

              const entitlementIsYes = meal.entitlement === 'ÁNO'
              const entitlementIsNo = meal.entitlement === 'NIE'
              const issuedText = issuedLabel(meal.issued?.status)
              const noInterest = meal.selection?.volba === 'BEZ_ZAUJMU'

              return (
                <div
                  className="dashboard-today-meal"
                  key={meal.typJedla}
                  style={{
                    ...styles.todayMealCard,
                    ...(noInterest ? styles.todayMealCardNoInterest : {})
                  }}
                >
                  <div style={styles.todayMealTop}>
                    <h3 className="dashboard-meal-title" style={styles.todayMealTitle}>
                      {mealLabel(meal.typJedla)}
                    </h3>

                    <span
                      className="dashboard-entitlement"
                      style={{
                        ...styles.entitlementBadge,
                        background: entitlementIsYes
                          ? '#56db3f'
                          : entitlementIsNo
                            ? '#f25be6'
                            : '#fff3bf'
                      }}
                    >
                      Nárok {meal.entitlement}
                    </span>
                  </div>

                  <div style={styles.todayRows}>
                    <div
                      className="dashboard-meal-choice"
                      style={{
                        ...styles.todayChoiceBox,
                        ...(noInterest ? styles.todayChoiceBoxNoInterest : {})
                      }}
                    >
                      <span style={styles.todayChoiceLabel}>Môj výber</span>
                      <b style={noInterest ? styles.noInterestChoice : styles.todayChoiceValue}>
                        {choiceLabel(meal.selection?.volba, defaultFood)}
                      </b>
                    </div>

                    <div style={styles.todayRowWide}>
                      <span>Jedlo</span>
                      <b style={styles.todayMenuText}>{meal.menuText}</b>
                    </div>

                    <div style={styles.todayRow}>
                      <span>Hromadný výdaj</span>
                      <b>
                        {bulkLabel(bulkIssue)}
                        {group?.name ? ` · ${group.name}` : ''}
                      </b>
                    </div>

                    <div style={styles.todayRow}>
                      <span>Výdaj</span>
                      <b>{issuedText}</b>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <div style={styles.menuGrid}>
          <Link href="/dashboard/naroky" style={styles.menuButtonGreen}>Nároky na stravu</Link>
          <a href="/menu" style={styles.menuButton}>Môj výber</a>
          <a href="/dashboard/qr" style={styles.menuButton}>Môj QR kód</a>
          <Link href="/dashboard/groups" style={styles.menuButtonPink}>Skupiny</Link>
          {canOpenFoodIssue && (
            <Link href="/dashboard/vydaj-stravy" style={styles.menuButtonGreen}>Výdaj stravy</Link>
          )}
          {canOpenPersonalista && (
            <Link href="/dashboard/personalista" style={styles.menuButtonGreen}>Personalista</Link>
          )}
          {canOpenMenuDeadline && (
            <a href="/admin/menu" style={styles.menuButtonGreen}>Menu deadline</a>
          )}
        </div>

        <div style={styles.groupsBox}>
          <h2 style={styles.groupsTitle}>Moje skupiny</h2>

          {!hasMembership ? (
            <>
              <div style={styles.emptyGroup}>
                Zatiaľ nie si v žiadnej skupine.
              </div>

              {hasPendingInvites && (
                <DashboardInvites invites={pendingInvites || []} />
              )}
            </>
          ) : (
            <>
              {hasPendingInvites && (
                <DashboardInvites invites={pendingInvites || []} />
              )}

              <div style={styles.groupsList}>
                {memberships.map((m: any) => {
                  const group = Array.isArray(m.groups) ? m.groups[0] : m.groups
                  const role = String(m.role || '').toUpperCase()

                  const canOpenIssue = role === 'MANAGER' || role === 'POVERENY'

                  return (
                    <div key={m.group_id} style={styles.groupCard}>
                      <div>
                        <div style={styles.groupName}>
                          {group?.name || 'Skupina bez názvu'}
                        </div>

                        <div style={styles.roleBadge}>
                          {role}
                        </div>
                      </div>

                      <div style={styles.groupActions}>
                        <a href={`/dashboard/groups/${m.group_id}`} style={styles.smallButton}>
                          Detail
                        </a>

                        {canOpenIssue && (
                          <a href={`/dashboard/groups/${m.group_id}/issue`} style={styles.smallButtonPink}>
                            Hromadný výdaj
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
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
  logoLink: {
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none'
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
    maxWidth: 760,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16
  },
  logoutCircle: {
    width: 'auto',
    height: 46,
    minWidth: 96,
    borderRadius: 999,
    background: '#000',
    color: '#56db3f',
    border: '3px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    fontSize: 14,
    fontWeight: 900,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000'
  },
  title: {
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  name: {
    fontSize: 26,
    fontWeight: 900,
    marginTop: 10
  },
  infoBox: {
    marginTop: 24,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 14,
    fontSize: 15,
    fontWeight: 700
  },
  todayBox: {
    marginTop: 24,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 24,
    padding: 18
  },
  todayHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap'
  },
  todaySmall: {
    fontSize: 13,
    fontWeight: 900,
    opacity: 0.65
  },
  todayTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 950
  },
  todayDate: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 900
  },
  todayGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12
  },
  todayMealCard: {
    border: '2px solid rgba(0,0,0,0.28)',
    borderRadius: 20,
    padding: 14,
    background: '#fbfbfb'
  },
  todayMealCardNoInterest: {
    borderColor: 'rgba(239,68,68,0.45)',
    background: '#fff7f7'
  },
  todayMealTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12
  },
  todayMealTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 950
  },
  entitlementBadge: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  todayRows: {
    display: 'grid',
    gap: 10
  },
  todayChoiceBox: {
    display: 'grid',
    gap: 5,
    background: '#f1f5f9',
    borderRadius: 14,
    padding: 12
  },
  todayChoiceBoxNoInterest: {
    background: '#fee2e2'
  },
  todayChoiceLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: 900
  },
  todayChoiceValue: {
    fontSize: 18,
    fontWeight: 950
  },
  todayRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 10,
    alignItems: 'center',
    color: '#334155',
    fontSize: 14
  },
  todayRowWide: {
    display: 'grid',
    gap: 4,
    color: '#334155',
    fontSize: 14
  },
  todayMenuText: {
    color: '#000',
    whiteSpace: 'pre-line',
    lineHeight: 1.35
  },
  noInterestChoice: {
    display: 'inline-block',
    background: '#ef4444',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '4px 9px',
    fontWeight: 950
  },
  menuGrid: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  menuButton: {
    display: 'block',
    textAlign: 'center',
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  menuButtonPink: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  menuButtonGreen: {
    display: 'block',
    textAlign: 'center',
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  groupsBox: {
    marginTop: 30,
    border: '3px solid #000',
    borderRadius: 24,
    padding: 18,
    background: '#fff'
  },
  groupsTitle: {
    margin: '0 0 14px 0',
    fontSize: 28,
    fontWeight: 900
  },
  emptyGroup: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 900
  },
  groupsList: {
    display: 'grid',
    gap: 14
  },
  groupCard: {
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    background: '#fff',
    display: 'grid',
    gap: 14
  },
  groupName: {
    fontSize: 22,
    fontWeight: 900
  },
  roleBadge: {
    display: 'inline-block',
    marginTop: 8,
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '6px 12px',
    fontWeight: 900,
    fontSize: 13
  },
  groupActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10
  },
  smallButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  },
  smallButtonGreen: {
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  },
  smallButtonPink: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  }
}
