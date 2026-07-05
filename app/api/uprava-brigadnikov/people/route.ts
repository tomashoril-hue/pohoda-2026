import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function fullName(user: any) {
  return `${user?.priezvisko || ''} ${user?.meno || ''}`.trim()
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function resolveAllowedGroup(actorId: string, registrationGroupId: string) {
  const access = await getGlobalAccess(actorId)

  if (access.isAdmin || access.isPersonalista) {
    if (!registrationGroupId) {
      return { error: 'Vyber registracnu skupinu.', status: 400, groupIds: [] as string[] }
    }

    return { groupId: registrationGroupId, groupIds: [] as string[] }
  }

  if (!access.isRegistrationGroupAdmin) {
    return { error: 'Tuto cast moze pouzivat iba ADMIN, PERSONALISTA alebo rola ADMIN_REG_SKUPINY.', status: 403, groupIds: [] as string[] }
  }

  const groupIds = await getManagedRegistrationGroupIds(actorId)

  if (groupIds.length === 0) {
    return { error: 'Nie si managerom ziadnej registracnej skupiny.', status: 403, groupIds }
  }

  const groupId = registrationGroupId || (groupIds.length === 1 ? groupIds[0] : '')

  if (!groupId) {
    return { error: 'Vyber registracnu skupinu.', status: 400, groupIds }
  }

  if (!groupIds.includes(groupId)) {
    return { error: 'Nemozes upravovat tuto registracnu skupinu.', status: 403, groupIds }
  }

  return { groupId, groupIds }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const validFrom = cleanText(req.nextUrl.searchParams.get('validFrom'))
    const validTo = cleanText(req.nextUrl.searchParams.get('validTo'))
    const resolved = await resolveAllowedGroup(actor.id, registrationGroupId)

    if ('error' in resolved) {
      return NextResponse.json(
        { error: resolved.error, managedRegistrationGroupIds: resolved.groupIds },
        { status: resolved.status }
      )
    }

    const groupId = resolved.groupId

    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('id', groupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    if (!group || group.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const [periodResult, profileGroupResult] = await Promise.all([
      supabaseServer
        .from('user_registration_group_periods')
        .select('user_id')
        .eq('registration_group_id', groupId),
      supabaseServer
        .from('users')
        .select('id')
        .eq('registration_group_id', groupId)
    ])

    if (periodResult.error) return NextResponse.json({ error: periodResult.error.message }, { status: 500 })
    if (profileGroupResult.error) return NextResponse.json({ error: profileGroupResult.error.message }, { status: 500 })

    const userIds = Array.from(new Set([
      ...(periodResult.data || []).map((row: any) => row.user_id),
      ...(profileGroupResult.data || []).map((row: any) => row.id)
    ].filter(Boolean)))

    if (userIds.length === 0) {
      return NextResponse.json({
        ok: true,
        group,
        people: []
      })
    }

    const users: any[] = []
    const periods: any[] = []
    const entitlements: any[] = []

    for (const userIdChunk of chunk(userIds, 250)) {
      const [usersResult, periodsResult, entitlementsResult] = await Promise.all([
        supabaseServer
          .from('users')
          .select('id, meno, priezvisko, email, telefon, typ_stravy, qr_code, aktivny, review_status')
          .in('id', userIdChunk),
        supabaseServer
          .from('user_registration_group_periods')
          .select('id, user_id, registration_group_id, valid_from, valid_to')
          .in('user_id', userIdChunk)
          .eq('registration_group_id', groupId)
          .order('valid_from', { ascending: true }),
        isIsoDate(validFrom) && isIsoDate(validTo) && validTo >= validFrom
          ? supabaseServer
            .from('user_food_entitlements')
            .select('user_id, datum, obed, vecera')
            .in('user_id', userIdChunk)
            .gte('datum', validFrom)
            .lte('datum', validTo)
            .order('datum', { ascending: true })
          : Promise.resolve({ data: [], error: null })
      ])

      if (usersResult.error) return NextResponse.json({ error: usersResult.error.message }, { status: 500 })
      if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 500 })
      if (entitlementsResult.error) return NextResponse.json({ error: entitlementsResult.error.message }, { status: 500 })

      users.push(...(usersResult.data || []))
      periods.push(...(periodsResult.data || []))
      entitlements.push(...(entitlementsResult.data || []))
    }

    const periodsByUserId = new Map<string, any[]>()
    periods.forEach(period => {
      const list = periodsByUserId.get(period.user_id) || []
      list.push(period)
      periodsByUserId.set(period.user_id, list)
    })

    const entitlementsByUserId = new Map<string, any[]>()
    entitlements.forEach(row => {
      const list = entitlementsByUserId.get(row.user_id) || []
      list.push({
        datum: row.datum,
        obed: !!row.obed,
        vecera: !!row.vecera
      })
      entitlementsByUserId.set(row.user_id, list)
    })

    const people = users
      .map(user => {
        const userEntitlements = entitlementsByUserId.get(user.id) || []

        return {
          id: user.id,
          meno: user.meno || '',
          priezvisko: user.priezvisko || '',
          fullName: fullName(user),
          email: user.email || '',
          telefon: user.telefon || '',
          typStravy: user.typ_stravy || '',
          qrCode: user.qr_code || '',
          aktivny: user.aktivny || '',
          reviewStatus: user.review_status || 'APPROVED',
          periods: periodsByUserId.get(user.id) || [],
          entitlements: userEntitlements,
          lunchClaims: userEntitlements.filter(item => item.obed).length,
          dinnerClaims: userEntitlements.filter(item => item.vecera).length
        }
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))

    return NextResponse.json({
      ok: true,
      group,
      people
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
