import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManageGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

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

    const sourceGroupId = String(body.sourceGroupId || '').trim()
    const targetGroupId = String(body.targetGroupId || '').trim()
    const userIds: string[] = Array.isArray(body.userIds)
      ? Array.from(new Set(body.userIds.map((id: any) => String(id)).filter(Boolean)))
      : []

    if (!sourceGroupId || !targetGroupId) {
      return NextResponse.json(
        { error: 'Chýba zdrojová alebo cieľová skupina.' },
        { status: 400 }
      )
    }

    if (sourceGroupId === targetGroupId) {
      return NextResponse.json(
        { error: 'Zdrojová a cieľová skupina nemôžu byť rovnaké.' },
        { status: 400 }
      )
    }

    if (!userIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybraní žiadni členovia na presun.' },
        { status: 400 }
      )
    }

    const globalAccess = await getGlobalAccess(user.id)

    const { data: myMemberships, error: membershipsError } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .in('group_id', [sourceGroupId, targetGroupId])

    if (membershipsError) {
      return NextResponse.json(
        { error: membershipsError.message },
        { status: 500 }
      )
    }

    const sourceMembership = (myMemberships || []).find(
      (item: any) => item.group_id === sourceGroupId
    )

    const targetMembership = (myMemberships || []).find(
      (item: any) => item.group_id === targetGroupId
    )

    const sourceRole = String(sourceMembership?.role || '').toUpperCase()
    const targetRole = String(targetMembership?.role || '').toUpperCase()

    const canManageSource = canManageGroupByRole(sourceRole, globalAccess)
    const canManageTarget = canManageGroupByRole(targetRole, globalAccess)

    if (!canManageSource || !canManageTarget) {
      return NextResponse.json(
        { error: 'Na presun členov musíš byť MANAGER alebo OWNER v oboch skupinách.' },
        { status: 403 }
      )
    }

    const { data: movingMemberships, error: movingError } = await supabaseServer
      .from('group_members')
      .select('id, user_id, role')
      .eq('group_id', sourceGroupId)
      .in('user_id', userIds)

    if (movingError) {
      return NextResponse.json(
        { error: movingError.message },
        { status: 500 }
      )
    }

    if (!movingMemberships || movingMemberships.length === 0) {
      return NextResponse.json(
        { error: 'Vybraní používatelia nepatria do zdrojovej skupiny.' },
        { status: 400 }
      )
    }

    const foundUserIds = movingMemberships.map((item: any) => item.user_id)

    const protectedUsers = movingMemberships.filter((item: any) => {
      const role = String(item.role || '').toUpperCase()
      return role === 'MANAGER' || role === 'OWNER'
    })

    if (!globalAccess.isAdmin && protectedUsers.length > 0) {
      return NextResponse.json(
        { error: 'Nie je možné presúvať členov s rolou MANAGER alebo OWNER cez tento rýchly presun.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    const { error: updateMembershipError } = await supabaseServer
      .from('group_members')
      .update({
        group_id: targetGroupId
      })
      .eq('group_id', sourceGroupId)
      .in('user_id', foundUserIds)

    if (updateMembershipError) {
      return NextResponse.json(
        { error: updateMembershipError.message },
        { status: 500 }
      )
    }

    const { data: activeIssues, error: issuesError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id')
      .eq('group_id', sourceGroupId)
      .in('status', ['READY', 'WAITING'])

    if (issuesError) {
      return NextResponse.json(
        { error: issuesError.message },
        { status: 500 }
      )
    }

    const activeIssueIds = (activeIssues || []).map((issue: any) => issue.id)

    let affectedIssueItems = 0

    if (activeIssueIds.length > 0) {
      const { data: changedItems, error: moveItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'REMOVED',
          remove_reason: 'MOVED_TO_OTHER_GROUP',
          removed_at: now,
          removed_by: user.id,
          updated_at: now
        })
        .in('hromadny_vydaj_id', activeIssueIds)
        .in('user_id', foundUserIds)
        .eq('status', 'PLANNED')
        .select('id')

      if (moveItemsError) {
        return NextResponse.json(
          { error: moveItemsError.message },
          { status: 500 }
        )
      }

      affectedIssueItems = changedItems?.length || 0
    }

    return NextResponse.json({
      ok: true,
      movedCount: foundUserIds.length,
      affectedIssueItems,
      message: `Presunutých členov: ${foundUserIds.length}.${affectedIssueItems ? ` V aktívnych prípravách označených ako PRESUNUTÝ: ${affectedIssueItems}.` : ''}`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
