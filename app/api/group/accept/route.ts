import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    const token = req.nextUrl.searchParams.get('token')

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    if (!token) {
      return NextResponse.json({ error: 'Chýba token pozvánky.' }, { status: 400 })
    }

    const { data: existingMember } = await supabaseServer
      .from('group_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingMember) {
      return NextResponse.json(
        { error: 'Už ste členom skupiny.' },
        { status: 400 }
      )
    }

    const { data: invite, error: inviteError } = await supabaseServer
      .from('group_invites')
      .select('id, group_id, email, status')
      .eq('token', token)
      .eq('status', 'PENDING')
      .maybeSingle()

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Pozvánka je neplatná alebo už bola použitá.' },
        { status: 400 }
      )
    }

    if (String(invite.email).toLowerCase() !== String(user.email).toLowerCase()) {
      return NextResponse.json(
        { error: 'Táto pozvánka je určená pre iný e-mail.' },
        { status: 403 }
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

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}