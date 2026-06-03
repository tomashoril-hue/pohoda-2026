import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanUserIds(value: any) {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .map(item => cleanText(item))
        .filter(Boolean)
    )
  )
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json(
        { error: 'Registracne skupiny moze upravovat iba ADMIN alebo PERSONALISTA.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const registrationGroupId = cleanText(body.registrationGroupId)
    const registrationGroupNote = cleanText(body.registrationGroupNote) || null
    const userIds = cleanUserIds(body.userIds)

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    }

    if (userIds.length > 1000) {
      return NextResponse.json(
        { error: 'Naraz je mozne priradit najviac 1000 osob.' },
        { status: 400 }
      )
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
      return NextResponse.json(
        { error: 'Registracna skupina neexistuje alebo nie je aktivna.' },
        { status: 404 }
      )
    }

    const users: any[] = []

    for (const userIdChunk of chunk(userIds, 250)) {
      const { data, error } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, registration_group_id, registration_group_note')
        .in('id', userIdChunk)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      users.push(...(data || []))
    }

    if (users.length !== userIds.length) {
      return NextResponse.json(
        { error: 'Niektore vybrane osoby sa nenasli. Obnov stranku a skus znova.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const beforeData = users.map(user => ({
      id: user.id,
      email: user.email,
      meno: user.meno,
      priezvisko: user.priezvisko,
      registration_group_id: user.registration_group_id,
      registration_group_note: user.registration_group_note
    }))

    for (const userIdChunk of chunk(userIds, 250)) {
      const { error: updateError } = await supabaseServer
        .from('users')
        .update({
          registration_group_id: registrationGroupId,
          registration_group_note: registrationGroupNote,
          updated_at: now
        })
        .in('id', userIdChunk)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: null,
        action: 'REGISTRATION_GROUP_PEOPLE_ASSIGNED',
        entity_table: 'registration_groups',
        entity_id: registrationGroupId,
        before_data: {
          users: beforeData
        },
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: registrationGroup.name,
          registration_group_note: registrationGroupNote,
          user_ids: userIds,
          users: users.length
        },
        note: `Manualne priradenie ${users.length} osob do registracnej skupiny ${registrationGroup.name}.`
      })

    return NextResponse.json({
      ok: true,
      updated: users.length,
      message: `Do registracnej skupiny ${registrationGroup.name} bolo priradenych ${users.length} osob.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
