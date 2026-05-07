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
    const inviteId = String(body.inviteId || '')
    const action = String(body.action || '').toUpperCase()

    if (!inviteId) {
      return NextResponse.json(
        { error: 'Chýba ID pozvánky.' },
        { status: 400 }
      )
    }

    if (action !== 'ACCEPT' && action !== 'DECLINE') {
      return NextResponse.json(
        { error: 'Neplatná akcia.' },
        { status: 400 }
      )
    }

    const { data: invite, error: inviteError } = await supabaseServer
      .from('group_invites')
      .select('id, group_id, email, status')
      .eq('id', inviteId)
      .maybeSingle()

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Pozvánka sa nenašla.' },
        { status: 404 }
      )
    }

    if (String(invite.email).toLowerCase() !== String(user.email).toLowerCase()) {
      return NextResponse.json(
        { error: 'Táto pozvánka je určená pre iný e-mail.' },
        { status: 403 }
      )
    }

    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Táto pozvánka už nie je aktívna.' },
        { status: 400 }
      )
    }

    if (action === 'DECLINE') {
      const { error } = await supabaseServer
        .from('group_invites')
        .update({
          status: 'DECLINED',
          declined_at: new Date().toISOString()
        })
        .eq('id', invite.id)

      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true })
    }

    const { data: existingMembership } = await supabaseServer
      .from('group_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingMembership) {
      return NextResponse.json(
        { error: 'Už ste členom nejakej skupiny.' },
        { status: 400 }
      )
    }

    const { error: memberError } = await supabaseServer
      .from('group_members')
      .insert({
        group_id: invite.group_id,
        user_id: user.id,
        role: 'MEMBER'
      })

    if (memberError) {
      return NextResponse.json(
        { error: memberError.message },
        { status: 500 }
      )
    }

    await supabaseServer
      .from('group_invites')
      .update({
        status: 'ACCEPTED',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invite.id)

    await supabaseServer
      .from('group_invites')
      .update({
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString()
      })
      .eq('email', String(user.email).toLowerCase())
      .eq('status', 'PENDING')
      .neq('id', invite.id)

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}