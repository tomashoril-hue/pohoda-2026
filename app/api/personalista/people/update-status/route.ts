import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const active = body.active === true
    const reason = cleanText(body.reason)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!active && actor.id === userId) {
      return NextResponse.json(
        { error: 'Nemozes zablokovat vlastny ucet.' },
        { status: 400 }
      )
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const { data: before, error: beforeError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny')
      .eq('id', userId)
      .maybeSingle()

    if (beforeError) {
      return NextResponse.json({ error: beforeError.message }, { status: 500 })
    }

    if (!before) {
      return NextResponse.json({ error: 'Osoba sa nenasla.' }, { status: 404 })
    }

    const nextStatus = active ? 'ANO' : 'NIE'
    const now = new Date().toISOString()

    const { error: updateError } = await supabaseServer
      .from('users')
      .update({
        aktivny: nextStatus,
        updated_at: now
      })
      .eq('id', userId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: active ? 'PERSON_UNBLOCKED' : 'PERSON_BLOCKED',
        entity_table: 'users',
        entity_id: userId,
        before_data: before,
        after_data: {
          aktivny: nextStatus,
          reason: reason || null
        },
        note: reason || null
      })

    return NextResponse.json({
      ok: true,
      message: active ? 'Osoba bola odblokovana.' : 'Osoba bola zablokovana.',
      aktivny: nextStatus
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
