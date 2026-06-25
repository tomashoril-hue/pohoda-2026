import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { getLegacyBulkIssueEnabled } from '@/lib/appSettings'
import { getGlobalAccess } from '@/lib/globalRoles'
import { PRIVACY_POLICY_URL } from '@/lib/privacyConsentConfig'
import { canUseGroupIssue, getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
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
  if (value === 'MASO') return 'MÄSO'
  if (value === 'VEGE') return 'VEGE'
  if (isDietFood(value)) return 'DIÉTA'

  if (defaultValue === 'MASO') return 'PREDVOLENÉ: MÄSO'
  if (defaultValue === 'VEGE') return 'PREDVOLENÉ: VEGE'
  if (isDietFood(defaultValue)) return 'PREDVOLENÉ: DIÉTA'

  return 'PREDVOLENÉ: BEZ STRAVY'
}

function isDietFood(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'DIETA' || normalized === 'DIÉTA'
}

function menuVariantLabel(value: string | null | undefined) {
  return isDietFood(value) ? 'DIÉTA' : value
}

function entitlementLabel(value: boolean | null | undefined) {
  return value ? 'ÁNO' : 'NIE'
}

function activeRegistrationGroupName(period: any, fallbackGroup: any) {
  const group = Array.isArray(period?.registration_groups)
    ? period.registration_groups[0]
    : period?.registration_groups

  if (group?.name) return group.name
  if (fallbackGroup?.name) return fallbackGroup.name

  return '-'
}

function fullName(person: any) {
  return `${person?.meno || ''} ${person?.priezvisko || ''}`.trim()
}

function relationOne(value: any) {
  return Array.isArray(value) ? value[0] : value
}

function issueGroupName(issue: any) {
  const group = relationOne(issue?.registration_groups || issue?.groups)
  return group?.name || ''
}

function issueTitle(issue: any) {
  return issue?.title || issueGroupName(issue)
}

