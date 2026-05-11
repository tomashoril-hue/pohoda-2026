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
    const groupId = String(body.groupId || body.group_id || '').trim()

    if (!groupId) {
      return NextResponse.json(
        { error: 'Chýba skupina.' },
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

    const myRole = String(membership?.role || '').toUpperCase()

    if ((!membership && !globalAccess.isAdmin) || !canManageGroupByRole(myRole, globalAccess)) {
      return NextResponse.json(
        { error: 'Skupinu môže zrušiť iba MANAGER.' },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()

    const { data: issues, error: issuesError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id')
      .eq('group_id', groupId)

    if (issuesError) {
      return NextResponse.json({ error: issuesError.message }, { status: 500 })
    }

    const issueIds = (issues || []).map((issue: any) => issue.id)

    if (issueIds.length > 0) {
      const { error: updateItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'REMOVED',
          remove_reason: 'GROUP_CANCELLED',
          removed_at: now,
          removed_by: user.id,
          updated_at: now
        })
        .in('hromadny_vydaj_id', issueIds)
        .eq('status', 'PLANNED')

      if (updateItemsError) {
        return NextResponse.json({ error: updateItemsError.message }, { status: 500 })
      }

      const { error: cancelIssuesError } = await supabaseServer
        .from('hromadne_vydaje')
        .update({
          status: 'CANCELLED',
          updated_at: now
        })
        .eq('group_id', groupId)
        .in('status', ['READY', 'WAITING'])

      if (cancelIssuesError) {
        return NextResponse.json({ error: cancelIssuesError.message }, { status: 500 })
      }
    }

    const { error: invitesError } = await supabaseServer
      .from('group_invites')
      .delete()
      .eq('group_id', groupId)

    if (invitesError) {
      return NextResponse.json({ error: invitesError.message }, { status: 500 })
    }

    const { error: membersError } = await supabaseServer
      .from('group_members')
      .delete()
      .eq('group_id', groupId)

    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Skupina bola zrušená.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}
