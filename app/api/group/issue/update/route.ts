import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeChoice(value: any) {
  const text = String(value || '').trim().toUpperCase()

  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'

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
    const issueId = String(body.issueId || '').trim()

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
      .eq('group_id', groupId)
      .maybeSingle()

    if (issueError) {
      return NextResponse.json({ error: issueError.message }, { status: 500 })
    }

    if (!issue) {
      return NextResponse.json(
        { error: 'Príprava hromadného výdaja sa nenašla alebo nepatrí do tejto skupiny.' },
        { status: 404 }
      )
    }

    if (issue.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Táto príprava je už zrušená.' },
        { status: 400 }
      )
    }

    const globalAccess = await getGlobalAccess(user.id)

    const { data: membership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 })
    }

    if (!membership && !globalAccess.isAdmin) {
      return NextResponse.json(
        { error: 'Nie ste členom tejto skupiny.' },
        { status: 403 }
      )
    }

    const myRole = String(membership?.role || '').toUpperCase()

    if (!canIssueForGroupByRole(myRole, globalAccess)) {
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
          typ_stravy,
          aktivny
        )
      `)
      .eq('group_id', groupId)
      .in('user_id', selectedUserIds)

    if (selectedMembersError) {
      return NextResponse.json({ error: selectedMembersError.message }, { status: 500 })
    }

    const selectedQrExtraUserIds = selectedUserIds.filter((id: string) => {
      return qrExtraUserIds.includes(id)
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

    const allSelectedUserIds = Array.from(
      new Set([
        ...selectedGroupMembers.map((m: any) => m.user_id),
        ...selectedQrExtraUserIds
      ])
    )

    const selectedSet = new Set(allSelectedUserIds)

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
      .eq('group_id', groupId)

    if (updateIssueError) {
      return NextResponse.json({ error: updateIssueError.message }, { status: 500 })
    }

    const { data: currentItems, error: currentItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select('id, user_id, status, remove_reason, source')
      .eq('hromadny_vydaj_id', issue.id)

    if (currentItemsError) {
      return NextResponse.json({ error: currentItemsError.message }, { status: 500 })
    }

    const currentItemsSafe = currentItems || []

    const { data: issuedMeals, error: issuedError } = await supabaseServer
      .from('vydaj_jedal')
      .select('user_id, sposob, status')
      .eq('datum', issue.datum)
      .eq('typ_jedla', issue.typ_jedla)
      .eq('status', 'VYDANE')
      .in('user_id', allSelectedUserIds)

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
      .in('user_id', allSelectedUserIds)

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
        otherIssue.id !== issue.id &&
        otherIssue.group_id !== groupId &&
        otherIssue.datum === issue.datum &&
        otherIssue.typ_jedla === issue.typ_jedla &&
        (otherIssue.status === 'READY' || otherIssue.status === 'WAITING')
      ) {
        if (selectedQrExtraUserIds.includes(item.user_id)) {
          movedFromOtherIssueItemIds.add(item.id)
        } else {
          conflictUserIds.add(item.user_id)
        }
      }
    })

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
        return NextResponse.json(
          { error: moveOldItemsError.message },
          { status: 500 }
        )
      }
    }

    const plannedToRemove = currentItemsSafe
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

    const existingItemByUserId = new Map(
      currentItemsSafe.map((item: any) => [item.user_id, item])
    )

    const existingUserIds = new Set(
      currentItemsSafe.map((item: any) => item.user_id)
    )

    let selections: any[] = []

    if (allSelectedUserIds.length > 0) {
      const { data: selectionsData, error: selectionsError } = await supabaseServer
        .from('vyber_jedal')
        .select('user_id, volba')
        .eq('datum', issue.datum)
        .eq('typ_jedla', issue.typ_jedla)
        .in('user_id', allSelectedUserIds)

      if (selectionsError) {
        return NextResponse.json({ error: selectionsError.message }, { status: 500 })
      }

      selections = selectionsData || []
    }

    const selectionMap = new Map(
      selections.map((s: any) => [s.user_id, normalizeChoice(s.volba)])
    )

    const { data: qrUsersData, error: qrUsersError } = await supabaseServer
      .from('users')
      .select('id, typ_stravy, aktivny')
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
    const defaultChoiceMap = new Map<string, string | null>()

    selectedGroupMembers.forEach((member: any) => {
      const memberUser = Array.isArray(member.users)
        ? member.users[0]
        : member.users

      defaultChoiceMap.set(member.user_id, normalizeChoice(memberUser?.typ_stravy))
    })

    selectedQrExtraUserIds.forEach((userId: string) => {
      defaultChoiceMap.set(userId, normalizeChoice(qrUsersMap.get(userId)?.typ_stravy))
    })

    const blockedUserIds = new Set<string>([
      ...selectedGroupMembers
        .filter((member: any) => {
          const memberUser = Array.isArray(member.users)
            ? member.users[0]
            : member.users

          return String(memberUser?.aktivny || '').toUpperCase() !== 'ANO'
        })
        .map((member: any) => member.user_id),
      ...selectedQrExtraUserIds.filter((userId: string) => {
        return String(qrUsersMap.get(userId)?.aktivny || 'ANO').toUpperCase() !== 'ANO'
      })
    ])

    const rowsToRestoreOrBlock = allSelectedUserIds
      .filter((userId: string) => existingUserIds.has(userId))
      .map((userId: string) => {
        const existingItem: any = existingItemByUserId.get(userId)
        const issuedMeal = issuedMap.get(userId)
        const conflict = conflictUserIds.has(userId)
        const blocked = blockedUserIds.has(userId)
        const shouldBeQrExtra = selectedQrExtraUserIds.includes(userId)

        return {
          existingItem,
          update: {
            status: blocked
              ? 'REMOVED'
              : issuedMeal
                ? issuedStatusToItemStatus(issuedMeal)
                : conflict
                  ? 'REMOVED'
                  : 'PLANNED',
            remove_reason: blocked
              ? 'USER_BLOCKED'
              : conflict
                ? 'IN_OTHER_ISSUE'
                : null,
            removed_at: blocked || conflict ? now : null,
            removed_by: blocked || conflict ? user.id : null,
            source: shouldBeQrExtra ? 'QR_EXTRA' : existingItem.source || 'GROUP',
            volba: selectionMap.get(userId) || defaultChoiceMap.get(userId) || null,
            updated_at: now
          }
        }
      })

    for (const item of rowsToRestoreOrBlock) {
      const { error: updateItemError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update(item.update)
        .eq('id', item.existingItem.id)

      if (updateItemError) {
        return NextResponse.json({ error: updateItemError.message }, { status: 500 })
      }
    }

    const usersToAddGroup = selectedGroupMembers.filter((member: any) => {
      return !existingUserIds.has(member.user_id)
    })

    const usersToAddQr = selectedQrExtraUserIds.filter((userId: string) => {
      return !existingUserIds.has(userId)
    })

    const newGroupItems = usersToAddGroup.map((member: any) => {
      const memberUser = Array.isArray(member.users)
        ? member.users[0]
        : member.users

      const selectedChoice = selectionMap.get(member.user_id)
      const defaultChoice = normalizeChoice(memberUser?.typ_stravy)

      const issuedMeal = issuedMap.get(member.user_id)
      const conflict = conflictUserIds.has(member.user_id)
      const blocked = String(memberUser?.aktivny || '').toUpperCase() !== 'ANO'

      return {
        hromadny_vydaj_id: issue.id,
        user_id: member.user_id,
        source: 'GROUP',
        volba: selectedChoice || defaultChoice,
        status: blocked
          ? 'REMOVED'
          : issuedMeal
            ? issuedStatusToItemStatus(issuedMeal)
            : conflict
              ? 'REMOVED'
              : 'PLANNED',
        remove_reason: blocked
          ? 'USER_BLOCKED'
          : conflict
            ? 'IN_OTHER_ISSUE'
            : null,
        removed_at: blocked || conflict ? now : null,
        removed_by: blocked || conflict ? user.id : null,
        added_by: user.id,
        updated_at: now
      }
    })

    const newQrItems = usersToAddQr.map((userId: string) => {
      const qrUser = qrUsersMap.get(userId)
      const selectedChoice = selectionMap.get(userId)
      const defaultChoice = normalizeChoice(qrUser?.typ_stravy)

      const issuedMeal = issuedMap.get(userId)
      const conflict = conflictUserIds.has(userId)
      const blocked = String(qrUser?.aktivny || 'ANO').toUpperCase() !== 'ANO'

      return {
        hromadny_vydaj_id: issue.id,
        user_id: userId,
        source: 'QR_EXTRA',
        volba: selectedChoice || defaultChoice,
        status: blocked
          ? 'REMOVED'
          : issuedMeal
            ? issuedStatusToItemStatus(issuedMeal)
            : conflict
            ? 'REMOVED'
            : 'PLANNED',
        remove_reason: blocked
          ? 'USER_BLOCKED'
          : conflict
            ? 'IN_OTHER_ISSUE'
            : null,
        removed_at: blocked || conflict ? now : null,
        removed_by: blocked || conflict ? user.id : null,
        added_by: user.id,
        updated_at: now
      }
    })

    const newItems = [...newGroupItems, ...newQrItems]

    if (newItems.length > 0) {
      const { error: insertError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .insert(newItems)

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    const blockedCount =
      rowsToRestoreOrBlock.filter((item: any) => item.update.status !== 'PLANNED').length +
      newItems.filter((item: any) => item.status !== 'PLANNED').length

    const movedCount = movedFromOtherIssueItemIds.size

    return NextResponse.json({
      ok: true,
      status: newStatus,
      validAfter: newValidAfter,
      blockedCount,
      movedCount,
      message:
        newStatus === 'WAITING'
          ? `Úprava prípravy bola potvrdená. Príprava začne platiť o 15 minút.${movedCount ? ` Presunutých cez QR: ${movedCount}.` : ''}${blockedCount ? ` Vyradených/nevydateľných: ${blockedCount}.` : ''}`
          : `Úprava prípravy bola potvrdená a je aktívna.${movedCount ? ` Presunutých cez QR: ${movedCount}.` : ''}${blockedCount ? ` Vyradených/nevydateľných: ${blockedCount}.` : ''}`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}
