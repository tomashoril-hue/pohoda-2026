import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import { cleanText, getIssueAccess, loadUsersByIds, normalizeDate } from '@/lib/registrationGroupIssue'

function normalizeUserIds(value: any) {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

function bratislavaTodayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function assertEditableDate(date: string) {
  if (date < bratislavaTodayIsoDate()) {
    throw Object.assign(new Error('Starší skupinový výdaj je možné iba prezerať.'), { status: 400 })
  }
}

async function assertIssueHasEditableItems(issueId: string) {
  const { count, error } = await supabaseServer
    .from('registration_group_issue_items')
    .select('id', { count: 'exact', head: true })
    .eq('issue_id', issueId)
    .eq('status', 'PLANNED')

  if (error) throw error

  if ((count || 0) === 0) {
    throw Object.assign(new Error('Z tohto skupinového výdaja už nie je možné upraviť žiadnu osobu.'), { status: 400 })
  }
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

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'Pridaj aspon jednu osobu opravnenu prevziat vydaj.' }, { status: 400 })
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('registration_group_issues')
      .select('id, registration_group_id, datum, status')
      .eq('id', issueId)
      .maybeSingle()

    if (issueError) throw issueError
    if (!issue) return NextResponse.json({ error: 'Skupinovy vydaj neexistuje.' }, { status: 404 })
    if (issue.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Zruseny vydaj nie je mozne upravit.' }, { status: 400 })
    }

    const date = normalizeDate(issue.datum)
    if (!date) {
      return NextResponse.json({ error: 'Neplatný skupinový výdaj.' }, { status: 400 })
    }
    assertEditableDate(date)
    await assertIssueHasEditableItems(issue.id)

    const access = await getIssueAccess(actor.id, issue.registration_group_id)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const { error: deactivateError } = await supabaseServer
      .from('registration_group_issue_pickup_users')
      .update({
        active: false,
        removed_at: new Date().toISOString(),
        removed_by: actor.id
      })
      .eq('issue_id', issue.id)
      .not('user_id', 'in', `(${userIds.join(',')})`)

    if (deactivateError) throw deactivateError

    const { error: upsertError } = await supabaseServer
      .from('registration_group_issue_pickup_users')
      .upsert(userIds.map(userId => ({
        issue_id: issue.id,
        user_id: userId,
        created_by: actor.id,
        active: true,
        removed_at: null,
        removed_by: null
      })), {
        onConflict: 'issue_id,user_id'
      })

    if (upsertError) throw upsertError

    const users = await loadUsersByIds(userIds)
    const userById = new Map(users.map((user: any) => [user.id, user]))
    const pickupUsers = userIds.map(userId => {
      const user: any = userById.get(userId)
      return {
        id: userId,
        name: `${user?.meno || ''} ${user?.priezvisko || ''}`.trim() || user?.email || userId,
        email: user?.email || ''
      }
    })

    return NextResponse.json({
      ok: true,
      pickupUserIds: userIds,
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
