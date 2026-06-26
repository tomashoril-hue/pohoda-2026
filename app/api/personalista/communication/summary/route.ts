import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

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

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const registrationGroupId = text(req.nextUrl.searchParams.get('registrationGroupId'))

    let group: any = null
    let userIds: string[] = []

    if (registrationGroupId) {
      const { data: groupRow, error: groupError } = await supabaseServer
        .from('registration_groups')
        .select('id, name')
        .eq('id', registrationGroupId)
        .maybeSingle()

      if (groupError) {
        return NextResponse.json({ error: groupError.message }, { status: 500 })
      }

      if (!groupRow) {
        return NextResponse.json({ error: 'Registracna skupina neexistuje.' }, { status: 404 })
      }

      group = groupRow
      userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)
    } else {
      userIds = await getAllActiveUserIds()
    }

    const activeUsers = userIds.length > 0 ? await getActiveUsersByIds(userIds) : []
    const activeUserIds = activeUsers.map((user: any) => user.id)

    const sentUserIds = activeUserIds.length > 0
      ? await getUserIdSetByChunks('personnel_email_log', activeUserIds, query => query
        .eq('type', 'WELCOME_IMPORTED_USER')
        .eq('status', 'SENT'))
      : new Set<string>()
    const codeUserIds = activeUserIds.length > 0
      ? await getUserIdSetByChunks('user_access_codes', activeUserIds, query => query
        .eq('active', true)
        .not('access_code_plain', 'is', null))
      : new Set<string>()
    const qrUserIds = activeUserIds.length > 0
      ? await getUserIdSetByChunks('user_qr_codes', activeUserIds, query => query.eq('active', true))
      : new Set<string>()
    const withEmail = activeUsers.filter((user: any) => text(user.email)).length

    return NextResponse.json({
      ok: true,
      group,
      total: activeUsers.length,
      withEmail,
      welcomeSent: sentUserIds.size,
      welcomePending: Math.max(0, withEmail - sentUserIds.size),
      withAccessCode: codeUserIds.size,
      withQr: qrUserIds.size
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
