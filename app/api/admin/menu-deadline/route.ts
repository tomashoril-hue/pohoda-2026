import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const { datum, typ_jedla, deadline_at, locked } = body

    if (!datum || !typ_jedla) {
      return NextResponse.json(
        { error: 'Chýba dátum alebo typ jedla.' },
        { status: 400 }
      )
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum)) || !['OBED', 'VECERA'].includes(String(typ_jedla))) {
      return NextResponse.json(
        { error: 'Neplatný dátum alebo typ jedla.' },
        { status: 400 }
      )
    }

    const payload: any = {
      datum,
      typ_jedla,
      deadline_at: deadline_at || null,
      locked: Boolean(locked),
      locked_by: locked ? user.id : null,
      locked_at: locked ? new Date().toISOString() : null,
    }

    const { data, error } = await supabaseServer
      .from('menu_deadlines')
      .upsert(payload, {
        onConflict: 'datum,typ_jedla',
      })
      .select('datum, typ_jedla, deadline_at, locked')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, deadline: data })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
