import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    if (!user.id) {
      return NextResponse.json({ error: 'Používateľ nemá ID.' }, { status: 400 })
    }

    const body = await req.json()
    const name = String(body.name || '').trim()

    if (!name) {
      return NextResponse.json({ error: 'Zadajte názov skupiny.' }, { status: 400 })
    }

    const { data: existingMember, error: existingError } = await supabaseServer
      .from('group_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json(
        { error: 'Chyba pri kontrole členstva: ' + existingError.message },
        { status: 500 }
      )
    }

    if (existingMember) {
      return NextResponse.json(
        { error: 'Už ste členom skupiny.' },
        { status: 400 }
      )
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('groups')
      .insert({
        name,
        created_by: user.id
      })
      .select('id, name, created_by')
      .single()

    if (groupError || !group) {
      return NextResponse.json(
        { error: 'Chyba pri vytváraní skupiny: ' + (groupError?.message || 'neznáma chyba') },
        { status: 500 }
      )
    }

    const { error: memberError } = await supabaseServer
      .from('group_members')
      .insert({
        group_id: group.id,
        user_id: user.id,
        role: 'OWNER'
      })

    if (memberError) {
      await supabaseServer
        .from('groups')
        .delete()
        .eq('id', group.id)

      return NextResponse.json(
        { error: 'Chyba pri pridaní vlastníka skupiny: ' + memberError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      group
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}