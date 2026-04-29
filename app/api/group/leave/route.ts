import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select('id, group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Nie ste členom žiadnej skupiny.' }, { status: 400 })
    }

    if (membership.role === 'OWNER') {
      const { data: owners } = await supabaseServer
        .from('group_members')
        .select('id')
        .eq('group_id', membership.group_id)
        .eq('role', 'OWNER')

      if (!owners || owners.length <= 1) {
        return NextResponse.json(
          { error: 'Nemôžete opustiť skupinu ako jediný OWNER. Najprv nastavte iného člena ako OWNER.' },
          { status: 400 }
        )
      }
    }

    const { error } = await supabaseServer
      .from('group_members')
      .delete()
      .eq('id', membership.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}