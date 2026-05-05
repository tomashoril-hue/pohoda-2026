import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

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
    const issueId = String(body.issueId || '').trim()
    const selectedUserIds: string[] = Array.isArray(body.userIds)
      ? body.userIds.map((id: any) => String(id)).filter(Boolean)
      : []

    if (!issueId) {
      return NextResponse.json(
        { error: 'Chýba ID prípravy hromadného výdaja.' },
        { status: 400 }
      )
    }

    if (!selectedUserIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybrané žiadne osoby v príprave.' },
        { status: 400 }
      )
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id, group_id, datum, typ_jedla, status')
      .eq('id', issueId)
      .maybeSingle()

    if (issueError) {
      return NextResponse.json({ error: issueError.message }, { status: 500 })
    }

    if (!issue) {
      return NextResponse.json(
        { error: 'Príprava hromadného výdaja sa nenašla.' },
        { status: 404 }
      )
    }

    if (issue.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Táto príprava je už zrušená.' },
        { status: 400 }
      )
    }

    const { data: membership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', issue.group_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 })
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'Nie ste členom tejto skupiny.' },
        { status: 403 }
      )
    }

    const myRole = String(membership.role || '').toUpperCase()

    if (myRole !== 'MANAGER' && myRole !== 'POVERENY') {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie upraviť prípravu hromadného výdaja.' },
        { status: 403 }
      )
    }

    const { data: selectedMembers, error: selectedMembersError } = await supabaseServer
      .from('group_members')
      .select(`
        user_id,
        users (
          id,
          typ_stravy
        )
      `)
      .eq('group_id', issue.group_id)
      .in('user_id', selectedUserIds)

    if (selectedMembersError) {
      return NextResponse.json({ error: selectedMembersError.message }, { status: 500 })
    }

    if (!selectedMembers || selectedMembers.length === 0) {
      return NextResponse.json(
        { error: 'Vybrané osoby nepatria do vašej skupiny.' },
        { status: 400 }
      )
    }

    const selectedSet = new Set(selectedMembers.map((m: any) => m.user_id))
    const now = new Date().toISOString()

    const newStatus = myRole === 'POVERENY' ? 'WAITING' : 'READY'
    const newValidAfter =
      myRole === 'POVERENY'
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null

    const { error: updateIssueError } = await supabaseServer
      .from('hromadne_vydaje')
      .update({
        status: newStatus,
        valid_after: newValidAfter,
        last_changed_at: now,
        updated_at: now
      })
      .eq('id', issue.id)

    if (updateIssueError) {
      return NextResponse.json({ error: updateIssueError.message }, { status: 500 })
    }

    const { data: currentItems, error: currentItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select('id, user_id, status, remove_reason')
      .eq('hromadny_vydaj_id', issue.id)

    if (currentItemsError) {
      return NextResponse.json({ error: currentItemsError.message }, { status: 500 })
    }

    const plannedToRemove = (currentItems || [])
      .filter((item: any) => {
        return item.status === 'PLANNED' && !selectedSet.has(item.user_id)
      })
      .map((item: any) => item.id)

    if (plannedToRemove.length > 0) {
      const { error: removeError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'REMOVED',
          remove_reason: 'MANUAL',
          removed_at: now,
          removed_by: user.id,
          updated_at: now
        })
        .in('id', plannedToRemove)

      if (removeError) {
        return NextResponse.json({ error: removeError.message }, { status: 500 })
      }
    }

    const removedItemsToRestore = (currentItems || [])
      .filter((item: any) => {
        return (
          item.status === 'REMOVED' &&
          item.remove_reason !== 'REMOVED_FROM_GROUP' &&
          selectedSet.has(item.user_id)
        )
      })

    if (removedItemsToRestore.length > 0) {
      const { error: restoreError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'PLANNED',
          remove_reason: null,
          removed_at: null,
          removed_by: null,
          updated_at: now
        })
        .in('id', removedItemsToRestore.map((item: any) => item.id))

      if (restoreError) {
        return NextResponse.json({ error: restoreError.message }, { status: 500 })
      }
    }

    const existingUserIds = new Set(
      (currentItems || []).map((item: any) => item.user_id)
    )

    const usersToAdd = selectedMembers.filter((member: any) => {
      return !existingUserIds.has(member.user_id)
    })

    let selections: any[] = []

    if (usersToAdd.length > 0) {
      const { data: selectionsData, error: selectionsError } = await supabaseServer
        .from('vyber_jedal')
        .select('user_id, volba')
        .eq('datum', issue.datum)
        .eq('typ_jedla', issue.typ_jedla)
        .in('user_id', usersToAdd.map((m: any) => m.user_id))

      if (selectionsError) {
        return NextResponse.json({ error: selectionsError.message }, { status: 500 })
      }

      selections = selectionsData || []
    }

    const selectionMap = new Map(
      selections.map((s: any) => [s.user_id, normalizeChoice(s.volba)])
    )

    const newItems = usersToAdd.map((member: any) => {
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

    if (newItems.length > 0) {
      const { error: insertError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .insert(newItems)

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      ok: true,
      status: newStatus,
      validAfter: newValidAfter,
      message:
        newStatus === 'WAITING'
          ? 'Úprava prípravy bola potvrdená. Príprava začne platiť o 15 minút.'
          : 'Úprava prípravy bola potvrdená a je aktívna.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}