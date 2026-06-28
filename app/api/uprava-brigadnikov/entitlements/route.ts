import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`)
  }

  return dates
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function periodOverlaps(period: any, validFrom: string, validTo: string) {
  const periodTo = period.valid_to || '9999-12-31'

  return validFrom <= periodTo && period.valid_from <= validTo
}

function minIso(values: string[]) {
  return values.sort()[0]
}

function maxIso(values: string[]) {
  return values.sort().slice(-1)[0]
}

function fullName(user: any) {
  return `${user?.priezvisko || ''} ${user?.meno || ''}`.trim() || user?.email || user?.id || 'Bez mena'
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function refreshCurrentRegistrationGroups(userIds: string[]) {
  const today = slovakiaDateIso()
  const activeRows: any[] = []

  for (const userIdChunk of chunk(userIds, 250)) {
    const { data, error } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .in('user_id', userIdChunk)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('valid_from', { ascending: false })

    if (error) throw error

    activeRows.push(...(data || []))
  }

  const currentByUserId = new Map<string, any>()

  activeRows.forEach(row => {
    if (!currentByUserId.has(row.user_id)) currentByUserId.set(row.user_id, row)
  })

  for (const userIdChunk of chunk(userIds, 250)) {
    const { error } = await supabaseServer
      .from('users')
      .update({
        registration_group_id: null,
        registration_group_note: null,
        updated_at: new Date().toISOString()
      })
      .in('id', userIdChunk)

    if (error) throw error
  }

  for (const [userId, period] of currentByUserId.entries()) {
    const { error } = await supabaseServer
      .from('users')
      .update({
        registration_group_id: period.registration_group_id,
        registration_group_note: period.note || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (error) throw error
  }
}

async function assertAccess(actorId: string, registrationGroupId: string) {
  const access = await getGlobalAccess(actorId)

  if (!access.isRegistrationGroupAdmin) {
    return { error: 'Tuto cast moze pouzivat iba rola ADMIN_REG_SKUPINY.', status: 403 }
  }

  const managedGroupIds = await getManagedRegistrationGroupIds(actorId)

  if (!managedGroupIds.includes(registrationGroupId)) {
    return { error: 'Nemozes upravovat tuto registracnu skupinu.', status: 403 }
  }

  return { ok: true }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = cleanText(body.registrationGroupId)
    const validFrom = cleanText(body.validFrom)
    const validTo = cleanText(body.validTo)
    const mode = cleanText(body.mode).toUpperCase() || 'SET'
    const obed = body.obed === true
    const vecera = body.vecera === true
    const userIds: string[] = Array.isArray(body.userIds)
      ? Array.from(new Set<string>(
        body.userIds
          .map((item: any) => cleanText(item))
          .filter((item: string) => Boolean(item))
      ))
      : []

    if (!registrationGroupId) return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) {
      return NextResponse.json({ error: 'Zadaj platne datumy od/do.' }, { status: 400 })
    }
    if (mode !== 'SET' && mode !== 'CLEAR') {
      return NextResponse.json({ error: 'Neplatny sposob upravy.' }, { status: 400 })
    }
    if (mode === 'SET' && !obed && !vecera) {
      return NextResponse.json({ error: 'Vyber obed alebo veceru.' }, { status: 400 })
    }
    if (userIds.length === 0) return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    if (userIds.length > 1000) return NextResponse.json({ error: 'Naraz je mozne upravit najviac 1000 osob.' }, { status: 400 })

    const access = await assertAccess(actor.id, registrationGroupId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const dates = dateRange(validFrom, validTo)
    if (dates.length > 370) return NextResponse.json({ error: 'Obdobie moze mat najviac 370 dni.' }, { status: 400 })

    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 })
    if (!group || group.active === false) return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })

    const users: any[] = []
    const periods: any[] = []

    for (const userIdChunk of chunk(userIds, 250)) {
      const [usersResult, periodsResult] = await Promise.all([
        supabaseServer
          .from('users')
          .select('id, meno, priezvisko, email, registration_group_id')
          .in('id', userIdChunk),
        supabaseServer
          .from('user_registration_group_periods')
          .select('id, user_id, registration_group_id, valid_from, valid_to')
          .in('user_id', userIdChunk)
          .order('valid_from', { ascending: true })
      ])

      if (usersResult.error) return NextResponse.json({ error: usersResult.error.message }, { status: 500 })
      if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 500 })

      users.push(...(usersResult.data || []))
      periods.push(...(periodsResult.data || []))
    }

    if (users.length !== userIds.length) {
      return NextResponse.json({ error: 'Niektore osoby sa nenasli. Obnov stranku.' }, { status: 400 })
    }

    const periodsByUserId = new Map<string, any[]>()
    periods.forEach(period => {
      const list = periodsByUserId.get(period.user_id) || []
      list.push(period)
      periodsByUserId.set(period.user_id, list)
    })

    const allowedUserIds = new Set<string>()
    periods.forEach(period => {
      if (period.registration_group_id === registrationGroupId) allowedUserIds.add(period.user_id)
    })
    users.forEach(user => {
      if (user.registration_group_id === registrationGroupId) allowedUserIds.add(user.id)
    })

    const outsideUsers = users.filter(user => !allowedUserIds.has(user.id))
    if (outsideUsers.length > 0) {
      return NextResponse.json(
        { error: `Niektore osoby nie patria do tvojej registracnej skupiny: ${outsideUsers.slice(0, 8).map(fullName).join(', ')}.` },
        { status: 403 }
      )
    }

    if (mode === 'SET') {
      const conflicts = users.filter(user => {
        return (periodsByUserId.get(user.id) || []).some(period => {
          return period.registration_group_id !== registrationGroupId && periodOverlaps(period, validFrom, validTo)
        })
      })

      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: `Konflikt s inou registracnou skupinou: ${conflicts.slice(0, 10).map(fullName).join(', ')}.` },
          { status: 409 }
        )
      }
    }

    const beforeRows: any[] = []
    for (const userIdChunk of chunk(userIds, 250)) {
      const { data } = await supabaseServer
        .from('user_food_entitlements')
        .select('user_id, datum, obed, vecera, source')
        .in('user_id', userIdChunk)
        .gte('datum', validFrom)
        .lte('datum', validTo)

      beforeRows.push(...(data || []))
    }

    let deletedEntitlements = 0
    for (const userIdChunk of chunk(userIds, 250)) {
      const { count, error } = await supabaseServer
        .from('user_food_entitlements')
        .delete({ count: 'exact' })
        .in('user_id', userIdChunk)
        .gte('datum', validFrom)
        .lte('datum', validTo)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      deletedEntitlements += count || 0
    }

    let insertedEntitlements = 0
    const now = new Date().toISOString()

    if (mode === 'SET') {
      for (const userChunk of chunk(users, 80)) {
        const rows = userChunk.flatMap(user => dates.map(datum => ({
          user_id: user.id,
          datum,
          obed,
          vecera,
          source: 'PERSONALISTA',
          note: `Uprava brigadnikov pre registracnu skupinu ${group.name}.`,
          created_by: actor.id,
          updated_by: actor.id,
          updated_at: now
        })))

        const { error } = await supabaseServer
          .from('user_food_entitlements')
          .insert(rows)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        insertedEntitlements += rows.length
      }
    }

    for (const user of users) {
      const userPeriods = periodsByUserId.get(user.id) || []
      const sameGroupPeriods = userPeriods.filter(period => {
        return period.registration_group_id === registrationGroupId && periodOverlaps(period, validFrom, validTo)
      })

      if (mode === 'SET') {
        const mergedFrom = minIso([validFrom, ...sameGroupPeriods.map(period => period.valid_from)])
        const hasOpenEnd = sameGroupPeriods.some(period => !period.valid_to)
        const mergedTo = hasOpenEnd
          ? null
          : maxIso([validTo, ...sameGroupPeriods.map(period => period.valid_to).filter(Boolean)])

        if (sameGroupPeriods.length > 0) {
          const { error } = await supabaseServer
            .from('user_registration_group_periods')
            .delete()
            .in('id', sameGroupPeriods.map(period => period.id))

          if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const { error } = await supabaseServer
          .from('user_registration_group_periods')
          .insert({
            user_id: user.id,
            registration_group_id: registrationGroupId,
            valid_from: mergedFrom,
            valid_to: mergedTo,
            note: 'Zaradene podla narokov na stravu v uprave brigadnikov.',
            created_by: actor.id
          })

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      } else {
        for (const period of sameGroupPeriods) {
          const periodTo = period.valid_to || '9999-12-31'
          const beforeFrom = period.valid_from
          const beforeTo = addDaysIso(validFrom, -1)
          const afterFrom = addDaysIso(validTo, 1)
          const afterTo = period.valid_to
          const startsBefore = period.valid_from < validFrom
          const endsAfter = periodTo > validTo

          if (!startsBefore && !endsAfter) {
            const { error } = await supabaseServer
              .from('user_registration_group_periods')
              .delete()
              .eq('id', period.id)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
          } else if (startsBefore && endsAfter) {
            const { error: updateError } = await supabaseServer
              .from('user_registration_group_periods')
              .update({ valid_to: beforeTo })
              .eq('id', period.id)
            if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

            const { error: insertError } = await supabaseServer
              .from('user_registration_group_periods')
              .insert({
                user_id: user.id,
                registration_group_id: registrationGroupId,
                valid_from: afterFrom,
                valid_to: afterTo,
                note: period.note || 'Zaradenie upravene po vymazani narokov.',
                created_by: actor.id
              })
            if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
          } else if (startsBefore) {
            const { error } = await supabaseServer
              .from('user_registration_group_periods')
              .update({ valid_to: beforeTo })
              .eq('id', period.id)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
          } else if (endsAfter) {
            const { error } = await supabaseServer
              .from('user_registration_group_periods')
              .update({ valid_from: afterFrom })
              .eq('id', period.id)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
          } else if (beforeFrom) {
            // No-op fallback for exhaustive branching.
          }
        }
      }
    }

    await refreshCurrentRegistrationGroups(userIds)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: null,
        action: mode === 'CLEAR' ? 'BRIGADNIK_ENTITLEMENTS_CLEARED' : 'BRIGADNIK_ENTITLEMENTS_UPDATED',
        entity_table: 'registration_groups',
        entity_id: registrationGroupId,
        before_data: {
          rows: beforeRows
        },
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: group.name,
          user_ids: userIds,
          users: users.length,
          valid_from: validFrom,
          valid_to: validTo,
          mode,
          obed,
          vecera,
          days: dates.length,
          deleted_entitlements: deletedEntitlements,
          inserted_entitlements: insertedEntitlements
        }
      })

    return NextResponse.json({
      ok: true,
      users: users.length,
      days: dates.length,
      deletedEntitlements,
      insertedEntitlements,
      message: mode === 'CLEAR'
        ? `Naroky boli vymazane pre ${users.length} osob.`
        : `Naroky boli ulozene pre ${users.length} osob.`
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
