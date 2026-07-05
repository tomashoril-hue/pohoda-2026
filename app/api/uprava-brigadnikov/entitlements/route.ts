import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { setMissingBaseRegistrationGroup } from '@/lib/baseRegistrationGroup'
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

  return currentByUserId
}

async function assertAccess(actorId: string, registrationGroupId: string) {
  const access = await getGlobalAccess(actorId)

  if (access.isAdmin || access.isPersonalista) {
    return { ok: true }
  }

  if (!access.isRegistrationGroupAdmin) {
    return { error: 'Tuto cast moze pouzivat iba ADMIN, PERSONALISTA alebo rola ADMIN_REG_SKUPINY.', status: 403 }
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
    const requestedValidFrom = cleanText(body.validFrom)
    const requestedValidTo = cleanText(body.validTo)
    const mode = cleanText(body.mode).toUpperCase() || 'SET'
    const obed = body.obed === true
    const vecera = body.vecera === true
    const selectedDates: string[] = Array.isArray(body.selectedDates)
      ? Array.from(new Set<string>(
        body.selectedDates
          .map((item: any) => cleanText(item))
          .filter((item: string) => Boolean(item))
      )).sort()
      : []
    const replaceDates: string[] = Array.isArray(body.replaceDates)
      ? Array.from(new Set<string>(
        body.replaceDates
          .map((item: any) => cleanText(item))
          .filter((item: string) => Boolean(item))
      )).sort()
      : []
    const userIds: string[] = Array.isArray(body.userIds)
      ? Array.from(new Set<string>(
        body.userIds
          .map((item: any) => cleanText(item))
          .filter((item: string) => Boolean(item))
      ))
      : []

    if (!registrationGroupId) return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    if (mode !== 'SET' && mode !== 'CLEAR') {
      return NextResponse.json({ error: 'Neplatny sposob upravy.' }, { status: 400 })
    }
    if (!obed && !vecera) {
      return NextResponse.json({ error: 'Vyber obed alebo veceru.' }, { status: 400 })
    }
    if (userIds.length === 0) return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    if (userIds.length > 1000) return NextResponse.json({ error: 'Naraz je mozne upravit najviac 1000 osob.' }, { status: 400 })

    if (selectedDates.some(date => !isIsoDate(date))) {
      return NextResponse.json({ error: 'Kalendar obsahuje neplatny datum.' }, { status: 400 })
    }
    if (replaceDates.some(date => !isIsoDate(date))) {
      return NextResponse.json({ error: 'Kalendar obsahuje neplatny datum.' }, { status: 400 })
    }

    const dates = replaceDates.length > 0
      ? selectedDates
      : selectedDates.length > 0
        ? selectedDates
        : isIsoDate(requestedValidFrom) && isIsoDate(requestedValidTo) && requestedValidTo >= requestedValidFrom
          ? dateRange(requestedValidFrom, requestedValidTo)
          : []
    const scopeDates = replaceDates.length > 0 ? replaceDates : dates
    const validFrom = scopeDates[0] || ''
    const validTo = scopeDates[scopeDates.length - 1] || ''

    if ((dates.length === 0 && replaceDates.length === 0) || !validFrom || !validTo) {
      return NextResponse.json({ error: 'Zadaj platne datumy od/do.' }, { status: 400 })
    }
    if (scopeDates.length > 370) return NextResponse.json({ error: 'Obdobie moze mat najviac 370 dni.' }, { status: 400 })

    const access = await assertAccess(actor.id, registrationGroupId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

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
        if (dates.length === 0) return false

        return (periodsByUserId.get(user.id) || []).some(period => {
          return period.registration_group_id !== registrationGroupId && periodOverlaps(period, dates[0], dates[dates.length - 1])
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
      const query = supabaseServer
        .from('user_food_entitlements')
        .select('user_id, datum, obed, vecera, source')
        .in('user_id', userIdChunk)

      const { data } = replaceDates.length > 0
        ? await query.in('datum', scopeDates)
        : selectedDates.length > 0
          ? await query.in('datum', dates)
        : await query.gte('datum', validFrom).lte('datum', validTo)

      beforeRows.push(...(data || []))
    }

    let deletedEntitlements = 0
    let updatedEntitlements = 0
    let insertedEntitlements = 0
    const now = new Date().toISOString()

    if (mode === 'SET' && replaceDates.length > 0) {
      const selectedDateSet = new Set(dates)
      const beforeByUserDate = new Map<string, any>()
      beforeRows.forEach(row => {
        beforeByUserDate.set(`${row.user_id}|${row.datum}`, row)
      })

      for (const userIdChunk of chunk(userIds, 250)) {
        const { count, error } = await supabaseServer
          .from('user_food_entitlements')
          .delete({ count: 'exact' })
          .in('user_id', userIdChunk)
          .in('datum', scopeDates)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        deletedEntitlements += count || 0
      }

      for (const userChunk of chunk(users, 80)) {
        const rows = userChunk.flatMap(user => scopeDates.flatMap(datum => {
          const before = beforeByUserDate.get(`${user.id}|${datum}`)
          const selected = selectedDateSet.has(datum)
          const nextObed = obed ? selected : Boolean(before?.obed)
          const nextVecera = vecera ? selected : Boolean(before?.vecera)

          if (!nextObed && !nextVecera) return []

          return [{
            user_id: user.id,
            datum,
            obed: nextObed,
            vecera: nextVecera,
            source: before?.source || 'PERSONALISTA',
            note: `Uprava brigadnikov pre registracnu skupinu ${group.name}.`,
            created_by: actor.id,
            updated_by: actor.id,
            updated_at: now
          }]
        }))

        if (rows.length === 0) continue

        const { error } = await supabaseServer
          .from('user_food_entitlements')
          .insert(rows)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        insertedEntitlements += rows.length
      }
    } else if (mode === 'SET') {
      for (const userIdChunk of chunk(userIds, 250)) {
        const query = supabaseServer
          .from('user_food_entitlements')
          .delete({ count: 'exact' })
          .in('user_id', userIdChunk)

        const { count, error } = replaceDates.length > 0
          ? await query.in('datum', scopeDates)
          : selectedDates.length > 0
            ? await query.in('datum', dates)
          : await query.gte('datum', validFrom).lte('datum', validTo)

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        deletedEntitlements += count || 0
      }

      for (const userChunk of dates.length > 0 ? chunk(users, 80) : []) {
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
    } else {
      const clearPatch = {
        ...(obed ? { obed: false } : {}),
        ...(vecera ? { vecera: false } : {}),
        updated_by: actor.id,
        updated_at: now
      }

      for (const userIdChunk of chunk(userIds, 250)) {
        const updateQuery = supabaseServer
          .from('user_food_entitlements')
          .update(clearPatch, { count: 'exact' })
          .in('user_id', userIdChunk)

        const updateResult = replaceDates.length > 0
          ? await updateQuery.in('datum', scopeDates)
          : selectedDates.length > 0
            ? await updateQuery.in('datum', dates)
          : await updateQuery.gte('datum', validFrom).lte('datum', validTo)

        if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 })
        updatedEntitlements += updateResult.count || 0

        const deleteQuery = supabaseServer
          .from('user_food_entitlements')
          .delete({ count: 'exact' })
          .in('user_id', userIdChunk)
          .eq('obed', false)
          .eq('vecera', false)

        const deleteResult = replaceDates.length > 0
          ? await deleteQuery.in('datum', scopeDates)
          : selectedDates.length > 0
            ? await deleteQuery.in('datum', dates)
          : await deleteQuery.gte('datum', validFrom).lte('datum', validTo)

        if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 500 })
        deletedEntitlements += deleteResult.count || 0
      }
    }

    for (const user of users) {
      const userPeriods = periodsByUserId.get(user.id) || []
      const shouldAdjustPeriods = (mode === 'SET' && dates.length > 0) || (selectedDates.length === 0 && obed && vecera)
      const periodValidFrom = mode === 'SET' && dates.length > 0 ? dates[0] : validFrom
      const periodValidTo = mode === 'SET' && dates.length > 0 ? dates[dates.length - 1] : validTo
      const sameGroupPeriods = userPeriods.filter(period => {
        return period.registration_group_id === registrationGroupId && periodOverlaps(period, periodValidFrom, periodValidTo)
      })

      if (!shouldAdjustPeriods) continue

      if (mode === 'SET') {
        const mergedFrom = minIso([periodValidFrom, ...sameGroupPeriods.map(period => period.valid_from)])
        const hasOpenEnd = sameGroupPeriods.some(period => !period.valid_to)
        const mergedTo = hasOpenEnd
          ? null
          : maxIso([periodValidTo, ...sameGroupPeriods.map(period => period.valid_to).filter(Boolean)])

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

    const baseRegistrationGroupUpdated = mode === 'SET'
      ? await setMissingBaseRegistrationGroup(userIds, registrationGroupId)
      : 0
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
          selected_dates: selectedDates,
          replace_dates: replaceDates,
          mode,
          obed,
          vecera,
          days: dates.length,
          deleted_entitlements: deletedEntitlements,
          updated_entitlements: updatedEntitlements,
          inserted_entitlements: insertedEntitlements,
          base_registration_group_updated: baseRegistrationGroupUpdated
        }
      })

    return NextResponse.json({
      ok: true,
      users: users.length,
      days: dates.length,
      deletedEntitlements,
      insertedEntitlements,
      updatedEntitlements,
      message: mode === 'CLEAR'
        ? `Naroky boli vymazane pre ${users.length} osob.`
        : `Naroky boli ulozene pre ${users.length} osob.`
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
