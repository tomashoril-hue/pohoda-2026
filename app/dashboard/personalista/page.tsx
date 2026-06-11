import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import PersonalistaClient from './PersonalistaClient'

function isoDateOffset(days: number) {
  return slovakiaDateIso(days)
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

const INITIAL_PEOPLE_LIMIT = 50
const RECENT_USER_SELECT = 'id, meno, priezvisko, email, telefon, typ_stravy, aktivny, registration_group_id, registration_group_note, review_status, updated_at, created_at'

type PersonalistaSearchParams = Promise<{
  scope?: string | string[]
}>

async function fetchMembershipsForUsers(userIds: string[]) {
  if (userIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: any[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from('group_members')
      .select(`
        id,
        user_id,
        group_id,
        role,
        created_at,
        groups (
          id,
          name
        ),
        users (
          id,
          meno,
          priezvisko,
          email,
          telefon,
          typ_stravy,
          aktivny,
          registration_group_id,
          registration_group_note,
          review_status,
          updated_at,
          created_at
        )
      `)
      .in('user_id', userIds)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) return { rows, error }

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return { rows, error: null }
  }
}

async function fetchRecentUsers(limit = INITIAL_PEOPLE_LIMIT) {
  const { data, error } = await supabaseServer
    .from('users')
    .select(RECENT_USER_SELECT)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return {
    rows: data || [],
    error
  }
}

async function fetchRecentUsersFromAudit({
  actorUserId,
  limit = INITIAL_PEOPLE_LIMIT
}: {
  actorUserId?: string
  limit?: number
}) {
  let auditQuery = supabaseServer
    .from('personnel_audit_log')
    .select('target_user_id, actor_user_id, created_at')
    .not('target_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit * 8)

  if (actorUserId) {
    auditQuery = auditQuery.eq('actor_user_id', actorUserId)
  }

  const { data: auditRows, error: auditError } = await auditQuery

  if (auditError) {
    return {
      rows: [],
      error: auditError
    }
  }

  const orderedUserIds: string[] = []
  const seenUserIds = new Set<string>()
  const lastAuditByUserId = new Map<string, any>()

  for (const row of auditRows || []) {
    const userId = row.target_user_id

    if (!userId || seenUserIds.has(userId)) continue

    seenUserIds.add(userId)
    orderedUserIds.push(userId)
    lastAuditByUserId.set(userId, row)

    if (orderedUserIds.length >= limit) break
  }

  if (orderedUserIds.length === 0) {
    return {
      rows: [],
      error: null
    }
  }

  const { data, error } = await supabaseServer
    .from('users')
    .select(RECENT_USER_SELECT)
    .in('id', orderedUserIds)

  const actorUserIds = Array.from(new Set(
    Array.from(lastAuditByUserId.values())
      .map((row: any) => row.actor_user_id)
      .filter(Boolean)
  ))
  let actorsById = new Map<string, any>()

  if (actorUserIds.length > 0) {
    const { data: actorRows } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email')
      .in('id', actorUserIds)

    actorsById = new Map((actorRows || []).map((actor: any) => [actor.id, actor]))
  }

  const rows = (data || []).sort((a: any, b: any) => {
    return orderedUserIds.indexOf(a.id) - orderedUserIds.indexOf(b.id)
  }).map((profile: any) => {
    const audit = lastAuditByUserId.get(profile.id)
    const actor = actorsById.get(audit?.actor_user_id)

    return {
      ...profile,
      last_edited_at: audit?.created_at || profile.updated_at || profile.created_at || '',
      last_edited_by_id: audit?.actor_user_id || '',
      last_edited_by_name: fullName(actor) || actor?.email || ''
    }
  })

  return {
    rows,
    error
  }
}

async function fetchRecentUsersEditedByActor(actorUserId: string, limit = INITIAL_PEOPLE_LIMIT) {
  return fetchRecentUsersFromAudit({ actorUserId, limit })
}

async function fetchEntitlementsForUsers(userIds: string[]) {
  const rows: any[] = []
  const pageSize = 1000

  if (userIds.length === 0) return rows

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from('user_food_entitlements')
      .select('user_id, datum, obed, vecera')
      .in('user_id', userIds)
      .order('datum', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) return rows

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return rows
  }
}

async function fetchRegistrationGroupPeriodsForUsers(userIds: string[]) {
  const rows: any[] = []
  const pageSize = 1000

  if (userIds.length === 0) return rows

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from('user_registration_group_periods')
      .select(`
        id,
        user_id,
        registration_group_id,
        valid_from,
        valid_to,
        note,
        registration_groups (
          id,
          name
        )
      `)
      .in('user_id', userIds)
      .order('valid_from', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) return rows

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return rows
  }
}

async function fetchRegistrationGroupManagersForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data } = await supabaseServer
    .from('registration_group_managers')
    .select('id, user_id, registration_group_id, active')
    .in('user_id', userIds)
    .eq('active', true)

  return data || []
}

async function fetchRegistrationGroupDelegatesForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data } = await supabaseServer
    .from('registration_group_issue_delegates')
    .select('id, user_id, registration_group_id, active')
    .in('user_id', userIds)
    .eq('active', true)

  return data || []
}

function mapRegistrationGroupPeriod(row: any, registrationGroupById: Map<string, any>) {
  const group = Array.isArray(row.registration_groups)
    ? row.registration_groups[0]
    : row.registration_groups

  return {
    id: row.id,
    registrationGroupId: row.registration_group_id,
    registrationGroupName: group?.name || registrationGroupById.get(row.registration_group_id)?.name || '',
    validFrom: row.valid_from,
    validTo: row.valid_to || '',
    note: row.note || ''
  }
}

function mapRegistrationGroupAccessRows(rows: any[], registrationGroupById: Map<string, any>) {
  return rows
    .map(row => {
      const group = registrationGroupById.get(row.registration_group_id)

      return {
        id: row.id,
        registrationGroupId: row.registration_group_id,
        registrationGroupName: group?.name || ''
      }
    })
    .filter(item => item.registrationGroupId && item.registrationGroupName)
    .sort((a, b) => a.registrationGroupName.localeCompare(b.registrationGroupName, 'sk'))
}

function currentRegistrationGroupSnapshot(profile: any, periods: any[], registrationGroupById: Map<string, any>, today: string) {
  const currentPeriod = periods.find(period => {
    return period.validFrom <= today && (!period.validTo || period.validTo >= today)
  })

  if (currentPeriod) {
    const group = registrationGroupById.get(currentPeriod.registrationGroupId)

    return {
      id: currentPeriod.registrationGroupId || '',
      name: currentPeriod.registrationGroupName || group?.name || '',
      note: currentPeriod.note || ''
    }
  }

  return {
    id: profile?.registration_group_id || '',
    name: registrationGroupById.get(profile?.registration_group_id)?.name || '',
    note: profile?.registration_group_note || ''
  }
}

