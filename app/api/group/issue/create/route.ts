import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeMealType(value: any) {
  const text = String(value || '').trim().toUpperCase()

  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA' || text === 'VEČERA') return 'VECERA'

  return ''
}

function normalizeDate(value: any) {
  const text = String(value || '').trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''

  return text
}

function normalizeChoice(value: any) {
  const text = String(value || '').trim().toUpperCase()

  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'

  return null
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Nie ste prihlásený.' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const datum = normalizeDate(body.datum)
    const typJedla = normalizeMealType(body.typJedla)

    if (!datum || !typJedla) {
      return NextResponse.json(
        { error: 'Chýba alebo je neplatný dátum / typ jedla.' },
        { status: 400 }
      )
    }

    const { data: membership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      )
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'Nie ste členom žiadnej skupiny.' },
        { status: 400 }
      )
    }

    const myRole = String(membership.role || '').toUpperCase()
    const canCreateIssue = myRole === 'MANAGER' || myRole === 'POVERENY'

    if (!canCreateIssue) {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie vytvoriť hromadný výdaj.' },
        { status: 403 }
      )
    }

    const issueStatus = myRole === 'MANAGER' ? 'READY' : 'WAITING'
    const validAfter =
      myRole === 'POVERENY'
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null

    const { data: existingIssue, error: existingError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id, status, valid_after')
      .eq('group_id', membership.group_id)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .in('status', ['READY', 'WAITING'])
      .maybeSingle()

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      )
    }

    if (existingIssue) {
      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        issueId: existingIssue.id,
        status: existingIssue.status,
        validAfter: existingIssue.valid_after,
        message: 'Hromadný výdaj pre tento deň a typ jedla už existuje.'
      })
    }

    const now = new Date().toISOString()

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .insert({
        group_id: membership.group_id,
        datum,
        typ_jedla: typJedla,
        created_by: user.id,
        created_by_role: myRole,
        status: issueStatus,
        valid_after: validAfter,
        last_changed_at: now,
        updated_at: now
      })
      .select('id, group_id, datum, typ_jedla, status, valid_after')
      .single()

    if (issueError || !issue) {
      return NextResponse.json(
        { error: issueError?.message || 'Hromadný výdaj sa nepodarilo vytvoriť.' },
        { status: 500 }
      )
    }

    const { data: members, error: membersError } = await supabaseServer
      .from('group_members')
      .select(`
        user_id,
        users (
          id,
          typ_stravy
        )
      `)
      .eq('group_id', membership.group_id)

    if (membersError) {
      await supabaseServer
        .from('hromadne_vydaje')
        .delete()
        .eq('id', issue.id)

      return NextResponse.json(
        { error: membersError.message },
        { status: 500 }
      )
    }

    const userIds = (members || []).map((m: any) => m.user_id)

    let selections: any[] = []

    if (userIds.length > 0) {
      const { data: selectionsData, error: selectionsError } = await supabaseServer
        .from('vyber_jedal')
        .select('user_id, volba')
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .in('user_id', userIds)

      if (selectionsError) {
        await supabaseServer
          .from('hromadne_vydaje')
          .delete()
          .eq('id', issue.id)

        return NextResponse.json(
          { error: selectionsError.message },
          { status: 500 }
        )
      }

      selections = selectionsData || []
    }

    const selectionMap = new Map(
      selections.map((s: any) => [s.user_id, normalizeChoice(s.volba)])
    )

    const items = (members || []).map((member: any) => {
      const memberUser = Array.isArray(member.users)
        ? member.users[0]
        : member.users

      const selectedChoice = selectionMap.get(member.user_id)
      const defaultChoice = normalizeChoice(memberUser?.typ_stravy)

      return {
        hromadny_vydaj_id: issue.id,
        user_id: member.user_id,
        source: 'GROUP',
        volba: selectedChoice || defaultChoice,
        status: 'PLANNED',
        added_by: user.id,
        updated_at: now
      }
    })

    if (items.length > 0) {
      const { error: insertItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .insert(items)

      if (insertItemsError) {
        await supabaseServer
          .from('hromadne_vydaje')
          .delete()
          .eq('id', issue.id)

        return NextResponse.json(
          { error: insertItemsError.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      ok: true,
      issueId: issue.id,
      status: issue.status,
      validAfter: issue.valid_after,
      itemsCount: items.length,
      message:
        issue.status === 'WAITING'
          ? 'Hromadný výdaj bol vytvorený a začne platiť o 15 minút.'
          : 'Hromadný výdaj bol vytvorený a je okamžite platný.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}