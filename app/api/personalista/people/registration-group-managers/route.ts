import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

async function loadManagedGroups(userId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_managers')
    .select(`
      id,
      registration_group_id,
      active,
      registration_groups (
        id,
        name
      )
    `)
    .eq('user_id', userId)
    .eq('active', true)

  if (error) throw error

  return (data || [])
    .map((row: any) => {
      const group = Array.isArray(row.registration_groups)
        ? row.registration_groups[0]
        : row.registration_groups

      return {
        id: row.id,
        registrationGroupId: row.registration_group_id,
        registrationGroupName: group?.name || ''
      }
    })
    .filter((item: any) => item.registrationGroupId && item.registrationGroupName)
    .sort((a: any, b: any) => a.registrationGroupName.localeCompare(b.registrationGroupName, 'sk'))
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const registrationGroupId = cleanText(body.registrationGroupId)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status || 403 })
    }

    const { data: registrationGroup, error: registrationGroupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (registrationGroupError) {
      return NextResponse.json({ error: registrationGroupError.message }, { status: 500 })
    }

    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const { data: beforeRows } = await supabaseServer
      .from('registration_group_managers')
      .select('id, user_id, registration_group_id, active')
      .eq('user_id', userId)
      .eq('registration_group_id', registrationGroupId)

    const now = new Date().toISOString()
    const { error: upsertError } = await supabaseServer
      .from('registration_group_managers')
      .upsert(
        {
          user_id: userId,
          registration_group_id: registrationGroupId,
          active: true,
          created_by: actor.id,
          updated_at: now
        },
        { onConflict: 'user_id,registration_group_id' }
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    const managedRegistrationGroups = await loadManagedGroups(userId)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'REGISTRATION_GROUP_MANAGER_ADDED',
        entity_table: 'registration_group_managers',
        entity_id: registrationGroupId,
        before_data: { rows: beforeRows || [] },
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: registrationGroup.name,
          active: true
        }
      })

    return NextResponse.json({
      ok: true,
      message: 'Opravnenie na skupinovy vydaj bolo pridane.',
      managedRegistrationGroups
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const managerId = cleanText(body.managerId)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!managerId) {
      return NextResponse.json({ error: 'Chyba opravnenie.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status || 403 })
    }

    const { data: beforeRow, error: beforeError } = await supabaseServer
      .from('registration_group_managers')
      .select('id, user_id, registration_group_id, active')
      .eq('id', managerId)
      .eq('user_id', userId)
      .maybeSingle()

    if (beforeError) {
      return NextResponse.json({ error: beforeError.message }, { status: 500 })
    }

    if (!beforeRow) {
      return NextResponse.json({ error: 'Opravnenie neexistuje.' }, { status: 404 })
    }

    const { error: updateError } = await supabaseServer
      .from('registration_group_managers')
      .update({
        active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', managerId)
      .eq('user_id', userId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const managedRegistrationGroups = await loadManagedGroups(userId)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'REGISTRATION_GROUP_MANAGER_REMOVED',
        entity_table: 'registration_group_managers',
        entity_id: managerId,
        before_data: beforeRow,
        after_data: { active: false }
      })

    return NextResponse.json({
      ok: true,
      message: 'Opravnenie na skupinovy vydaj bolo odobrane.',
      managedRegistrationGroups
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
