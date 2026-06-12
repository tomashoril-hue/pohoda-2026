import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
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

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    if (!group) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje.' }, { status: 404 })
    }

    const userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)

    const { data: users, error: usersError } = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, email')
        .in('id', userIds)
        .eq('aktivny', 'ANO')
      : { data: [], error: null }

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const activeUsers = users || []
    const activeUserIds = activeUsers.map((user: any) => user.id)

    const { data: sentRows, error: sentError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('personnel_email_log')
        .select('user_id')
        .in('user_id', activeUserIds)
        .eq('type', 'WELCOME_IMPORTED_USER')
        .eq('status', 'SENT')
      : { data: [], error: null }

    if (sentError) {
      return NextResponse.json({ error: sentError.message }, { status: 500 })
    }

    const { data: codeRows, error: codeError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_access_codes')
        .select('user_id')
        .in('user_id', activeUserIds)
        .eq('active', true)
        .not('access_code_plain', 'is', null)
      : { data: [], error: null }

    if (codeError) {
      return NextResponse.json({ error: codeError.message }, { status: 500 })
    }

    const { data: qrRows, error: qrError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_qr_codes')
        .select('user_id')
        .in('user_id', activeUserIds)
        .eq('active', true)
      : { data: [], error: null }

    if (qrError) {
      return NextResponse.json({ error: qrError.message }, { status: 500 })
    }

    const sentUserIds = new Set((sentRows || []).map((row: any) => row.user_id).filter(Boolean))
    const codeUserIds = new Set((codeRows || []).map((row: any) => row.user_id).filter(Boolean))
    const qrUserIds = new Set((qrRows || []).map((row: any) => row.user_id).filter(Boolean))
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
