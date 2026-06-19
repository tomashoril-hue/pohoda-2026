import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import { cleanText, getIssueAccess, loadUsersByIds } from '@/lib/registrationGroupIssue'

function normalizeUserIds(value: any) {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const issueId = cleanText(body.issueId)
    const userIds = normalizeUserIds(body.pickupUserIds)

    if (!issueId) {
      return NextResponse.json({ error: 'Chyba skupinovy vydaj.' }, { status: 400 })
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('registration_group_issues')
      .select('id, registration_group_id, status')
      .eq('id', issueId)
      .maybeSingle()

    if (issueError) throw issueError
    if (!issue) return NextResponse.json({ error: 'Skupinovy vydaj neexistuje.' }, { status: 404 })
    if (issue.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Zruseny vydaj nie je mozne upravit.' }, { status: 400 })
    }

    const access = await getIssueAccess(actor.id, issue.registration_group_id)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const finalUserIds = userIds.length > 0 ? userIds : [actor.id]
    const { error: deleteError } = await supabaseServer
      .from('registration_group_issue_pickup_users')
      .delete()
      .eq('issue_id', issue.id)

    if (deleteError) throw deleteError

    const { error: insertError } = await supabaseServer
      .from('registration_group_issue_pickup_users')
      .insert(finalUserIds.map(userId => ({
        issue_id: issue.id,
        user_id: userId,
        created_by: actor.id
      })))

    if (insertError) throw insertError

    const users = await loadUsersByIds(finalUserIds)
    const userById = new Map(users.map((user: any) => [user.id, user]))
    const pickupUsers = finalUserIds.map(userId => {
      const user: any = userById.get(userId)
      return {
        id: userId,
        name: `${user?.meno || ''} ${user?.priezvisko || ''}`.trim() || user?.email || userId,
        email: user?.email || ''
      }
    })

    return NextResponse.json({
      ok: true,
      pickupUserIds: finalUserIds,
      pickupUsers,
      message: 'Opravneni prevziat boli ulozeni.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}