export default async function PersonalistaPage({
  searchParams
}: {
  searchParams: PersonalistaSearchParams
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const globalAccess = await getGlobalAccess(user.id)
  const isGlobalPersonalista = globalAccess.canUsePersonalista

  if (!isGlobalPersonalista) {
    redirect('/dashboard')
  }

  const resolvedSearchParams = await searchParams
  const requestedScope = Array.isArray(resolvedSearchParams?.scope)
    ? resolvedSearchParams.scope[0]
    : resolvedSearchParams?.scope
  const peopleScope = globalAccess.isAdmin && requestedScope === 'all' ? 'all' : 'mine'
  const {
    rows: auditRecentUsers,
    error: auditUsersError
  } = peopleScope === 'all'
    ? await fetchRecentUsersFromAudit({})
    : await fetchRecentUsersEditedByActor(user.id)
  const fallbackRecentUsersResult = auditRecentUsers.length === 0 && peopleScope === 'all'
    ? await fetchRecentUsers()
    : { rows: [], error: null }
  const recentUsers = auditRecentUsers.length > 0 ? auditRecentUsers : fallbackRecentUsersResult.rows
  const usersError = auditUsersError || fallbackRecentUsersResult.error

  if (usersError) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>
          {usersError.message}
        </section>
      </main>
    )
  }

  const allVisibleUsers = recentUsers || []
  const recentUserIds = allVisibleUsers
    .map((item: any) => item.id)
    .filter(Boolean)
  const recentOrderByUserId = new Map(
    recentUserIds.map((id: string, index: number) => [id, index])
  )

  const { rows: memberships, error } = await fetchMembershipsForUsers(recentUserIds)

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>
          {error.message}
        </section>
      </main>
    )
  }

  const visibleMemberships = memberships || []
  const groupsById = new Map<string, any>()
  const { data: registrationGroupsData } = await supabaseServer
    .from('registration_groups')
    .select('id, name, active')
    .order('name', { ascending: true })

  const registrationGroups = registrationGroupsData || []
  const registrationGroupById = new Map(
    registrationGroups.map((group: any) => [group.id, group])
  )

  const { data: allGroupsData } = await supabaseServer
    .from('groups')
    .select('id, name')
    .order('name', { ascending: true })

  let qrWristbandRules = {
    enabled: true,
    ranges: [] as any[]
  }

  if (globalAccess.isAdmin) {
    const [qrRuleSettingsResult, qrRuleRangesResult] = await Promise.all([
      supabaseServer
        .from('personnel_qr_wristband_settings')
        .select('enabled')
        .eq('id', 'DEFAULT')
        .maybeSingle(),
      supabaseServer
        .from('personnel_qr_wristband_ranges')
        .select('id, type_code, series_from, series_to, active')
        .order('type_code', { ascending: true })
    ])

    qrWristbandRules = {
      enabled: qrRuleSettingsResult.data?.enabled !== false,
      ranges: (qrRuleRangesResult.data || []).map((range: any) => ({
        id: range.id,
        typeCode: range.type_code,
        seriesFrom: range.series_from,
        seriesTo: range.series_to,
        active: range.active !== false
      }))
    }
  }

  ;(allGroupsData || []).forEach((group: any) => {
    if (!group?.id) return

    groupsById.set(group.id, {
      id: group.id,
      name: group.name || 'Skupina bez nazvu'
    })
  })

  const membershipUserIds = visibleMemberships
    .map((membership: any) => membership.user_id)
    .filter(Boolean)

  const globalUserIds = allVisibleUsers
    .map((item: any) => item.id)
    .filter(Boolean)

  const userIds = Array.from(new Set([
    ...membershipUserIds,
    ...globalUserIds
  ]))

  const fromDate = isoDateOffset(0)
  const toDate = isoDateOffset(13)

  let qrRows: any[] = []
  let nfcRows: any[] = []
  let roleRows: any[] = []
  let entitlementRows: any[] = []
  let registrationGroupPeriodRows: any[] = []
  let registrationGroupManagerRows: any[] = []
  let registrationGroupDelegateRows: any[] = []

  if (userIds.length > 0) {
    const { data: qrData } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id, active')
      .in('user_id', userIds)

    qrRows = qrData || []

    const { data: nfcData } = await supabaseServer
      .from('personnel_nfc_tokens')
      .select('user_id, active')
      .in('user_id', userIds)

    nfcRows = nfcData || []

    const { data: roleData } = await supabaseServer
      .from('app_user_roles')
      .select('user_id, role, active')
      .in('user_id', userIds)

    roleRows = roleData || []

    entitlementRows = await fetchEntitlementsForUsers(userIds)
    registrationGroupPeriodRows = await fetchRegistrationGroupPeriodsForUsers(userIds)
    registrationGroupManagerRows = await fetchRegistrationGroupManagersForUsers(userIds)
    registrationGroupDelegateRows = await fetchRegistrationGroupDelegatesForUsers(userIds)
  }

  const activeQrByUserId = new Map<string, number>()
  const activeNfcByUserId = new Map<string, number>()
  const globalRolesByUserId = new Map<string, string[]>()

  qrRows.forEach((row: any) => {
    if (!row.active) return

    activeQrByUserId.set(
      row.user_id,
      (activeQrByUserId.get(row.user_id) || 0) + 1
    )
  })

  nfcRows.forEach((row: any) => {
    if (!row.active) return

    activeNfcByUserId.set(
      row.user_id,
      (activeNfcByUserId.get(row.user_id) || 0) + 1
    )
  })

  roleRows.forEach((row: any) => {
    if (!row.active) return

    const list = globalRolesByUserId.get(row.user_id) || []
    list.push(String(row.role || '').toUpperCase())
    globalRolesByUserId.set(row.user_id, list)
  })

  const entitlementsByUserId = new Map<string, any[]>()

  entitlementRows.forEach((row: any) => {
    const list = entitlementsByUserId.get(row.user_id) || []
    list.push(row)
    entitlementsByUserId.set(row.user_id, list)
  })

  const registrationGroupPeriodsByUserId = new Map<string, any[]>()

  registrationGroupPeriodRows.forEach((row: any) => {
    const period = mapRegistrationGroupPeriod(row, registrationGroupById)
    const list = registrationGroupPeriodsByUserId.get(row.user_id) || []
    list.push(period)
    registrationGroupPeriodsByUserId.set(row.user_id, list)
  })

  const registrationGroupManagersByUserId = new Map<string, any[]>()

  registrationGroupManagerRows.forEach((row: any) => {
    const list = registrationGroupManagersByUserId.get(row.user_id) || []
    list.push(row)
    registrationGroupManagersByUserId.set(row.user_id, list)
  })

  const registrationGroupDelegatesByUserId = new Map<string, any[]>()

  registrationGroupDelegateRows.forEach((row: any) => {
    const list = registrationGroupDelegatesByUserId.get(row.user_id) || []
    list.push(row)
    registrationGroupDelegatesByUserId.set(row.user_id, list)
  })

  const personMap = new Map<string, any>()
  const visibleProfileById = new Map(
    allVisibleUsers.map((profile: any) => [profile.id, profile])
  )

  visibleMemberships.forEach((membership: any) => {
    const memberUser = Array.isArray(membership.users)
      ? membership.users[0]
      : membership.users
    const profile: any = visibleProfileById.get(membership.user_id) || memberUser

    const group = groupsById.get(membership.group_id)
    const current = personMap.get(membership.user_id)
    const groupItem = {
      id: membership.group_id,
      name: group?.name || 'Skupina bez nazvu',
      role: String(membership.role || '').toUpperCase()
    }

    if (current) {
      current.groups.push(groupItem)
      return
    }

    const rows = entitlementsByUserId.get(membership.user_id) || []
    const registrationGroupPeriods = registrationGroupPeriodsByUserId.get(membership.user_id) || []
    const registrationGroup = currentRegistrationGroupSnapshot(
      profile,
      registrationGroupPeriods,
      registrationGroupById,
      fromDate
    )
    const lunchClaims = rows.filter(row => row.obed).length
    const dinnerClaims = rows.filter(row => row.vecera).length
    const mealClaims = lunchClaims + dinnerClaims
    const managedRegistrationGroups = mapRegistrationGroupAccessRows(
      registrationGroupManagersByUserId.get(membership.user_id) || [],
      registrationGroupById
    )
    const delegatedRegistrationGroups = mapRegistrationGroupAccessRows(
      registrationGroupDelegatesByUserId.get(membership.user_id) || [],
      registrationGroupById
    )

    personMap.set(membership.user_id, {
      id: membership.user_id,
      fullName: fullName(profile) || profile?.email || 'Bez mena',
      meno: profile?.meno || '',
      priezvisko: profile?.priezvisko || '',
      email: profile?.email || '',
      telefon: profile?.telefon || '',
      typStravy: profile?.typ_stravy || '',
      aktivny: profile?.aktivny || 'ANO',
      reviewStatus: profile?.review_status || 'APPROVED',
      registrationGroupId: registrationGroup.id,
      registrationGroupName: registrationGroup.name,
      registrationGroupNote: registrationGroup.note,
      registrationGroupPeriods,
      managedRegistrationGroups,
      delegatedRegistrationGroups,
      lastEditedAt: profile?.last_edited_at || profile?.updated_at || '',
      lastEditedById: profile?.last_edited_by_id || '',
      lastEditedByName: profile?.last_edited_by_name || '',
      activeQrCount: activeQrByUserId.get(membership.user_id) || 0,
      activeNfcCount: activeNfcByUserId.get(membership.user_id) || 0,
      globalRoles: globalRolesByUserId.get(membership.user_id) || [],
      entitlementDays: rows.length,
      lunchClaims,
      dinnerClaims,
      mealClaims,
      entitlements: rows
        .map(row => ({
          datum: row.datum,
          obed: !!row.obed,
          vecera: !!row.vecera
        }))
        .sort((a, b) => String(a.datum).localeCompare(String(b.datum))),
      groups: [groupItem]
    })
  })

  if (isGlobalPersonalista) {
    allVisibleUsers.forEach((profile: any) => {
      if (personMap.has(profile.id)) return

      const rows = entitlementsByUserId.get(profile.id) || []
      const registrationGroupPeriods = registrationGroupPeriodsByUserId.get(profile.id) || []
      const registrationGroup = currentRegistrationGroupSnapshot(
        profile,
        registrationGroupPeriods,
        registrationGroupById,
        fromDate
      )
      const lunchClaims = rows.filter(row => row.obed).length
      const dinnerClaims = rows.filter(row => row.vecera).length
      const managedRegistrationGroups = mapRegistrationGroupAccessRows(
        registrationGroupManagersByUserId.get(profile.id) || [],
        registrationGroupById
      )
      const delegatedRegistrationGroups = mapRegistrationGroupAccessRows(
        registrationGroupDelegatesByUserId.get(profile.id) || [],
        registrationGroupById
      )

      personMap.set(profile.id, {
        id: profile.id,
        fullName: fullName(profile) || profile.email || 'Bez mena',
        meno: profile.meno || '',
        priezvisko: profile.priezvisko || '',
        email: profile.email || '',
        telefon: profile.telefon || '',
        typStravy: profile.typ_stravy || '',
        aktivny: profile.aktivny || 'ANO',
        reviewStatus: profile.review_status || 'APPROVED',
        registrationGroupId: registrationGroup.id,
        registrationGroupName: registrationGroup.name,
        registrationGroupNote: registrationGroup.note,
        registrationGroupPeriods,
        managedRegistrationGroups,
        delegatedRegistrationGroups,
        lastEditedAt: profile.last_edited_at || profile.updated_at || '',
        lastEditedById: profile.last_edited_by_id || '',
        lastEditedByName: profile.last_edited_by_name || '',
        activeQrCount: activeQrByUserId.get(profile.id) || 0,
        activeNfcCount: activeNfcByUserId.get(profile.id) || 0,
        globalRoles: globalRolesByUserId.get(profile.id) || [],
        entitlementDays: rows.length,
        lunchClaims,
        dinnerClaims,
        mealClaims: lunchClaims + dinnerClaims,
        entitlements: rows
          .map(row => ({
            datum: row.datum,
            obed: !!row.obed,
            vecera: !!row.vecera
          }))
          .sort((a, b) => String(a.datum).localeCompare(String(b.datum))),
        groups: []
      })
    })
  }

  const groups = Array.from(groupsById.values()).sort((a, b) => {
    return a.name.localeCompare(b.name, 'sk')
  })

  const people = Array.from(personMap.values()).sort((a, b) => {
    const aOrder = recentOrderByUserId.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bOrder = recentOrderByUserId.get(b.id) ?? Number.MAX_SAFE_INTEGER

    if (aOrder !== bOrder) return aOrder - bOrder

    const aManager = a.groups.some((group: any) => group.role === 'MANAGER')
    const bManager = b.groups.some((group: any) => group.role === 'MANAGER')

    if (aManager !== bManager) return aManager ? -1 : 1

    return a.fullName.localeCompare(b.fullName, 'sk')
  })

  return (
    <PersonalistaClient
      people={people}
      groups={groups}
      registrationGroups={registrationGroups.filter((group: any) => group.active)}
      qrWristbandRules={qrWristbandRules}
      fromDate={fromDate}
      toDate={toDate}
      canManage={isGlobalPersonalista}
      canAssignSensitiveRoles={globalAccess.isAdmin}
      canDeregisterUsers={globalAccess.isAdmin}
      canViewAllPeople={globalAccess.isAdmin}
      peopleScope={peopleScope}
      currentUserId={user.id}
      currentUserName={fullName(user) || user.email || 'Pouzivatel'}
      currentUserRoleLabel={globalAccess.isAdmin ? 'ADMIN' : 'PERSONALISTA'}
    />
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  }
}
