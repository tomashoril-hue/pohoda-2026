import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const SUMMARY_VERSION = 'communication-summary-direct-2026-07-04'
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0'
}

function jsonNoStore(body: any, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init.headers || {})
    }
  })
}

function text(value: any) {
  return String(value || '').trim()
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function getAllActiveUserIds() {
  const pageSize = 1000
  const userIds: string[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id')
      .eq('aktivny', 'ANO')
      .range(from, from + pageSize - 1)

    if (error) throw error

    const rows = data || []
    userIds.push(...rows.map((row: any) => row.id).filter(Boolean))

    if (rows.length < pageSize) break
    from += pageSize
  }

  return userIds
}

async function getCurrentRegistrationGroupUserIds(registrationGroupId: string) {
  const today = slovakiaDateIso(0)

  const { data: periodRows, error: periodError } = await supabaseServer
    .from('user_registration_group_periods')
    .select('user_id')
    .eq('registration_group_id', registrationGroupId)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  if (periodError) throw periodError

  const periodUserIds = new Set((periodRows || []).map((row: any) => row.user_id).filter(Boolean))

  const { data: fallbackUsers, error: fallbackError } = await supabaseServer
    .from('users')
    .select('id')
    .eq('registration_group_id', registrationGroupId)

  if (fallbackError) throw fallbackError

  const fallbackUserIds = (fallbackUsers || []).map((row: any) => row.id).filter(Boolean)
  const fallbackCurrentPeriods = fallbackUserIds.length > 0
    ? await supabaseServer
      .from('user_registration_group_periods')
      .select('user_id')
      .in('user_id', fallbackUserIds)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
    : { data: [], error: null }

  if (fallbackCurrentPeriods.error) throw fallbackCurrentPeriods.error

  const usersWithCurrentPeriod = new Set((fallbackCurrentPeriods.data || []).map((row: any) => row.user_id).filter(Boolean))

  fallbackUserIds.forEach((userId: string) => {
    if (!usersWithCurrentPeriod.has(userId)) periodUserIds.add(userId)
  })

  return Array.from(periodUserIds)
}

async function getBaseRegistrationGroupUserIds(registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('users')
    .select('id')
    .eq('registration_group_id', registrationGroupId)
    .eq('aktivny', 'ANO')

  if (error) throw error

  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function getActiveUsersByIds(userIds: string[]) {
  const users: Array<{ id: string; email: string | null }> = []

  for (const chunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, email')
      .in('id', chunk)
      .eq('aktivny', 'ANO')

    if (error) throw error
    users.push(...(data || []))
  }

  return users
}

async function getUserIdSetByChunks(table: string, userIds: string[], configure: (query: any) => any) {
  const result = new Set<string>()

  for (const chunk of chunkArray(userIds, 500)) {
    const query = configure(
      supabaseServer
        .from(table)
        .select('user_id')
        .in('user_id', chunk)
    )
    const { data, error } = await query

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) result.add(row.user_id)
    })
  }

  return result
}

async function getSelfOrderingUserIds(candidateUserIds: string[]) {
  const result = new Set<string>()

  for (const chunk of chunkArray(candidateUserIds, 500)) {
    const { data, error } = await supabaseServer
      .from('app_user_roles')
      .select('user_id')
      .in('user_id', chunk)
      .eq('role', 'SAMOSTATNE_OBJEDNAVANIE_STRAVY')
      .eq('active', true)

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) result.add(row.user_id)
    })
  }

  return result
}

