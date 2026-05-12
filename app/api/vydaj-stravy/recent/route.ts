import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeDate(value: any) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeMeal(value: any) {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA' || text === 'VEČERA') return 'VECERA'
  return ''
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

async function issuerAccess(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)

  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', actorId)

  if (error) throw new Error(error.message)

  const groupIds = (memberships || [])
    .filter((membership: any) => canIssueForGroupByRole(String(membership.role || '').toUpperCase(), globalAccess))
    .map((membership: any) => membership.group_id)

  return {
    global: globalAccess.canUsePersonalista,
    groupIds,
    canUse: globalAccess.canUsePersonalista || groupIds.length > 0
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await issuerAccess(actor.id)

    if (!access.canUse) {
      return NextResponse.json({ error: 'Nemáš oprávnenie vydávať stravu.' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const datum = normalizeDate(searchParams.get('datum'))
    const typJedla = normalizeMeal(searchParams.get('typJedla'))

    if (!datum || !typJedla) {
      return NextResponse.json({ error: 'Chýba dátum alebo typ jedla.' }, { status: 400 })
    }

    const { data: issuedRows, error } = await supabaseServer
      .from('vydaj_jedal')
      .select('id, user_id, group_id, hromadny_vydaj_id, datum, typ_jedla, volba, sposob, issued_by, issued_at')
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .eq('status', 'VYDANE')
      .order('issued_at', { ascending: false })
      .limit(100)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const visibleRows = (issuedRows || []).filter((row: any) => {
      return access.global || access.groupIds.includes(row.group_id) || row.issued_by === actor.id
    }).slice(0, 10)

    const userIds = Array.from(new Set(visibleRows.map((row: any) => row.user_id).filter(Boolean)))
    const groupIds = Array.from(new Set(visibleRows.map((row: any) => row.group_id).filter(Boolean)))

    const { data: usersData } = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email')
        .in('id', userIds)
      : { data: [] }

    const { data: groupsData } = groupIds.length > 0
      ? await supabaseServer
        .from('groups')
        .select('id, name')
        .in('id', groupIds)
      : { data: [] }

    const userMap = new Map((usersData || []).map((user: any) => [user.id, user]))
    const groupMap = new Map((groupsData || []).map((group: any) => [group.id, group]))

    return NextResponse.json({
      ok: true,
      items: visibleRows.map((row: any) => {
        const person = userMap.get(row.user_id)
        const group = groupMap.get(row.group_id)

        return {
          issuedId: row.id,
          typJedla: row.typ_jedla,
          issuedAt: row.issued_at,
          personName: fullName(person) || person?.email || '',
          email: person?.email || '',
          choice: row.volba || '',
          method: row.sposob || '',
          groupName: group?.name || ''
        }
      })
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
