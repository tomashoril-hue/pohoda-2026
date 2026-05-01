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
    const itemIds: string[] = Array.isArray(body.itemIds) ? body.itemIds : []

    if (!issueId) {
      return NextResponse.json(
        { error: 'Chýba ID hromadného výdaja.' },
        { status: 400 }
      )
    }

    if (!itemIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybrané žiadne osoby na výdaj.' },
        { status: 400 }
      )
    }

    const { data: issue, error: issueError } = await supabaseServer
      .from('hromadne_vydaje')
      .select(`
        id,
        group_id,
        datum,
        typ_jedla,
        status,
        valid_after
      `)
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
        { error: 'Tento hromadný výdaj je zrušený.' },
        { status: 400 }
      )
    }

    if (issue.status === 'WAITING') {
      const validAfterMs = issue.valid_after
        ? new Date(issue.valid_after).getTime()
        : 0

      if (!validAfterMs || Date.now() < validAfterMs) {
        return NextResponse.json(
          { error: 'Hromadný výdaj ešte nie je aktívny. Počkajte na skončenie odpočtu.' },
          { status: 400 }
        )
      }
    }

    if (issue.status !== 'READY' && issue.status !== 'WAITING') {
      return NextResponse.json(
        { error: 'Tento hromadný výdaj nie je v stave na vydanie.' },
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

    const canIssue =
      myRole === 'MANAGER' ||
      myRole === 'POVERENY'

    if (!canIssue) {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie vydať hromadný výdaj.' },
        { status: 403 }
      )
    }

    const { data: items, error: itemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        hromadny_vydaj_id,
        user_id,
        volba,
        status
      `)
      .eq('hromadny_vydaj_id', issue.id)
      .in('id', itemIds)

    if (itemsError) {
      return NextResponse.json(
        { error: itemsError.message },
        { status: 500 }
      )
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Vybrané osoby sa nenašli.' },
        { status: 404 }
      )
    }

    const invalidItems = items.filter(item => item.status !== 'PLANNED')

    if (invalidItems.length > 0) {
      return NextResponse.json(
        { error: 'Niektoré vybrané osoby už nie sú pripravené na výdaj.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    const issueRows = items.map((item: any) => ({
      user_id: item.user_id,
      group_id: issue.group_id,
      hromadny_vydaj_id: issue.id,
      datum: issue.datum,
      typ_jedla: issue.typ_jedla,
      volba: item.volba,
      sposob: 'HROMADNE',
      status: 'VYDANE',
      issued_by: user.id,
      issued_at: now
    }))

    const { data: insertedRows, error: insertError } = await supabaseServer
      .from('vydaj_jedal')
      .insert(issueRows)
      .select('id, user_id')

    if (insertError) {
      const msg = insertError.message || ''

      if (
        msg.includes('vydaj_jedal_one_active_meal_per_user') ||
        msg.toLowerCase().includes('duplicate key')
      ) {
        return NextResponse.json(
          {
            error:
              'Niektorá osoba už má toto jedlo vydané. Obnovte detail výdaja a skúste znova.'
          },
          { status: 409 }
        )
      }

      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    const issuedUserIds = (insertedRows || []).map((row: any) => row.user_id)

    if (issuedUserIds.length > 0) {
      const { error: updateItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'BULK_ISSUED',
          updated_at: now
        })
        .eq('hromadny_vydaj_id', issue.id)
        .in('user_id', issuedUserIds)

      if (updateItemsError) {
        return NextResponse.json(
          { error: updateItemsError.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      ok: true,
      issuedCount: issuedUserIds.length,
      message: `Vydané osobám: ${issuedUserIds.length}`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}