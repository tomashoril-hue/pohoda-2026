import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

async function canManageDelegates(actorId: string, registrationGroupId: string) {
  const access = await getGlobalAccess(actorId)

  if (access.isAdmin) return true

  return canManageRegistrationGroup(actorId, registrationGroupId)
}

async function loadDelegates(registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issue_delegates')
    .select(`
      id,
      user_id,
      registration_group_id,
      active,
      note,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email
      )
    `)
    .eq('registration_group_id', registrationGroupId)
    .eq('active', true)

  if (error) throw error

  return (data || [])
    .map((row: any) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users

      return {
        id: row.id,
        userId: row.user_id,
        registrationGroupId: row.registration_group_id,
        name: `${user?.meno || ''} ${user?.priezvisko || ''}`.trim() || user?.email || 'Bez mena',
        email: user?.email || '',
        note: row.note || '',
        createdAt: row.created_at || ''
      }
    })
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'sk'))
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
    const note = cleanText(body.note)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    const allowed = await canManageDelegates(actor.id, registrationGroupId)

    if (!allowed) {
      return NextResponse.json(
        { error: 'Poverenych moze menit iba admin alebo manager tejto registracnej skupiny.' },
        { status: 403 }
      )
    }

    const [{ data: group, error: groupError }, { data: targetUser, error: userError }] = await Promise.all([
      supabaseServer
        .from('registration_groups')
        .select('id, name, active')
        .eq('id', registrationGroupId)
        .maybeSingle(),
      supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, aktivny')
        .eq('id', userId)
        .maybeSingle()
    ])

    if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 })
    if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })

    if (!group || group.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    if (!targetUser) {
      return NextResponse.json({ error: 'Osoba neexistuje.' }, { status: 404 })
    }

    if (String(targetUser.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json({ error: 'Neaktivnu osobu nie je mozne poverit.' }, { status: 400 })
    }

    const { data: beforeRows } = await supabaseServer
      .from('registration_group_issue_delegates')
      .select('id, user_id, registration_group_id, active, note')
      .eq('user_id', userId)
      .eq('registration_group_id', registrationGroupId)

    const now = new Date().toISOString()
    const { error: upsertError } = await supabaseServer
      .from('registration_group_issue_delegates')
      .upsert(
        {
          user_id: userId,
          registration_group_id: registrationGroupId,
          active: true,
          note: note || null,
          created_by: actor.id,
          updated_at: now
        },
        { onConflict: 'user_id,registration_group_id' }
      )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'REGISTRATION_GROUP_ISSUE_DELEGATE_ADDED',
        entity_table: 'registration_group_issue_delegates',
        entity_id: registrationGroupId,
        before_data: { rows: beforeRows || [] },
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: group.name,
          note: note || null,
          active: true
        }
      })

    return NextResponse.json({
      ok: true,
      message: 'Poverena osoba bola pridana.',
      delegates: await loadDelegates(registrationGroupId)
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
    const delegateId = cleanText(body.delegateId)

    if (!delegateId) {
      return NextResponse.json({ error: 'Chyba poverenie.' }, { status: 400 })
    }

    const { data: beforeRow, error: beforeError } = await supabaseServer
      .from('registration_group_issue_delegates')
      .select('id, user_id, registration_group_id, active, note')
      .eq('id', delegateId)
      .maybeSingle()

    if (beforeError) return NextResponse.json({ error: beforeError.message }, { status: 500 })

    if (!beforeRow) {
      return NextResponse.json({ error: 'Poverenie neexistuje.' }, { status: 404 })
    }

    const allowed = await canManageDelegates(actor.id, beforeRow.registration_group_id)

    if (!allowed) {
      return NextResponse.json(
        { error: 'Poverenych moze menit iba admin alebo manager tejto registracnej skupiny.' },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabaseServer
      .from('registration_group_issue_delegates')
      .update({
        active: false,
        updated_at: now
      })
      .eq('id', delegateId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: beforeRow.user_id,
        action: 'REGISTRATION_GROUP_ISSUE_DELEGATE_REMOVED',
        entity_table: 'registration_group_issue_delegates',
        entity_id: delegateId,
        before_data: beforeRow,
        after_data: { active: false }
      })

    return NextResponse.json({
      ok: true,
      message: 'Poverena osoba bola odobrana.',
      delegates: await loadDelegates(beforeRow.registration_group_id)
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
