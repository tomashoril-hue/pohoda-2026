import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  getIssueAccess,
  loadUsersByIds
} from '@/lib/registrationGroupIssue'

function normalizeUserIds(value: any) {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

function displayName(user: any) {
  const firstName = cleanText(user?.meno)
  const lastName = cleanText(user?.priezvisko)
  return `${lastName} ${firstName}`.trim() || user?.email || user?.id || 'Bez mena'
}

async function assertFoodGroupAccess(actorId: string, registrationGroupId: string, foodGroupId: string) {
  const access = await getIssueAccess(actorId, registrationGroupId)

  if (!access) {
    throw Object.assign(new Error('Nemáš oprávnenie pre túto registračnú skupinu.'), { status: 403 })
  }

  const { data: group, error } = await supabaseServer
    .from('groups')
    .select('id, name, registration_group_id')
    .eq('id', foodGroupId)
    .eq('registration_group_id', registrationGroupId)
    .maybeSingle()

  if (error) throw error
  if (!group) {
    throw Object.assign(new Error('Stravovacia skupina sa nenašla.'), { status: 404 })
  }

  return group
}

async function loadPickupUsers(foodGroupId: string) {
  const { data, error } = await supabaseServer
    .from('group_pickup_users')
    .select('user_id')
    .eq('group_id', foodGroupId)
    .eq('active', true)

  if (error) throw error

  const userIds = (data || []).map((row: any) => row.user_id).filter(Boolean)
  const users = await loadUsersByIds(userIds)
  const userById = new Map(users.map((user: any) => [user.id, user]))

  const pickupUsers = userIds
    .map(userId => {
      const user: any = userById.get(userId)
      if (!user) return null

      return {
        id: userId,
        name: displayName(user),
        email: user.email || ''
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'sk', { sensitivity: 'base' }))

  return {
    pickupUserIds: pickupUsers.map((user: any) => user.id),
    pickupUsers
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const foodGroupId = cleanText(req.nextUrl.searchParams.get('foodGroupId'))

    if (!registrationGroupId || !foodGroupId) {
      return NextResponse.json({ error: 'Chýba registračná alebo stravovacia skupina.' }, { status: 400 })
    }

    const group = await assertFoodGroupAccess(actor.id, registrationGroupId, foodGroupId)
    const pickup = await loadPickupUsers(foodGroupId)

    return NextResponse.json({
      ok: true,
      group: {
        id: group.id,
        name: group.name || '',
        registrationGroupId: group.registration_group_id || ''
      },
      ...pickup
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = cleanText(body.registrationGroupId)
    const foodGroupId = cleanText(body.foodGroupId)
    const pickupUserIds = normalizeUserIds(body.pickupUserIds)

    if (!registrationGroupId || !foodGroupId) {
      return NextResponse.json({ error: 'Chýba registračná alebo stravovacia skupina.' }, { status: 400 })
    }

    await assertFoodGroupAccess(actor.id, registrationGroupId, foodGroupId)

    const { error: deactivateError } = await supabaseServer
      .from('group_pickup_users')
      .update({ active: false })
      .eq('group_id', foodGroupId)

    if (deactivateError) throw deactivateError

    if (pickupUserIds.length > 0) {
      const { error: upsertError } = await supabaseServer
        .from('group_pickup_users')
        .upsert(
          pickupUserIds.map(userId => ({
            group_id: foodGroupId,
            user_id: userId,
            active: true,
            created_by: actor.id
          })),
          { onConflict: 'group_id,user_id' }
        )

      if (upsertError) throw upsertError
    }

    const pickup = await loadPickupUsers(foodGroupId)

    return NextResponse.json({
      ok: true,
      ...pickup,
      message: 'Oprávnení prevziať boli uložení.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}