async function getIssuedMealUserIds(candidateUserIds: string[]) {
  const result = new Set<string>()

  for (const chunk of chunkArray(candidateUserIds, 500)) {
    const { data, error } = await supabaseServer
      .from('vydaj_jedal')
      .select('user_id')
      .in('user_id', chunk)
      .eq('status', 'VYDANE')

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) result.add(row.user_id)
    })
  }

  return result
}

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return jsonNoStore({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return jsonNoStore({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const registrationGroupId = text(req.nextUrl.searchParams.get('registrationGroupId'))
    const baseRegistrationGroup = text(req.nextUrl.searchParams.get('baseRegistrationGroup')) === '1'

    let group: any = null
    let userIds: string[] = []

    if (registrationGroupId) {
      const { data: groupRow, error: groupError } = await supabaseServer
        .from('registration_groups')
        .select('id, name')
        .eq('id', registrationGroupId)
        .maybeSingle()

      if (groupError) {
        return jsonNoStore({ error: groupError.message }, { status: 500 })
      }

      if (!groupRow) {
        return jsonNoStore({ error: 'Registracna skupina neexistuje.' }, { status: 404 })
      }

      group = groupRow
      userIds = baseRegistrationGroup
        ? await getBaseRegistrationGroupUserIds(registrationGroupId)
        : await getCurrentRegistrationGroupUserIds(registrationGroupId)
    } else {
      userIds = await getAllActiveUserIds()
    }

    const activeUsers = userIds.length > 0 ? await getActiveUsersByIds(userIds) : []
    const activeUserIds = activeUsers.map((user: any) => user.id)

    const selfOrderingUserIds = activeUserIds.length > 0
      ? await getSelfOrderingUserIds(activeUserIds)
      : new Set<string>()
    const issuedMealUserIds = activeUserIds.length > 0
      ? await getIssuedMealUserIds(activeUserIds)
      : new Set<string>()
    const welcomeUsers = activeUsers.filter((user: any) => !selfOrderingUserIds.has(user.id) && !issuedMealUserIds.has(user.id))
    const welcomeEmailUserIds = new Set(
      welcomeUsers
        .filter((user: any) => text(user.email))
        .map((user: any) => user.id)
    )
    const welcomeEmailUserIdList = Array.from(welcomeEmailUserIds)

    const sentUserIds = welcomeEmailUserIdList.length > 0
      ? await getUserIdSetByChunks('personnel_email_log', welcomeEmailUserIdList, query => query
        .eq('type', 'WELCOME_IMPORTED_USER')
        .eq('status', 'SENT'))
      : new Set<string>()
    const failedUserIds = welcomeEmailUserIdList.length > 0
      ? await getUserIdSetByChunks('personnel_email_log', welcomeEmailUserIdList, query => query
        .eq('type', 'WELCOME_IMPORTED_USER')
        .eq('status', 'FAILED')
        .not('error_message', 'ilike', '%Too many requests%')
        .not('error_message', 'ilike', '%requests per second%'))
      : new Set<string>()
    const codeUserIds = activeUserIds.length > 0
      ? await getUserIdSetByChunks('user_access_codes', activeUserIds, query => query
        .eq('active', true)
        .not('access_code_plain', 'is', null))
      : new Set<string>()
    const qrUserIds = activeUserIds.length > 0
      ? await getUserIdSetByChunks('user_qr_codes', activeUserIds, query => query.eq('active', true))
      : new Set<string>()
    const selfOrderingEmailUserIds = new Set(
      activeUsers
        .filter((user: any) => text(user.email) && selfOrderingUserIds.has(user.id))
        .map((user: any) => user.id)
    )
    const selfOrderingSentUserIds = selfOrderingEmailUserIds.size > 0
      ? await getUserIdSetByChunks('personnel_email_log', Array.from(selfOrderingEmailUserIds), query => query
        .eq('type', 'SELF_ORDERING_INVITE')
        .eq('status', 'SENT'))
      : new Set<string>()
    const selfOrderingFailedUserIds = selfOrderingEmailUserIds.size > 0
      ? await getUserIdSetByChunks('personnel_email_log', Array.from(selfOrderingEmailUserIds), query => query
        .eq('type', 'SELF_ORDERING_INVITE')
        .eq('status', 'FAILED')
        .not('error_message', 'ilike', '%Too many requests%')
        .not('error_message', 'ilike', '%requests per second%'))
      : new Set<string>()
    const welcomePending = welcomeEmailUserIdList
      .filter(userId => !sentUserIds.has(userId) && !failedUserIds.has(userId))
      .length
    const selfOrderingPending = Array.from(selfOrderingEmailUserIds)
      .filter(userId => !selfOrderingSentUserIds.has(userId) && !selfOrderingFailedUserIds.has(userId))
      .length

    return jsonNoStore({
      ok: true,
      summaryVersion: SUMMARY_VERSION,
      computedAt: new Date().toISOString(),
      group,
      total: activeUsers.length,
      withEmail: welcomeEmailUserIds.size,
      welcomeSent: sentUserIds.size,
      welcomeFailed: failedUserIds.size,
      welcomePending,
      selfOrderingTotal: selfOrderingUserIds.size,
      selfOrderingWithEmail: selfOrderingEmailUserIds.size,
      selfOrderingSent: selfOrderingSentUserIds.size,
      selfOrderingFailed: selfOrderingFailedUserIds.size,
      selfOrderingPending,
      withAccessCode: codeUserIds.size,
      withQr: qrUserIds.size
    })
  } catch (err: any) {
    return jsonNoStore({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