function formatTime(value: string | null | undefined) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Bratislava'
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function mealState({
  entitlement,
  hasEntitlementRow,
  noInterest,
  issued,
  legacyBulkItem,
  registrationBulkItem,
  issuedGroup,
  issuedRegistrationIssue
}: {
  entitlement: string
  hasEntitlementRow: boolean
  noInterest: boolean
  issued: any
  legacyBulkItem: any
  registrationBulkItem: any
  issuedGroup: any
  issuedRegistrationIssue: any
}) {
  if (issued?.status === 'VYDANE') {
    if (issued.sposob === 'HROMADNE' && issued.registration_group_issue_id) {
      return {
        label: 'Vydané skupinovo',
        detail: issueTitle(issuedRegistrationIssue),
        tone: 'issued'
      }
    }

    if (issued.sposob === 'HROMADNE') {
      return {
        label: 'Vydané hromadne',
        detail: issuedGroup?.name || '',
        tone: 'issued'
      }
    }

    return { label: 'Vydané osobne', detail: '', tone: 'issued' }
  }

  if (entitlement === 'NIE' && hasEntitlementRow) {
    return { label: 'Bez nároku', detail: '', tone: 'blocked' }
  }

  if (noInterest) {
    return { label: 'Odhlásené', detail: 'Jedlo je odhlásené vo výbere.', tone: 'blocked' }
  }

  const registrationIssue = relationOne(registrationBulkItem?.registration_group_issues)
  if (registrationIssue && (registrationIssue.status === 'READY' || registrationIssue.status === 'WAITING')) {
    return {
      label: registrationBulkItem.status === 'REMOVED' ? 'Vyradené zo skupinového výdaja' : 'Pripravené skupinovo',
      detail: issueTitle(registrationIssue),
      tone: registrationBulkItem.status === 'REMOVED' ? 'blocked' : 'prepared'
    }
  }

  const legacyIssue = relationOne(legacyBulkItem?.hromadne_vydaje)
  if (legacyIssue && (legacyIssue.status === 'READY' || legacyIssue.status === 'WAITING')) {
    return {
      label: legacyBulkItem.status === 'REMOVED' ? 'Vyradené z hromadného výdaja' : 'Pripravené hromadne',
      detail: issueGroupName(legacyIssue),
      tone: legacyBulkItem.status === 'REMOVED' ? 'blocked' : 'prepared'
    }
  }

  return { label: 'Nevydané', detail: '', tone: 'neutral' }
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
  const globalAccess = await getGlobalAccess(user.id)
  const legacyBulkIssueEnabled = await getLegacyBulkIssueEnabled()
  const isOnlyWristbandKiosk =
    globalAccess.isWristbandKiosk &&
    globalAccess.roles.length > 0 &&
    globalAccess.roles.every(role => role === 'WRISTBAND_KIOSK')
  const isOnlyMenuKiosk =
    globalAccess.isMenuKiosk &&
    globalAccess.roles.length > 0 &&
    globalAccess.roles.every(role => role === 'MENU_KIOSK')

  if (isOnlyWristbandKiosk) {
    redirect('/dashboard/preskenovanie-naramku')
  }

  if (isOnlyMenuKiosk) {
    redirect('/dashboard/vyber-stravy-kiosk')
  }

  const [
    membershipsResult,
    pendingInvitesResult,
    activeRegistrationPeriodResult,
    fallbackRegistrationGroupResult,
    entitlementResult,
    selectionsResult,
    menuItemsResult,
    issuedMealsResult,
    bulkItemsResult,
    registrationBulkItemsResult
  ] = await Promise.all([
    legacyBulkIssueEnabled
      ? supabaseServer
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
      : Promise.resolve({ data: [] }),
    legacyBulkIssueEnabled
      ? supabaseServer
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
      : Promise.resolve({ data: [] }),
    supabaseServer
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
      .maybeSingle(),
    user.registration_group_id
      ? supabaseServer
        .from('registration_groups')
        .select('name')
        .eq('id', user.registration_group_id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', user.id)
      .eq('datum', selectedDate)
      .maybeSingle(),
    supabaseServer
      .from('vyber_jedal')
      .select('typ_jedla, volba')
      .eq('user_id', user.id)
      .eq('datum', selectedDate),
    supabaseServer
      .from('jedalny_listok')
      .select('typ_jedla, varianta, nazov, popis')
      .eq('datum', selectedDate)
      .eq('aktivne', true)
      .order('typ_jedla', { ascending: true })
      .order('poradie', { ascending: true }),
    supabaseServer
      .from('vydaj_jedal')
      .select('typ_jedla, status, sposob, issued_at, issued_by, group_id, hromadny_vydaj_id, registration_group_issue_id')
      .eq('user_id', user.id)
      .eq('datum', selectedDate)
      .order('issued_at', { ascending: false }),
    legacyBulkIssueEnabled
      ? supabaseServer
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
      .in('status', ['PLANNED', 'REMOVED'])
      : Promise.resolve({ data: [] }),
    supabaseServer
      .from('registration_group_issue_items')
      .select(`
        id,
        status,
        registration_group_issues:registration_group_issues!registration_group_issue_items_issue_id_fkey (
          id,
          title,
          datum,
          typ_jedla,
          status,
          registration_groups (
            name
          )
        )
      `)
      .eq('user_id', user.id)
      .in('status', ['PLANNED', 'REMOVED'])
  ])

  const memberships = membershipsResult.data || []
  const pendingInvites = pendingInvitesResult.data || []
  const activeRegistrationPeriod = activeRegistrationPeriodResult.data
  const fallbackRegistrationGroup = fallbackRegistrationGroupResult.data
  const entitlement = entitlementResult.data
  const selections = selectionsResult.data || []
  const menuItems = menuItemsResult.data || []
  const issuedMeals = issuedMealsResult.data || []
  const bulkItems = bulkItemsResult.data || []
  const registrationBulkItems = registrationBulkItemsResult.data || []

  const issuedByIds = Array.from(new Set(
    (issuedMeals || [])
      .filter((item: any) => item.sposob === 'HROMADNE')
      .map((item: any) => item.issued_by)
      .filter(Boolean)
  ))

  const issuedGroupIds = Array.from(new Set(
    (issuedMeals || [])
      .filter((item: any) => item.sposob === 'HROMADNE')
      .map((item: any) => item.group_id)
      .filter(Boolean)
  ))
  const issuedRegistrationIssueIds = Array.from(new Set(
    (issuedMeals || [])
      .filter((item: any) => item.sposob === 'HROMADNE')
      .map((item: any) => item.registration_group_issue_id)
      .filter(Boolean)
  ))

  const [
    issuedByUsersResult,
    issuedGroupsResult,
    issuedRegistrationIssuesResult,
    canOpenGroupIssue,
    managedRegistrationGroupIds
  ] = await Promise.all([
    issuedByIds.length > 0
      ? supabaseServer
        .from('users')
        .select('id, meno, priezvisko')
        .in('id', issuedByIds)
      : Promise.resolve({ data: [] }),
    legacyBulkIssueEnabled && issuedGroupIds.length > 0
      ? supabaseServer
        .from('groups')
        .select('id, name')
        .in('id', issuedGroupIds)
      : Promise.resolve({ data: [] }),
    issuedRegistrationIssueIds.length > 0
      ? supabaseServer
        .from('registration_group_issues')
        .select(`
          id,
          title,
          registration_groups (
            name
          )
        `)
        .in('id', issuedRegistrationIssueIds)
      : Promise.resolve({ data: [] }),
    canUseGroupIssue(user.id, globalAccess),
    globalAccess.canUsePersonalista ? Promise.resolve([]) : getManagedRegistrationGroupIds(user.id)
  ])

  const issuedByUsers = issuedByUsersResult.data || []
  const issuedGroups = issuedGroupsResult.data || []
  const issuedRegistrationIssues = issuedRegistrationIssuesResult.data || []

  const issuedByUserMap = new Map((issuedByUsers || []).map((item: any) => [item.id, item]))
  const issuedGroupMap = new Map((issuedGroups || []).map((item: any) => [item.id, item]))
  const issuedRegistrationIssueMap = new Map((issuedRegistrationIssues || []).map((item: any) => [item.id, item]))

  const hasMembership = !!memberships && memberships.length > 0
  const hasPendingInvites = !!pendingInvites && pendingInvites.length > 0
  const hasEntitlementRow = !!entitlement
  const registrationGroupName = activeRegistrationGroupName(activeRegistrationPeriod, fallbackRegistrationGroup)
  const canOpenPersonalista = globalAccess.canUsePersonalista
  const canOpenFoodIssue = globalAccess.canUseFoodIssue
  const canOpenMenuDeadline = globalAccess.isAdmin
  const canOpenWristbandKiosk = globalAccess.isAdmin
  const canOpenMenuKiosk = globalAccess.canUseMenuKiosk
  const canOpenOfflineIssue = globalAccess.canUseOfflineIssue
  const canOpenAccessCodesShare = canOpenPersonalista || managedRegistrationGroupIds.length > 0

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
    const matchingItems = (bulkItems || []).filter((item: any) => {
      const issue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      return (
        issue?.datum === selectedDate &&
        issue?.typ_jedla === typJedla &&
        (issue?.status === 'READY' || issue?.status === 'WAITING')
      )
    })

    return matchingItems.sort((a: any, b: any) => {
      if (a.status === 'PLANNED' && b.status !== 'PLANNED') return -1
      if (a.status !== 'PLANNED' && b.status === 'PLANNED') return 1
      return 0
    })[0]
  }

  const getRegistrationBulk = (typJedla: string) => {
    const matchingItems = (registrationBulkItems || []).filter((item: any) => {
      const issue = relationOne(item.registration_group_issues)

      return (
        issue?.datum === selectedDate &&
        issue?.typ_jedla === typJedla &&
        (issue?.status === 'READY' || issue?.status === 'WAITING')
      )
    })

    return matchingItems.sort((a: any, b: any) => {
      if (a.status === 'PLANNED' && b.status !== 'PLANNED') return -1
      if (a.status !== 'PLANNED' && b.status === 'PLANNED') return 1
      return 0
    })[0]
  }

  const obedSelection = getSelection('OBED')
  const veceraSelection = getSelection('VECERA')
  const defaultFood = user.typ_stravy || user.typStravy || null
  const showDiet = isDietFood(defaultFood)

  const todayMeals = [
    {
      typJedla: 'OBED',
      entitlement: entitlementLabel(entitlement?.obed),
      hasEntitlementRow,
      selection: obedSelection,
      menuText: getMenuText('OBED', showDiet),
      issued: getIssued('OBED'),
      bulk: getBulk('OBED'),
      registrationBulk: getRegistrationBulk('OBED')
    },
    {
      typJedla: 'VECERA',
      entitlement: entitlementLabel(entitlement?.vecera),
      hasEntitlementRow,
      selection: veceraSelection,
      menuText: getMenuText('VECERA', showDiet),
      issued: getIssued('VECERA'),
      bulk: getBulk('VECERA'),
      registrationBulk: getRegistrationBulk('VECERA')
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
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
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
          .dashboard-today-meal { border: 3px solid #000 !important; background: #fff !important; border-radius: 18px !important; padding: 12px !important; }
          .dashboard-meal-title { font-size: 18px !important; }
          .dashboard-entitlement { border-width: 2px !important; font-size: 10px !important; padding: 5px 8px !important; }
          .dashboard-meal-choice { padding: 10px !important; }
          .dashboard-menu-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
          .dashboard-menu-tile { min-height: 104px !important; padding: 12px !important; border-radius: 18px !important; box-shadow: 4px 4px 0 #000 !important; }
          .dashboard-menu-title { font-size: 16px !important; }
          .dashboard-menu-kicker { font-size: 10px !important; }
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
              const issuedGroup = meal.issued?.group_id ? issuedGroupMap.get(meal.issued.group_id) : null
              const issuedRegistrationIssue = meal.issued?.registration_group_issue_id
                ? issuedRegistrationIssueMap.get(meal.issued.registration_group_issue_id)
                : null
              const issuedByUser = meal.issued?.issued_by ? issuedByUserMap.get(meal.issued.issued_by) : null
              const issuedByName = fullName(issuedByUser)
              const issuedTime = formatTime(meal.issued?.issued_at)
              const showBulkPickup = meal.issued?.status === 'VYDANE' && meal.issued?.sposob === 'HROMADNE'
              const entitlementIsYes = meal.entitlement === 'ÁNO'
              const entitlementIsNo = meal.entitlement === 'NIE'
              const noInterest = meal.selection?.volba === 'BEZ_ZAUJMU'
              const state = mealState({
                entitlement: meal.entitlement,
                hasEntitlementRow: meal.hasEntitlementRow,
                noInterest,
                issued: meal.issued,
                legacyBulkItem: meal.bulk,
                registrationBulkItem: meal.registrationBulk,
                issuedGroup,
                issuedRegistrationIssue
              })

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
                      <b style={styles.todayChoiceValue}>
                        {choiceLabel(meal.selection?.volba, defaultFood)}
                      </b>
                    </div>

                    <div style={styles.todayRowWide}>
                      <span>Jedlo</span>
                      <b style={styles.todayMenuText}>{meal.menuText}</b>
                    </div>

                    <div style={styles.todayRowWide}>
                      <span>Stav jedla</span>
                      <b style={styles.todayStateInline}>
                        <span
                          style={{
                            ...styles.todayStateDot,
                            ...(state.tone === 'issued' ? styles.todayStateDotIssued : {}),
                            ...(state.tone === 'prepared' ? styles.todayStateDotPrepared : {}),
                            ...(state.tone === 'blocked' ? styles.todayStateDotBlocked : {})
                          }}
                        />
                        {state.label}
                      </b>
                      {state.detail && (
                        <small style={styles.todayStateDetail}>{state.detail}</small>
                      )}
                    </div>

                    {showBulkPickup && (
                      <div style={styles.todayRow}>
                        <span>Prevzal</span>
                        <b>
                          {issuedByName || '-'}
                          {issuedTime ? `, ${issuedTime}` : ''}
                        </b>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <div className="dashboard-menu-grid" style={styles.menuGrid}>
          <a className="dashboard-menu-tile" href="/dashboard/qr" style={{ ...styles.menuTile, ...styles.menuTileBlack }}>
            <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Náramok</span>
            <b className="dashboard-menu-title" style={styles.menuTileTitle}>Môj QR kód</b>
          </a>
          <a className="dashboard-menu-tile" href="/menu" style={{ ...styles.menuTile, ...styles.menuTileGreen }}>
            <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Strava</span>
            <b className="dashboard-menu-title" style={styles.menuTileTitle}>Môj výber</b>
          </a>
          <Link className="dashboard-menu-tile" href="/dashboard/naroky" style={{ ...styles.menuTile, ...styles.menuTileWhite }}>
            <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Prehľad</span>
            <b className="dashboard-menu-title" style={styles.menuTileTitle}>Nároky na stravu</b>
          </Link>
          {legacyBulkIssueEnabled && (
            <Link className="dashboard-menu-tile" href="/dashboard/groups" style={{ ...styles.menuTile, ...styles.menuTilePink }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Strava</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Stravovacie skupiny</b>
            </Link>
          )}
          {canOpenGroupIssue && (
            <Link className="dashboard-menu-tile" href="/dashboard/skupinovy-vydaj" style={{ ...styles.menuTile, ...styles.menuTileWhite }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Strava</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Skupinový výdaj</b>
            </Link>
          )}
          {canOpenOfflineIssue && (
            <Link className="dashboard-menu-tile" href="/dashboard/offline-rezim" style={{ ...styles.menuTile, ...styles.menuTileBlack }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Offline</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Offline výdaj</b>
            </Link>
          )}
          {canOpenAccessCodesShare && (
            <Link className="dashboard-menu-tile" href="/dashboard/access-codes-share" style={{ ...styles.menuTile, ...styles.menuTileBlack }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Prístupy</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Prístupové údaje</b>
            </Link>
          )}
          {canOpenFoodIssue && (
            <Link className="dashboard-menu-tile" href="/dashboard/vydaj-stravy" style={{ ...styles.menuTile, ...styles.menuTileGreen }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Obsluha</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Výdaj stravy</b>
            </Link>
          )}
          {canOpenPersonalista && (
            <Link className="dashboard-menu-tile" href="/dashboard/personalista" style={{ ...styles.menuTile, ...styles.menuTilePink }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Systém</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Personalistika</b>
            </Link>
          )}
          {canOpenMenuDeadline && (
            <a className="dashboard-menu-tile" href="/admin/menu" style={{ ...styles.menuTile, ...styles.menuTileBlack }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Admin</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Menu deadline</b>
            </a>
          )}
          {canOpenWristbandKiosk && (
            <Link className="dashboard-menu-tile" href="/dashboard/preskenovanie-naramku" style={{ ...styles.menuTile, ...styles.menuTileWhite }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Servis</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Preskenovanie náramku</b>
            </Link>
          )}
          {canOpenMenuKiosk && (
            <Link className="dashboard-menu-tile" href="/dashboard/vyber-stravy-kiosk" style={{ ...styles.menuTile, ...styles.menuTileGreen }}>
              <span className="dashboard-menu-kicker" style={styles.menuTileKicker}>Kiosk</span>
              <b className="dashboard-menu-title" style={styles.menuTileTitle}>Výber stravy</b>
            </Link>
          )}
        </div>

        {legacyBulkIssueEnabled && (
        <div style={styles.groupsBox}>
          <h2 style={styles.groupsTitle}>Moje stravovacie skupiny</h2>

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
        )}

        <footer style={styles.footer}>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" style={styles.privacyLink}>
            Ochrana osobných údajov
          </a>
        </footer>
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
  privacyLink: {
    color: '#000',
    fontWeight: 950,
    textDecoration: 'underline'
  },
  footer: {
    marginTop: 22,
    paddingTop: 14,
    borderTop: '2px solid rgba(0, 0, 0, 0.18)',
    textAlign: 'center',
    fontSize: 13
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
    border: '3px solid #000',
    borderRadius: 20,
    padding: 14,
    background: '#fff'
  },
  todayMealCardNoInterest: {
    background: '#fff'
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
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 14,
    padding: 12
  },
  todayChoiceBoxNoInterest: {
    background: '#ff6b6b'
  },
  todayChoiceLabel: {
    color: '#000',
    fontSize: 12,
    fontWeight: 950,
    opacity: 0.72
  },
  todayChoiceValue: {
    fontSize: 18,
    fontWeight: 950,
    color: '#000'
  },
  todayStateInline: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 15,
    fontWeight: 950,
    color: '#000'
  },
  todayStateDot: {
    width: 9,
    height: 9,
    border: '2px solid #000',
    borderRadius: 999,
    background: '#fff',
    flex: '0 0 auto'
  },
  todayStateDotIssued: {
    background: '#56db3f'
  },
  todayStateDotPrepared: {
    background: '#fff3bf'
  },
  todayStateDotBlocked: {
    background: '#ff6b6b'
  },
  todayStateDetail: {
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.25,
    color: '#000',
    opacity: 0.72
  },
  todayRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 10,
    alignItems: 'center',
    color: '#000',
    fontSize: 14
  },
  todayRowWide: {
    display: 'grid',
    gap: 4,
    color: '#000',
    fontSize: 14
  },
  todayMenuText: {
    color: '#000',
    whiteSpace: 'pre-line',
    lineHeight: 1.35
  },
  menuGrid: {
    marginTop: 26,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 12
  },
  menuTile: {
    minHeight: 126,
    border: '3px solid #000',
    borderRadius: 20,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 10,
    color: '#000',
    textDecoration: 'none',
    boxShadow: '6px 6px 0 #000',
    overflow: 'hidden'
  },
  menuTileBlack: {
    background: '#000',
    color: '#fff'
  },
  menuTilePink: {
    background: '#f25be6',
    color: '#000'
  },
  menuTileGreen: {
    background: '#56db3f',
    color: '#000'
  },
  menuTileWhite: {
    background: '#fff',
    color: '#000'
  },
  menuTileKicker: {
    display: 'block',
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0,
    opacity: 0.72,
    textTransform: 'uppercase'
  },
  menuTileTitle: {
    display: 'block',
    fontSize: 18,
    lineHeight: 1.08,
    fontWeight: 950
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
