import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
  }

  const body = await req.json()
  const { datum, typ_jedla, volba } = body

  if (!datum || !typ_jedla || !volba) {
    return NextResponse.json({ error: 'Chýbajú údaje.' }, { status: 400 })
  }

  const { data: deadline } = await supabaseServer
    .from('menu_deadlines')
    .select('deadline_at, locked')
    .eq('datum', datum)
    .eq('typ_jedla', typ_jedla)
    .maybeSingle()

  if (deadline?.locked) {
    return NextResponse.json({ error: 'Výber je už uzamknutý.' }, { status: 403 })
  }

  if (deadline?.deadline_at) {
    if (Date.now() > new Date(deadline.deadline_at).getTime()) {
      return NextResponse.json({ error: 'Čas na zmenu výberu už vypršal.' }, { status: 403 })
    }
  }

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  const { error } = await supabaseServer.from('vyber_jedal').upsert(
    {
      user_id: user.id,
      group_id: membership?.group_id || null,
      datum,
      typ_jedla,
      volba,
      zdroj: 'USER',
    },
    {
      onConflict: 'user_id,datum,typ_jedla',
    }
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}