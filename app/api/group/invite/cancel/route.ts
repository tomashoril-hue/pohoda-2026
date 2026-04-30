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

    if (!inviteId) {
      return NextResponse.json(
        { error: 'Chýba ID pozvánky.' },
        { status: 400 }
      )
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json(
        { error: 'Nie ste v skupine.' },
        { status: 400 }
      )
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Pozvánku môže zrušiť iba vlastník skupiny.' },
        { status: 403 }
      )
    }

    const { data: invite, error: inviteError } = await supabaseServer
      .from('group_invites')
      .select('id, group_id, status')
      .eq('id', inviteId)
      .maybeSingle()

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Pozvánka sa nenašla.' },
        { status: 404 }
      )
    }

    if (invite.group_id !== membership.group_id) {
      return NextResponse.json(
        { error: 'Táto pozvánka nepatrí do vašej skupiny.' },
        { status: 403 }
      )
    }

    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Táto pozvánka už nie je aktívna.' },
        { status: 400 }
      )
    }

    const { error } = await supabaseServer
      .from('group_invites')
      .update({
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString()
      })
      .eq('id', invite.id)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}