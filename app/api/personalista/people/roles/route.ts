import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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

    const access = await getGlobalAccess(actor.id)

    if (!access.isAdmin) {
      return NextResponse.json(
        { error: 'Globalne role moze menit iba ADMIN.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const requestedRoles: string[] = Array.isArray(body.roles)
      ? Array.from(new Set(body.roles.map((role: any) => cleanText(role).toUpperCase()).filter(Boolean)))
      : []

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    const allowedRoles = ['ADMIN', 'PERSONALISTA', 'ADMIN_VYDAJ', 'VYDAJ', 'GROUP_CREATOR', 'WRISTBAND_KIOSK']

    const invalidRole = requestedRoles.find(role => !allowedRoles.includes(role))

    if (invalidRole) {
      return NextResponse.json(
        { error: 'Neplatna rola.' },
        { status: 403 }
      )
    }

    const { data: beforeRows, error: beforeError } = await supabaseServer
      .from('app_user_roles')
      .select('id, user_id, role, active')
      .eq('user_id', userId)

    if (beforeError) {
      return NextResponse.json({ error: beforeError.message }, { status: 500 })
    }

    const nextRoles = new Set(requestedRoles)

    const now = new Date().toISOString()

    for (const role of allowedRoles) {
      const shouldBeActive = nextRoles.has(role)

      const { error: upsertError } = await supabaseServer
        .from('app_user_roles')
        .upsert(
          {
            user_id: userId,
            role,
            active: shouldBeActive,
            created_by: actor.id,
            updated_at: now
          },
          { onConflict: 'user_id,role' }
        )

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 })
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_GLOBAL_ROLES_UPDATED',
        entity_table: 'app_user_roles',
        entity_id: null,
        before_data: { rows: beforeRows || [] },
        after_data: {
          roles: Array.from(nextRoles).filter(role => allowedRoles.includes(role))
        }
      })

    return NextResponse.json({
      ok: true,
      message: 'Globalne role boli ulozene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
