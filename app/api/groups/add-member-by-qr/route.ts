import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const { group_id, qr_code } = await req.json()

    if (!group_id || !qr_code) {
      return NextResponse.json(
        { error: 'Chýba skupina alebo QR kód.' },
        { status: 400 }
      )
    }

    const cleanQr = String(qr_code).trim()

    const { data: manager } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', group_id)
      .eq('user_id', user.id)
      .in('role', ['OWNER', 'MANAGER'])
      .maybeSingle()

    if (!manager) {
      return NextResponse.json(
        { error: 'Nemáš oprávnenie pridávať členov do tejto skupiny.' },
        { status: 403 }
      )
    }

    const { data: qrUser } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', cleanQr)
      .eq('active', true)
      .maybeSingle()

    if (!qrUser) {
      return NextResponse.json(
        { error: 'QR kód nebol nájdený alebo nie je aktívny.' },
        { status: 404 }
      )
    }

    const { data: profile } = await supabaseServer
      .from('users')
      .select('meno, priezvisko, email')
      .eq('id', qrUser.user_id)
      .maybeSingle()

    const fullName = profile
      ? `${profile.meno || ''} ${profile.priezvisko || ''}`.trim()
      : ''

    const { data: existing } = await supabaseServer
      .from('group_members')
      .select('id')
      .eq('group_id', group_id)
      .eq('user_id', qrUser.user_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        ok: true,
        status: 'EXISTS',
        message: 'Člen už je v skupine.',
        member: {
          user_id: qrUser.user_id,
          meno: profile?.meno || '',
          priezvisko: profile?.priezvisko || '',
          email: profile?.email || '',
          fullName: fullName || profile?.email || cleanQr,
        },
      })
    }

    const { error } = await supabaseServer
      .from('group_members')
      .insert({
        group_id,
        user_id: qrUser.user_id,
        role: 'MEMBER',
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      status: 'ADDED',
      message: 'Člen bol pridaný do skupiny.',
      member: {
        user_id: qrUser.user_id,
        meno: profile?.meno || '',
        priezvisko: profile?.priezvisko || '',
        email: profile?.email || '',
        fullName: fullName || profile?.email || cleanQr,
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}