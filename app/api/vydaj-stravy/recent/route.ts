import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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

  return {
    canUse: globalAccess.canAdminFoodIssue
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

    const selectIssued = 'id, user_id, group_id, hromadny_vydaj_id, datum, typ_jedla, volba, sposob, issued_by, issued_at'
    const { data, error } = await supabaseServer
      .from('vydaj_jedal')
      .select(selectIssued)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .eq('status', 'VYDANE')
      .order('issued_at', { ascending: false })
      .limit(160)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const visibleBaseRows = data || []
    const bulkIssueIds = Array.from(
      new Set(
        visibleBaseRows
          .filter((row: any) => row.sposob === 'HROMADNE' && row.hromadny_vydaj_id)
          .map((row: any) => row.hromadny_vydaj_id)
      )
    )

    let visibleRows = visibleBaseRows

    if (bulkIssueIds.length > 0) {
      const { data: bulkRows, error: bulkRowsError } = await supabaseServer
        .from('vydaj_jedal')
        .select(selectIssued)
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .eq('status', 'VYDANE')
        .in('hromadny_vydaj_id', bulkIssueIds)

      if (bulkRowsError) {
        return NextResponse.json({ error: bulkRowsError.message }, { status: 500 })
      }

      const rowMap = new Map<string, any>()
      visibleBaseRows.forEach((row: any) => rowMap.set(row.id, row))
      ;(bulkRows || [])
        .forEach((row: any) => rowMap.set(row.id, row))
      visibleRows = Array.from(rowMap.values())
    }

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

    const rowToItem = (row: any) => {
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
    }

    const bulkGroups = new Map<string, any[]>()
    const items: any[] = []

    visibleRows.forEach((row: any) => {
      if (row.sposob === 'HROMADNE' && row.hromadny_vydaj_id) {
        const key = row.hromadny_vydaj_id
        bulkGroups.set(key, [...(bulkGroups.get(key) || []), row])
        return
      }

      items.push({
        ...rowToItem(row),
        itemType: 'INDIVIDUAL',
        children: []
      })
    })

    bulkGroups.forEach((rows, issueId) => {
      const first = rows[0]
      const group = groupMap.get(first.group_id)
      const children = rows.map(rowToItem)
      const summary = rows.reduce((acc: any, row: any) => {
        const choice = row.volba === 'MASO' || row.volba === 'VEGE' || row.volba === 'DIETA'
          ? row.volba
          : 'NEZADANE'
        acc[choice] = (acc[choice] || 0) + 1
        return acc
      }, { MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 })

      items.push({
        issuedId: `bulk:${issueId}`,
        itemType: 'BULK',
        typJedla: first.typ_jedla,
        issuedAt: first.issued_at,
        personName: group?.name || 'Hromadný výdaj',
        email: '',
        choice: '',
        method: 'HROMADNE',
        groupName: group?.name || '',
        summary,
        children
      })
    })

    items.sort((a: any, b: any) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())

    return NextResponse.json({
      ok: true,
      items: items.slice(0, 10)
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
