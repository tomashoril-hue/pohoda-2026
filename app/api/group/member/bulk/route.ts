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

    const memberIds: string[] = Array.isArray(body.memberIds)
      ? body.memberIds.map((id: any) => String(id)).filter(Boolean)
      : []

    const action = String(body.action || '').trim().toUpperCase()
    const role = String(body.role || '').trim().toUpperCase()

    if (!memberIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybraní žiadni členovia.' },
        { status: 400 }
      )
    }

    const { data: targetMembers, error: targetError } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .in('id', memberIds)

    if (targetError) {
      return NextResponse.json(
        { error: targetError.message },
        { status: 500 }
      )
    }

    if (!targetMembers || targetMembers.length === 0) {
      return NextResponse.json(
        { error: 'Vybraní členovia sa nenašli.' },
        { status: 404 }
      )
    }

    const groupIds = Array.from(
      new Set(targetMembers.map((member: any) => member.group_id))
    )

    if (groupIds.length !== 1) {
      return NextResponse.json(
        { error: 'Vybraní členovia musia patriť do jednej skupiny.' },
        { status: 400 }
      )
    }

    const groupId = groupIds[0]

    const globalAccess = await getGlobalAccess(user.id)

    const { data: myMembership, error: myMembershipError } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (myMembershipError) {
      return NextResponse.json(
        { error: myMembershipError.message },
        { status: 500 }
      )
    }

    const myRole = String(myMembership?.role || '').toUpperCase()

    if ((!myMembership && !globalAccess.isAdmin) || !canManageGroupByRole(myRole, globalAccess)) {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie upravovať členov tejto skupiny.' },
        { status: 403 }
      )
    }

    const selfSelected = targetMembers.some((member: any) => {
      return member.user_id === user.id
    })

    if (action === 'REMOVE') {
      if (selfSelected && !globalAccess.isAdmin) {
        return NextResponse.json(
          { error: 'Nemôžete odobrať sám seba zo skupiny cez hromadnú úpravu.' },
          { status: 400 }
        )
      }

      const targetUserIds = targetMembers
        .map((member: any) => member.user_id)
        .filter(Boolean)

      const { data: activeIssues, error: activeIssuesError } = await supabaseServer
        .from('hromadne_vydaje')
        .select('id')
        .eq('group_id', groupId)
        .in('status', ['READY', 'WAITING'])

      if (activeIssuesError) {
        return NextResponse.json(
          { error: activeIssuesError.message },
          { status: 500 }
        )
      }

      const activeIssueIds = (activeIssues || []).map((issue: any) => issue.id)

      if (activeIssueIds.length > 0 && targetUserIds.length > 0) {
        const now = new Date().toISOString()

        const { error: updateItemsError } = await supabaseServer
          .from('hromadny_vydaj_polozky')
          .update({
            status: 'REMOVED',
            remove_reason: 'REMOVED_FROM_GROUP',
            removed_at: now,
            removed_by: user.id,
            updated_at: now
          })
          .in('hromadny_vydaj_id', activeIssueIds)
          .in('user_id', targetUserIds)
          .eq('status', 'PLANNED')

        if (updateItemsError) {
          return NextResponse.json(
            { error: updateItemsError.message },
            { status: 500 }
          )
        }
      }

      const { error: deleteError } = await supabaseServer
        .from('group_members')
        .delete()
        .in('id', memberIds)

      if (deleteError) {
        return NextResponse.json(
          { error: deleteError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        message:
          'Členovia boli odobratí zo skupiny. Ak boli v aktívnej príprave hromadného výdaja, boli označení ako odstránení zo skupiny.'
      })
    }

    if (action === 'ROLE') {
      const allowedRoles = ['MEMBER', 'POVERENY', 'MANAGER']

      if (!allowedRoles.includes(role)) {
        return NextResponse.json(
          { error: 'Neplatná rola.' },
          { status: 400 }
        )
      }

      if (role === 'MANAGER' && !globalAccess.canUsePersonalista) {
        return NextResponse.json(
          { error: 'Rolu MANAGER moze nastavit iba ADMIN alebo PERSONALISTA.' },
          { status: 403 }
        )
      }

      if (selfSelected && !globalAccess.isAdmin && role !== myRole) {
        return NextResponse.json(
          { error: 'Nemôžete zmeniť vlastnú rolu cez hromadnú úpravu.' },
          { status: 400 }
        )
      }

      const { error: updateRoleError } = await supabaseServer
        .from('group_members')
        .update({ role })
        .in('id', memberIds)

      if (updateRoleError) {
        return NextResponse.json(
          { error: updateRoleError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        ok: true,
        message: 'Rola členov bola upravená.'
      })
    }

    return NextResponse.json(
      { error: 'Neplatná akcia.' },
      { status: 400 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}
