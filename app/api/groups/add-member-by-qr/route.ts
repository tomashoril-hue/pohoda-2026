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

    const { data: myMembership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', group_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      )
    }

    const myRole = String(myMembership?.role || '').toUpperCase()

    // Pridať cez QR do skupiny môže iba MANAGER.
    // OWNER nechávame dočasne, kým premigrujeme staré dáta v databáze.
    const canAddMemberByQr =
      myRole === 'MANAGER' ||
      myRole === 'OWNER'

    if (!myMembership || !canAddMemberByQr) {
      return NextResponse.json(
        { error: 'Nemáš oprávnenie pridávať členov do tejto skupiny cez QR.' },
        { status: 403 }
      )
    }

    const { data: qrUser, error: qrError } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', cleanQr)
      .eq('active', true)
      .maybeSingle()

    if (qrError) {
      return NextResponse.json(
        { error: qrError.message },
        { status: 500 }
      )
    }

    if (!qrUser) {
      return NextResponse.json(
        { error: 'QR kód nebol nájdený alebo nie je aktívny.' },
        { status: 404 }
      )
    }

    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('meno, priezvisko, email')
      .eq('id', qrUser.user_id)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      )
    }

    const fullName = profile
      ? `${profile.meno || ''} ${profile.priezvisko || ''}`.trim()
      : ''

    const { data: otherMembership } = await supabaseServer
      .from('group_members')
      .select(`
        id,
        group_id,
        groups (
          name
        )
      `)
      .eq('user_id', qrUser.user_id)
      .neq('group_id', group_id)
      .maybeSingle()

    if (otherMembership) {
      const existingGroup = Array.isArray(otherMembership.groups)
        ? otherMembership.groups[0]
        : otherMembership.groups

      return NextResponse.json(
        {
          error: `Tento používateľ už je členom inej skupiny${existingGroup?.name ? `: ${existingGroup.name}` : '.'}`
        },
        { status: 400 }
      )
    }

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
          fullName: fullName || profile?.email || cleanQr
        }
      })
    }

    const { error } = await supabaseServer
      .from('group_members')
      .insert({
        group_id,
        user_id: qrUser.user_id,
        role: 'MEMBER'
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
        fullName: fullName || profile?.email || cleanQr
      }
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}