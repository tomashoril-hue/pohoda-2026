import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds : []
    const action = String(body.action || '').trim().toUpperCase()
    const role = String(body.role || '').trim().toUpperCase()

    if (!memberIds.length) {
      return NextResponse.json(
        { error: 'Nie sú vybraní žiadni členovia.' },
        { status: 400 }
      )
    }

    const { data: myMembership } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    const myRole = String(myMembership?.role || '').toUpperCase()

    // Dočasne povoľujeme aj OWNER, kým spravíme migráciu databázy.
    // Po migrácii bude hlavná rola MANAGER.
    const canManageMembers = myRole === 'MANAGER' || myRole === 'OWNER'

    if (!myMembership || !canManageMembers) {
      return NextResponse.json(
        { error: 'Nemáte oprávnenie upravovať členov skupiny.' },
        { status: 403 }
      )
    }

    const { data: targetMembers, error: targetError } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .in('id', memberIds)

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 })
    }

    if (!targetMembers || targetMembers.length !== memberIds.length) {
      return NextResponse.json(
        { error: 'Niektorí členovia sa nenašli.' },
        { status: 404 }
      )
    }

    const invalidMember = targetMembers.find(m => m.group_id !== myMembership.group_id)

    if (invalidMember) {
      return NextResponse.json(
        { error: 'Niektorí členovia nepatria do vašej skupiny.' },
        { status: 403 }
      )
    }

    const selfSelected = targetMembers.some(m => m.user_id === user.id)

    if (action === 'REMOVE') {
      if (selfSelected) {
        return NextResponse.json(
          { error: 'Nemôžete odobrať sám seba cez správu členov.' },
          { status: 400 }
        )
      }

      const { error } = await supabaseServer
        .from('group_members')
        .delete()
        .in('id', memberIds)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

    if (action === 'ROLE') {
      if (!['MEMBER', 'POVERENY', 'MANAGER'].includes(role)) {
        return NextResponse.json({ error: 'Neplatná rola.' }, { status: 400 })
      }

      if (selfSelected) {
        return NextResponse.json(
          { error: 'Nemôžete meniť vlastnú rolu.' },
          { status: 400 }
        )
      }

      const { error } = await supabaseServer
        .from('group_members')
        .update({ role })
        .in('id', memberIds)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Neplatná akcia.' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}