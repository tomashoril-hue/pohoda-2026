import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const RESULT_LIMIT = 5000
const FILTERED_RESULT_LIMIT = 5000

function cleanText(value: any) {
  return String(value || '').trim()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

async function fetchMembershipsForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('group_members')
    .select(`
      user_id,
      group_id,
      role,
      created_at,
      groups (
        id,
        name
      )
    `)
    .in('user_id', userIds)
    .order('created_at', { ascending: true })

  if (error) throw error

  return data || []
}

async function fetchEntitlementsForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('user_food_entitlements')
    .select('user_id, datum, obed, vecera')
    .in('user_id', userIds)
    .order('datum', { ascending: true })

  if (error) throw error

  return data || []
}

async function fetchRegistrationGroupPeriodsForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

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

  if (error) throw error

  return data || []
}

async function fetchRegistrationGroupManagersForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('registration_group_managers')
    .select('id, user_id, registration_group_id, active')
    .in('user_id', userIds)
    .eq('active', true)

  if (error) throw error

  return data || []
}

async function fetchRegistrationGroupDelegatesForUsers(userIds: string[]) {
  if (userIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('registration_group_issue_delegates')
    .select('id, user_id, registration_group_id, active')
    .in('user_id', userIds)
    .eq('active', true)

  if (error) throw error

  return data || []
}

async function fetchLatestAuditForUsers(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, any>()

  const { data: auditRows } = await supabaseServer
    .from('personnel_audit_log')
    .select('target_user_id, actor_user_id, created_at')
    .in('target_user_id', userIds)
    .order('created_at', { ascending: false })
    .limit(userIds.length * 8)

  const latestByUserId = new Map<string, any>()

  ;(auditRows || []).forEach((row: any) => {
    if (!row.target_user_id || latestByUserId.has(row.target_user_id)) return

    latestByUserId.set(row.target_user_id, row)
  })

  const actorUserIds = Array.from(new Set(
    Array.from(latestByUserId.values())
      .map((row: any) => row.actor_user_id)
      .filter(Boolean)
  ))

  if (actorUserIds.length === 0) return latestByUserId

  const { data: actorRows } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email')
    .in('id', actorUserIds)
  const actorsById = new Map((actorRows || []).map((actor: any) => [actor.id, actor]))

  latestByUserId.forEach((row: any, userId: string) => {
    const actor = actorsById.get(row.actor_user_id)

    latestByUserId.set(userId, {
      ...row,
      actor_name: fullName(actor) || actor?.email || ''
    })
  })

  return latestByUserId
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

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemas opravnenie.' }, { status: 403 })
    }

    const q = cleanText(req.nextUrl.searchParams.get('q'))
    const userId = cleanText(req.nextUrl.searchParams.get('userId'))
    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const status = cleanText(req.nextUrl.searchParams.get('status')).toUpperCase()
    const emailFilter = cleanText(req.nextUrl.searchParams.get('emailFilter')).toUpperCase() || 'ALL'
    const qrFilter = cleanText(req.nextUrl.searchParams.get('qrFilter')).toUpperCase() || 'ALL'
    const foodFilter = cleanText(req.nextUrl.searchParams.get('foodFilter')).toUpperCase() || 'ALL'
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1) || 1)
    const pageSize = Math.min(100, Math.max(12, Number(req.nextUrl.searchParams.get('pageSize') || 50) || 50))
    const paged = req.nextUrl.searchParams.has('page') || req.nextUrl.searchParams.has('pageSize')
    const query = q.replaceAll('%', '').replaceAll(',', ' ')

    if (userId && !isUuid(userId)) {
      return NextResponse.json({ error: 'Neplatna osoba.' }, { status: 400 })
    }

    if (registrationGroupId && !isUuid(registrationGroupId)) {
      return NextResponse.json({ error: 'Neplatna registracna skupina.' }, { status: 400 })
    }

    let registrationGroupUserIds: string[] | null = null

    if (registrationGroupId) {
      const today = slovakiaDateIso()
      const [periodResult, profileGroupResult] = await Promise.all([
        supabaseServer
          .from('user_registration_group_periods')
          .select('user_id')
          .eq('registration_group_id', registrationGroupId)
          .lte('valid_from', today)
          .or(`valid_to.is.null,valid_to.gte.${today}`),
        supabaseServer
          .from('users')
          .select('id')
          .eq('registration_group_id', registrationGroupId)
      ])

      if (periodResult.error) {
        return NextResponse.json({ error: periodResult.error.message }, { status: 500 })
      }

      if (profileGroupResult.error) {
        return NextResponse.json({ error: profileGroupResult.error.message }, { status: 500 })
      }

      registrationGroupUserIds = Array.from(new Set(
        [
          ...(periodResult.data || []).map((row: any) => row.user_id),
          ...(profileGroupResult.data || []).map((row: any) => row.id)
        ].filter(Boolean)
      ))

      if (registrationGroupUserIds.length === 0) {
        return NextResponse.json({
          ok: true,
          people: [],
          mode: 'REGISTRATION_GROUP',
          limit: FILTERED_RESULT_LIMIT,
          total: 0,
          page,
          pageSize,
          pageCount: 1
        })
      }
    }

    const filteredMode = Boolean(registrationGroupUserIds || status || emailFilter !== 'ALL' || qrFilter !== 'ALL' || foodFilter !== 'ALL')
    let usersQuery = supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, account_type, registration_group_id, registration_group_note, review_status, updated_at, created_at')
      .limit(filteredMode ? FILTERED_RESULT_LIMIT : RESULT_LIMIT)
    let mode = 'RECENT'

    if (registrationGroupUserIds) {
      usersQuery = usersQuery.in('id', registrationGroupUserIds)
      mode = 'REGISTRATION_GROUP'
    }

    if (status === 'BLOCKED') {
      usersQuery = usersQuery.neq('aktivny', 'ANO')
      mode = registrationGroupUserIds ? 'REGISTRATION_GROUP_BLOCKED' : 'BLOCKED'
    } else if (status === 'PENDING_REVIEW') {
      usersQuery = usersQuery.eq('review_status', 'PENDING_REVIEW')
      mode = registrationGroupUserIds ? 'REGISTRATION_GROUP_PENDING_REVIEW' : 'PENDING_REVIEW'
    } else if (status === 'ACTIVE') {
      usersQuery = usersQuery.eq('aktivny', 'ANO')
      mode = registrationGroupUserIds ? 'REGISTRATION_GROUP_ACTIVE' : 'ACTIVE'
    }

    if (foodFilter === 'MASO' || foodFilter === 'VEGE' || foodFilter === 'DIETA') {
      usersQuery = usersQuery.eq('typ_stravy', foodFilter)
      mode = mode === 'RECENT' ? 'FOOD_FILTER' : mode
    }

    if (userId) {
      usersQuery = usersQuery
        .eq('id', userId)
        .limit(1)
      mode = 'PERSON'
    } else if (query.length >= 2) {
      const pattern = `%${query}%`
      usersQuery = usersQuery
        .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern},telefon.ilike.${pattern}`)
        .order('priezvisko', { ascending: true })
        .order('meno', { ascending: true })
      mode = 'SEARCH'
    } else {
      usersQuery = usersQuery
        .order(filteredMode ? 'priezvisko' : 'updated_at', { ascending: filteredMode })
        .order(filteredMode ? 'meno' : 'created_at', { ascending: filteredMode })
    }

    const { data: usersData, error: usersError } = await usersQuery

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const users = usersData || []
    const userIds = users.map((user: any) => user.id).filter(Boolean)

    const [
      memberships,
      entitlements,
      registrationGroupPeriods,
      qrResult,
      nfcResult,
      roleResult,
      registrationGroupsResult,
      registrationGroupManagers,
      registrationGroupDelegates,
      latestAuditByUserId
    ] = await Promise.all([
      fetchMembershipsForUsers(userIds),
      fetchEntitlementsForUsers(userIds),
      fetchRegistrationGroupPeriodsForUsers(userIds),
      userIds.length
        ? supabaseServer.from('user_qr_codes').select('user_id, active').in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabaseServer.from('personnel_nfc_tokens').select('user_id, active').in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabaseServer.from('app_user_roles').select('user_id, role, active').in('user_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      supabaseServer.from('registration_groups').select('id, name, active'),
      fetchRegistrationGroupManagersForUsers(userIds),
      fetchRegistrationGroupDelegatesForUsers(userIds),
      fetchLatestAuditForUsers(userIds)
    ])

    if (qrResult.error) return NextResponse.json({ error: qrResult.error.message }, { status: 500 })
    if (nfcResult.error) return NextResponse.json({ error: nfcResult.error.message }, { status: 500 })
    if (roleResult.error) return NextResponse.json({ error: roleResult.error.message }, { status: 500 })
    if (registrationGroupsResult.error) {
      return NextResponse.json({ error: registrationGroupsResult.error.message }, { status: 500 })
    }

    const registrationGroupById = new Map(
      (registrationGroupsResult.data || []).map((group: any) => [group.id, group])
    )

    const membershipsByUserId = new Map<string, any[]>()
    memberships.forEach((membership: any) => {
      const list = membershipsByUserId.get(membership.user_id) || []
      list.push(membership)
      membershipsByUserId.set(membership.user_id, list)
    })

    const entitlementsByUserId = new Map<string, any[]>()
    entitlements.forEach((row: any) => {
      const list = entitlementsByUserId.get(row.user_id) || []
      list.push(row)
      entitlementsByUserId.set(row.user_id, list)
    })

    const registrationGroupPeriodsByUserId = new Map<string, any[]>()
    registrationGroupPeriods.forEach((row: any) => {
      const period = mapRegistrationGroupPeriod(row, registrationGroupById)
      const list = registrationGroupPeriodsByUserId.get(row.user_id) || []
      list.push(period)
      registrationGroupPeriodsByUserId.set(row.user_id, list)
    })

    const registrationGroupManagersByUserId = new Map<string, any[]>()
    registrationGroupManagers.forEach((row: any) => {
      const list = registrationGroupManagersByUserId.get(row.user_id) || []
      list.push(row)
      registrationGroupManagersByUserId.set(row.user_id, list)
    })

    const registrationGroupDelegatesByUserId = new Map<string, any[]>()
    registrationGroupDelegates.forEach((row: any) => {
      const list = registrationGroupDelegatesByUserId.get(row.user_id) || []
      list.push(row)
      registrationGroupDelegatesByUserId.set(row.user_id, list)
    })

    const activeQrByUserId = new Map<string, number>()
    ;(qrResult.data || []).forEach((row: any) => {
      if (!row.active) return
      activeQrByUserId.set(row.user_id, (activeQrByUserId.get(row.user_id) || 0) + 1)
    })

    const activeNfcByUserId = new Map<string, number>()
    ;(nfcResult.data || []).forEach((row: any) => {
      if (!row.active) return
      activeNfcByUserId.set(row.user_id, (activeNfcByUserId.get(row.user_id) || 0) + 1)
    })

    const globalRolesByUserId = new Map<string, string[]>()
    ;(roleResult.data || []).forEach((row: any) => {
      if (!row.active) return
      const list = globalRolesByUserId.get(row.user_id) || []
      list.push(String(row.role || '').toUpperCase())
      globalRolesByUserId.set(row.user_id, list)
    })

    let people = users.map((profile: any) => {
      const rows = entitlementsByUserId.get(profile.id) || []
      const lunchClaims = rows.filter(row => row.obed).length
      const dinnerClaims = rows.filter(row => row.vecera).length
      const personMemberships = membershipsByUserId.get(profile.id) || []
      const registrationGroupPeriods = registrationGroupPeriodsByUserId.get(profile.id) || []
      const registrationGroup = currentRegistrationGroupSnapshot(
        profile,
        registrationGroupPeriods,
        registrationGroupById,
        slovakiaDateIso()
      )
      const managedRegistrationGroups = mapRegistrationGroupAccessRows(
        registrationGroupManagersByUserId.get(profile.id) || [],
        registrationGroupById
      )
      const delegatedRegistrationGroups = mapRegistrationGroupAccessRows(
        registrationGroupDelegatesByUserId.get(profile.id) || [],
        registrationGroupById
      )
      const lastAudit = latestAuditByUserId.get(profile.id)

      return {
        id: profile.id,
        fullName: fullName(profile) || profile.email || 'Bez mena',
        meno: profile.meno || '',
        priezvisko: profile.priezvisko || '',
        email: profile.email || '',
        telefon: profile.telefon || '',
        typStravy: profile.typ_stravy || '',
        aktivny: profile.aktivny || 'ANO',
        accountType: profile.account_type || 'PERSON',
        reviewStatus: profile.review_status || 'APPROVED',
        registrationGroupId: registrationGroup.id,
        registrationGroupName: registrationGroup.name,
        registrationGroupNote: registrationGroup.note,
        registrationGroupPeriods,
        managedRegistrationGroups,
        delegatedRegistrationGroups,
        lastEditedAt: lastAudit?.created_at || profile.updated_at || '',
        lastEditedById: lastAudit?.actor_user_id || '',
        lastEditedByName: lastAudit?.actor_name || '',
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
        groups: personMemberships.map((membership: any) => {
          const group = Array.isArray(membership.groups) ? membership.groups[0] : membership.groups

          return {
            id: membership.group_id,
            name: group?.name || 'Skupina bez nazvu',
            role: String(membership.role || '').toUpperCase()
          }
        })
      }
    })

    if (emailFilter === 'WITH') {
      people = people.filter((person: any) => cleanText(person.email))
    } else if (emailFilter === 'MISSING') {
      people = people.filter((person: any) => !cleanText(person.email))
    }

    if (qrFilter === 'ACTIVE') {
      people = people.filter((person: any) => person.activeQrCount > 0)
    } else if (qrFilter === 'MISSING') {
      people = people.filter((person: any) => person.activeQrCount <= 0)
    }

    if (foodFilter === 'NEZADANE') {
      people = people.filter((person: any) => !cleanText(person.typStravy))
    }

    const total = people.length
    const pageCount = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, pageCount)
    const from = (safePage - 1) * pageSize
    const pagePeople = paged ? people.slice(from, from + pageSize) : people

    return NextResponse.json({
      ok: true,
      people: pagePeople,
      total,
      page: safePage,
      pageSize,
      pageCount,
      mode,
      limit: filteredMode ? FILTERED_RESULT_LIMIT : RESULT_LIMIT
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
