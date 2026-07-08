import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemáš oprávnenie.' }, { status: 403 })
    }

    const body = await req.json()
    const name = String(body.name || '').trim()

    if (!name) {
      return NextResponse.json({ error: 'Zadaj názov registračnej skupiny.' }, { status: 400 })
    }

    const { data, error } = await supabaseServer
      .from('registration_groups')
      .insert({
        name,
        created_by: actor.id
      })
      .select('id, name, active, production_village_dinner')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      group: data,
      message: 'Registračná skupina bola vytvorená.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznáma chyba servera.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemas opravnenie.' }, { status: 403 })
    }

    const body = await req.json()
    const groupId = String(body.groupId || body.id || '').trim()

    if (!groupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString()
    }

    if (typeof body.productionVillageDinner === 'boolean') {
      updates.production_village_dinner = body.productionVillageDinner
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'Nie je co ulozit.' }, { status: 400 })
    }

    const { data, error } = await supabaseServer
      .from('registration_groups')
      .update(updates)
      .eq('id', groupId)
      .select('id, name, active, production_village_dinner')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      group: data,
      message: 'Registracna skupina bola ulozena.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
