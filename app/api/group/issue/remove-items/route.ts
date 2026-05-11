import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
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
    const issueId = String(body.issueId || '').trim()
    const itemIds: string[] = Array.isArray(body.itemIds) ? body.itemIds : []

    if (!issueId) {
      return NextResponse.json(
        { error: 'Chýba ID prípravy hromadného výdaja.' },
        { status: 400 }
      )
    }

    if (!itemIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybrané žiadne osoby na vyradenie.' },
        { status: 400 }
      )
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id, group_id, status')
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

    const globalAccess = await getGlobalAccess(user.id)

    const { data: membership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', issue.group_id)
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
        { error: 'Nemáte oprávnenie upravovať prípravu hromadného výdaja.' },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()

    const { error: updateError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .update({
        status: 'REMOVED',
        updated_at: now
      })
      .eq('hromadny_vydaj_id', issue.id)
      .eq('status', 'PLANNED')
      .in('id', itemIds)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Označené osoby boli vyradené z prípravy hromadného výdaja.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}
