import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const RESULT_LIMIT = 100

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
    const query = q.replaceAll('%', '').replaceAll(',', ' ')

    if (userId && !isUuid(userId)) {
      return NextResponse.json({ error: 'Neplatna osoba.' }, { status: 400 })
    }

    let usersQuery = supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, registration_group_id, registration_group_note, review_status, updated_at, created_at')
      .limit(RESULT_LIMIT)
    let mode = 'RECENT'

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
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
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

    const people = users.map((profile: any) => {
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
        reviewStatus: profile.review_status || 'APPROVED',
        registrationGroupId: registrationGroup.id,
        registrationGroupName: registrationGroup.name,
        registrationGroupNote: registrationGroup.note,
        registrationGroupPeriods,
        lastEditedAt: lastAudit?.created_at || profile.updated_at || '',
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

    return NextResponse.json({
      ok: true,
      people,
      mode,
      limit: RESULT_LIMIT
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
