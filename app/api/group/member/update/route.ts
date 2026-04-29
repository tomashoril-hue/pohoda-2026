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
    const memberId = String(body.memberId || '').trim()
    const action = String(body.action || '').trim()
    const role = String(body.role || '').trim()

    if (!memberId) {
      return NextResponse.json({ error: 'Chýba člen.' }, { status: 400 })
    }

    const { data: myMembership } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!myMembership || myMembership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Nemáte oprávnenie.' }, { status: 403 })
    }

    const { data: targetMember } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .eq('id', memberId)
      .maybeSingle()

    if (!targetMember) {
      return NextResponse.json({ error: 'Člen neexistuje.' }, { status: 404 })
    }

    if (targetMember.group_id !== myMembership.group_id) {
      return NextResponse.json({ error: 'Člen nie je vo vašej skupine.' }, { status: 403 })
    }

    if (action === 'REMOVE') {
      if (targetMember.user_id === user.id) {
        return NextResponse.json(
          { error: 'Nemôžete odobrať sám seba ako vlastníka.' },
          { status: 400 }
        )
      }

      const { error } = await supabaseServer
        .from('group_members')
        .delete()
        .eq('id', memberId)

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
        .eq('id', memberId)

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