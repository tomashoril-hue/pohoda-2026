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
    const action = String(body.action || '').trim()
    const role = String(body.role || '').trim()

    if (!memberIds.length) {
      return NextResponse.json({ error: 'Nie sú vybraní žiadni členovia.' }, { status: 400 })
    }

    const { data: myMembership } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!myMembership || myMembership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Nemáte oprávnenie.' }, { status: 403 })
    }

    const { data: targetMembers, error: targetError } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .in('id', memberIds)

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 })
    }

    const invalidMember = targetMembers?.find(m => m.group_id !== myMembership.group_id)

    if (invalidMember) {
      return NextResponse.json(
        { error: 'Niektorí členovia nepatria do vašej skupiny.' },
        { status: 403 }
      )
    }

    const selfSelected = targetMembers?.some(m => m.user_id === user.id)

    if (action === 'REMOVE') {
      if (selfSelected) {
        return NextResponse.json(
          { error: 'Nemôžete hromadne odobrať sám seba.' },
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
      if (!['MEMBER', 'MANAGER', 'OWNER'].includes(role)) {
        return NextResponse.json({ error: 'Neplatná rola.' }, { status: 400 })
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