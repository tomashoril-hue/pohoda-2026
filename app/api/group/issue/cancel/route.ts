import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
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

    if (!issueId) {
      return NextResponse.json(
        { error: 'Chýba ID hromadného výdaja.' },
        { status: 400 }
      )
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .select('id, group_id, status')
      .eq('id', issueId)
      .maybeSingle()

    if (issueError) {
      return NextResponse.json(
        { error: issueError.message },
        { status: 500 }
      )
    }

    if (!issue) {
      return NextResponse.json(
        { error: 'Hromadný výdaj sa nenašiel.' },
        { status: 404 }
      )
    }

    if (issue.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Hromadný výdaj je už zrušený.' },
        { status: 400 }
      )
    }

    if (issue.status === 'ISSUED') {
      return NextResponse.json(
        { error: 'Už vydaný hromadný výdaj nie je možné zrušiť.' },
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

    if (myRole !== 'MANAGER' && myRole !== 'POVERENY') {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie zrušiť hromadný výdaj.' },
        { status: 403 }
      )
    }

    const { count: issuedCount, error: issuedError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select('id', { count: 'exact', head: true })
      .eq('hromadny_vydaj_id', issue.id)
      .in('status', ['BULK_ISSUED', 'INDIVIDUAL_ISSUED'])

    if (issuedError) {
      return NextResponse.json(
        { error: issuedError.message },
        { status: 500 }
      )
    }

    if ((issuedCount || 0) > 0) {
      return NextResponse.json(
        { error: 'Výdaj už obsahuje vydané osoby. Najprv bude potrebné riešiť storno výdaja.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    const { error: updateIssueError } = await supabaseServer
      .from('hromadne_vydaje')
      .update({
        status: 'CANCELLED',
        updated_at: now
      })
      .eq('id', issue.id)

    if (updateIssueError) {
      return NextResponse.json(
        { error: updateIssueError.message },
        { status: 500 }
      )
    }

    const { error: updateItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .update({
        status: 'REMOVED',
        updated_at: now
      })
      .eq('hromadny_vydaj_id', issue.id)
      .eq('status', 'PLANNED')

    if (updateItemsError) {
      return NextResponse.json(
        { error: updateItemsError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Hromadný výdaj bol zrušený.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}
