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

function issuedStatusToItemStatus(row: any) {
  if (!row) return null

  if (row.sposob === 'HROMADNE') return 'BULK_ISSUED'
  return 'INDIVIDUAL_ISSUED'
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

    const groupId = String(body.groupId || '').trim()
    const datum = normalizeDate(body.datum)
    const typJedla = normalizeMealType(body.typJedla)

    const selectedUserIds: string[] = Array.isArray(body.userIds)
      ? Array.from(new Set(body.userIds.map((id: any) => String(id)).filter(Boolean)))
      : []

    const qrExtraUserIds: string[] = Array.isArray(body.qrExtraUserIds)
      ? Array.from(new Set(body.qrExtraUserIds.map((id: any) => String(id)).filter(Boolean)))
      : []

    if (!groupId) {
      return NextResponse.json(
        { error: 'Chýba skupina.' },
        { status: 400 }
      )
    }

    if (!datum || !typJedla) {
      return NextResponse.json(
        { error: 'Chýba alebo je neplatný dátum / typ jedla.' },
        { status: 400 }
      )
    }

    if (!selectedUserIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybrané žiadne osoby do prípravy hromadného výdaja.' },
        { status: 400 }
      )
    }

    const { data: membership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('group_id', groupId)
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
        { error: 'Nie ste členom tejto skupiny.' },
        { status: 403 }
      )
    }

    const myRole = String(membership.role || '').toUpperCase()
    const canCreateIssue =
      myRole === 'MANAGER' ||
      myRole === 'POVERENY' ||
      myRole === 'OWNER'

    if (!canCreateIssue) {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie pripraviť hromadný výdaj.' },
        { status: 403 }
      )
    }

    const { data: existingIssue, error: existingError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id, status, valid_after')
      .eq('group_id', groupId)
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
      return NextResponse.json(
        {
          error:
            'Pre tento dátum a typ jedla už existuje aktívna príprava hromadného výdaja. Najprv ju zrušte alebo upravte.'
        },
        { status: 400 }
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
      .eq('group_id', groupId)
      .in('user_id', selectedUserIds)

    if (selectedMembersError) {
      return NextResponse.json(
        { error: selectedMembersError.message },
        { status: 500 }
      )
    }

    const groupMemberIds = new Set((selectedMembers || []).map((m: any) => m.user_id))

    const selectedQrExtraUserIds = selectedUserIds.filter((id: string) => {
      return qrExtraUserIds.includes(id) && !groupMemberIds.has(id)
    })

    const selectedGroupMembers = (selectedMembers || []).filter((member: any) => {
      return selectedUserIds.includes(member.user_id) && !selectedQrExtraUserIds.includes(member.user_id)
    })

    if (!selectedGroupMembers.length && !selectedQrExtraUserIds.length) {
      return NextResponse.json(
        { error: 'Vybrané osoby nepatria do tejto skupiny alebo neboli pridané cez QR.' },
        { status: 400 }
      )
    }

    const allUserIds = Array.from(
      new Set([
        ...selectedGroupMembers.map((m: any) => m.user_id),
        ...selectedQrExtraUserIds
      ])
    )

    const { data: issuedMeals, error: issuedError } = await supabaseServer
      .from('vydaj_jedal')
      .select('user_id, sposob, status')
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .eq('status', 'VYDANE')
      .in('user_id', allUserIds)

    if (issuedError) {
      return NextResponse.json({ error: issuedError.message }, { status: 500 })
    }

    const issuedMap = new Map(
      (issuedMeals || []).map((row: any) => [row.user_id, row])
    )

    const { data: otherItems, error: otherItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        user_id,
        status,
        hromadny_vydaj_id,
        hromadne_vydaje (
          id,
          group_id,
          datum,
          typ_jedla,
          status
        )
      `)
      .eq('status', 'PLANNED')
      .in('user_id', allUserIds)

    if (otherItemsError) {
      return NextResponse.json({ error: otherItemsError.message }, { status: 500 })
    }

    const conflictUserIds = new Set<string>()
    const movedFromOtherIssueItemIds = new Set<string>()

    ;(otherItems || []).forEach((item: any) => {
      const otherIssue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      if (
        otherIssue &&
        otherIssue.group_id !== groupId &&
        otherIssue.datum === datum &&
        otherIssue.typ_jedla === typJedla &&
        (otherIssue.status === 'READY' || otherIssue.status === 'WAITING')
      ) {
        if (selectedQrExtraUserIds.includes(item.user_id)) {
          movedFromOtherIssueItemIds.add(item.id)
        } else {
          conflictUserIds.add(item.user_id)
        }
      }
    })

    const { data: qrUsersData, error: qrUsersError } = await supabaseServer
      .from('users')
      .select('id, typ_stravy')
      .in(
        'id',
        selectedQrExtraUserIds.length
          ? selectedQrExtraUserIds
          : ['00000000-0000-0000-0000-000000000000']
      )

    if (qrUsersError) {
      return NextResponse.json({ error: qrUsersError.message }, { status: 500 })
    }

    const qrUsersMap = new Map((qrUsersData || []).map((u: any) => [u.id, u]))

    const issueStatus = myRole === 'POVERENY' ? 'WAITING' : 'READY'
    const validAfter =
      myRole === 'POVERENY'
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null

    const now = new Date().toISOString()

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .insert({
        group_id: groupId,
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
        { error: issueError?.message || 'Prípravu hromadného výdaja sa nepodarilo vytvoriť.' },
        { status: 500 }
      )
    }

    if (movedFromOtherIssueItemIds.size > 0) {
      const { error: moveOldItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'REMOVED',
          remove_reason: 'MOVED_TO_OTHER_ISSUE',
          removed_at: now,
          removed_by: user.id,
          updated_at: now
        })
        .in('id', Array.from(movedFromOtherIssueItemIds))

      if (moveOldItemsError) {
        await supabaseServer
          .from('hromadne_vydaje')
          .delete()
          .eq('id', issue.id)

        return NextResponse.json(
          { error: moveOldItemsError.message },
          { status: 500 }
        )
      }
    }

    let selections: any[] = []

    if (allUserIds.length > 0) {
      const { data: selectionsData, error: selectionsError } = await supabaseServer
        .from('vyber_jedal')
        .select('user_id, volba')
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .in('user_id', allUserIds)

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

    const groupItems = selectedGroupMembers.map((member: any) => {
      const memberUser = Array.isArray(member.users)
        ? member.users[0]
        : member.users

      const selectedChoice = selectionMap.get(member.user_id)
      const defaultChoice = normalizeChoice(memberUser?.typ_stravy)

      const issuedMeal = issuedMap.get(member.user_id)
      const conflict = conflictUserIds.has(member.user_id)

      return {
        hromadny_vydaj_id: issue.id,
        user_id: member.user_id,
        source: 'GROUP',
        volba: selectedChoice || defaultChoice,
        status: issuedMeal
          ? issuedStatusToItemStatus(issuedMeal)
          : conflict
            ? 'REMOVED'
            : 'PLANNED',
        remove_reason: conflict ? 'IN_OTHER_ISSUE' : null,
        removed_at: conflict ? now : null,
        removed_by: conflict ? user.id : null,
        added_by: user.id,
        updated_at: now
      }
    })

    const qrItems = selectedQrExtraUserIds.map((userId: string) => {
      const qrUser = qrUsersMap.get(userId)
      const selectedChoice = selectionMap.get(userId)
      const defaultChoice = normalizeChoice(qrUser?.typ_stravy)

      const issuedMeal = issuedMap.get(userId)
      const conflict = conflictUserIds.has(userId)

      return {
        hromadny_vydaj_id: issue.id,
        user_id: userId,
        source: 'QR_EXTRA',
        volba: selectedChoice || defaultChoice,
        status: issuedMeal
          ? issuedStatusToItemStatus(issuedMeal)
          : conflict
            ? 'REMOVED'
            : 'PLANNED',
        remove_reason: conflict ? 'IN_OTHER_ISSUE' : null,
        removed_at: conflict ? now : null,
        removed_by: conflict ? user.id : null,
        added_by: user.id,
        updated_at: now
      }
    })

    const items = [...groupItems, ...qrItems]

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

    const blockedCount = items.filter((item: any) => item.status !== 'PLANNED').length
    const movedCount = movedFromOtherIssueItemIds.size

    return NextResponse.json({
      ok: true,
      issueId: issue.id,
      status: issue.status,
      validAfter: issue.valid_after,
      itemsCount: items.length,
      blockedCount,
      movedCount,
      message:
        issue.status === 'WAITING'
          ? `Príprava hromadného výdaja bola potvrdená a začne platiť o 15 minút.${movedCount ? ` Presunutých cez QR: ${movedCount}.` : ''}${blockedCount ? ` Vyradených/nevydateľných: ${blockedCount}.` : ''}`
          : `Príprava hromadného výdaja bola potvrdená a je okamžite aktívna.${movedCount ? ` Presunutých cez QR: ${movedCount}.` : ''}${blockedCount ? ` Vyradených/nevydateľných: ${blockedCount}.` : ''}`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}