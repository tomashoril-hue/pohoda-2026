import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }

  return dates
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

type DayClaim = {
  datum: string
  obed: boolean
  vecera: boolean
}

async function fetchUsersByRegistrationGroup(registrationGroupId: string, activeOnly: boolean) {
  const rows: any[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    let query = supabaseServer
      .from('users')
      .select('id, email, meno, priezvisko, aktivny')
      .eq('registration_group_id', registrationGroupId)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (activeOnly) {
      query = query.eq('aktivny', 'ANO')
    }

    const { data, error } = await query

    if (error) throw error

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return rows
  }
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
        { error: 'Hromadne naroky moze upravovat iba ADMIN alebo PERSONALISTA.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const registrationGroupId = cleanText(body.registrationGroupId)
    const validFrom = cleanText(body.validFrom)
    const validTo = cleanText(body.validTo)
    const obed = body.obed === true
    const vecera = body.vecera === true
    const mode = cleanText(body.mode).toUpperCase() || 'SET'
    const activeOnly = body.activeOnly !== false
    const rawDayClaims: DayClaim[] = Array.isArray(body.dayClaims)
      ? body.dayClaims
        .map((item: any) => ({
          datum: cleanText(item?.datum),
          obed: !!item?.obed,
          vecera: !!item?.vecera
        }))
        .filter((item: DayClaim) => isIsoDate(item.datum) && (item.obed || item.vecera))
        .sort((a: DayClaim, b: DayClaim) => a.datum.localeCompare(b.datum))
      : []
    const dayClaims = Array.from(
      rawDayClaims.reduce((map, item) => {
        const existing = map.get(item.datum) || { datum: item.datum, obed: false, vecera: false }
        map.set(item.datum, {
          datum: item.datum,
          obed: existing.obed || item.obed,
          vecera: existing.vecera || item.vecera
        })
        return map
      }, new Map<string, DayClaim>()).values()
    ).sort((a, b) => a.datum.localeCompare(b.datum))

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (mode !== 'SET' && mode !== 'CLEAR' && mode !== 'CLEAR_ALL' && mode !== 'DATES') {
      return NextResponse.json({ error: 'Neplatny sposob upravy narokov.' }, { status: 400 })
    }

    const usesDateRange = mode !== 'CLEAR_ALL'

    if (usesDateRange && (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom)) {
      return NextResponse.json({ error: 'Zadaj platne obdobie.' }, { status: 400 })
    }

    if (mode === 'SET' && !obed && !vecera) {
      return NextResponse.json({ error: 'Vyber aspon jeden narok.' }, { status: 400 })
    }

    if (mode === 'DATES' && dayClaims.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jeden den v kalendari.' }, { status: 400 })
    }

    const dates = usesDateRange ? dateRange(validFrom, validTo) : []
    const selectedDateSet = new Set(dates)
    const safeDayClaims = mode === 'DATES'
      ? dayClaims.filter(item => selectedDateSet.has(item.datum))
      : []

    if (mode === 'DATES' && safeDayClaims.length === 0) {
      return NextResponse.json(
        { error: 'Vybrane dni nie su vo vybranom obdobi.' },
        { status: 400 }
      )
    }

    if (usesDateRange && dates.length > 370) {
      return NextResponse.json(
        { error: 'Jedna hromadna uprava narokov moze mat najviac 370 dni.' },
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

    const users = await fetchUsersByRegistrationGroup(registrationGroupId, activeOnly)

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'V tejto registracnej skupine nie su ziadni ludia pre hromadnu upravu.' },
        { status: 400 }
      )
    }

    const plannedRows = usesDateRange ? users.length * dates.length : 0

    if (plannedRows > 60000) {
      return NextResponse.json(
        { error: 'Hromadna uprava je prilis velka. Zmensi obdobie alebo skupinu.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const userIds = users.map(user => user.id)
    let replacedRows = 0
    let insertedRows = 0

    for (const userIdChunk of chunk(userIds, 250)) {
      let deleteQuery = supabaseServer
        .from('user_food_entitlements')
        .delete({ count: 'exact' })
        .in('user_id', userIdChunk)

      if (usesDateRange) {
        deleteQuery = deleteQuery
          .gte('datum', validFrom)
          .lte('datum', validTo)
      }

      const { count, error: deleteError } = await deleteQuery

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }

      replacedRows += count || 0
    }

    for (const userChunk of chunk(users, 100)) {
      if (mode === 'SET' || mode === 'DATES') {
        const entitlementRows = mode === 'DATES'
          ? userChunk.flatMap(user => safeDayClaims.map(item => ({
            user_id: user.id,
            datum: item.datum,
            obed: item.obed,
            vecera: item.vecera,
            source: 'PERSONALISTA',
            note: `Hromadna kalendarova uprava narokov podla registracnej skupiny: ${registrationGroup.name}.`,
            created_by: actor.id,
            updated_by: actor.id,
            updated_at: now
          })))
          : userChunk.flatMap(user => dates.map(datum => ({
          user_id: user.id,
          datum,
          obed,
          vecera,
          source: 'PERSONALISTA',
          note: `Hromadna uprava narokov podla registracnej skupiny: ${registrationGroup.name}.`,
          created_by: actor.id,
          updated_by: actor.id,
          updated_at: now
        })))

        const { error: insertError } = await supabaseServer
          .from('user_food_entitlements')
          .insert(entitlementRows)

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 })
        }

        insertedRows += entitlementRows.length
      }

      if (!usesDateRange) {
        continue
      }

      const periodRows = userChunk.map(user => ({
        user_id: user.id,
        valid_from: validFrom,
        valid_to: validTo,
        active: mode !== 'CLEAR',
        source: 'MANUAL',
        note: mode !== 'SET'
          ? mode === 'DATES'
            ? `Hromadna kalendarova uprava narokov podla registracnej skupiny: ${registrationGroup.name}.`
            : `Hromadne vymazanie narokov podla registracnej skupiny: ${registrationGroup.name}.`
          : `Hromadna uprava narokov podla registracnej skupiny: ${registrationGroup.name}.`,
        created_by: actor.id,
        updated_by: actor.id
      }))

      const { error: periodError } = await supabaseServer
        .from('personnel_work_periods')
        .insert(periodRows)

      if (periodError) {
        return NextResponse.json({ error: periodError.message }, { status: 500 })
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: null,
        action: mode === 'CLEAR_ALL'
          ? 'REGISTRATION_GROUP_ENTITLEMENTS_ALL_CLEARED'
          : mode === 'CLEAR'
            ? 'REGISTRATION_GROUP_ENTITLEMENTS_CLEARED'
            : mode === 'DATES'
              ? 'REGISTRATION_GROUP_ENTITLEMENTS_CALENDAR_UPDATED'
              : 'REGISTRATION_GROUP_ENTITLEMENTS_UPDATED',
        entity_table: 'registration_groups',
        entity_id: registrationGroupId,
        before_data: {
          replaced_rows: replacedRows
        },
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: registrationGroup.name,
          active_only: activeOnly,
          valid_from: usesDateRange ? validFrom : null,
          valid_to: usesDateRange ? validTo : null,
          mode,
          days: dates.length,
          users: users.length,
          inserted_rows: insertedRows,
          obed,
          vecera,
          day_claims: safeDayClaims
        },
        note: mode === 'CLEAR_ALL'
          ? `Hromadne vymazanie vsetkych narokov pre registracnu skupinu ${registrationGroup.name}.`
          : mode === 'CLEAR'
            ? `Hromadne vymazanie narokov pre registracnu skupinu ${registrationGroup.name}.`
            : mode === 'DATES'
              ? `Hromadna kalendarova uprava narokov pre registracnu skupinu ${registrationGroup.name}.`
              : `Hromadna uprava narokov pre registracnu skupinu ${registrationGroup.name}.`
      })

    return NextResponse.json({
      ok: true,
      users: users.length,
      days: dates.length,
      insertedRows,
      replacedRows,
      message: mode === 'CLEAR_ALL'
        ? `Vsetky existujuce naroky boli vymazane pre ${users.length} osob v registracnej skupine ${registrationGroup.name}.`
        : mode === 'CLEAR'
          ? `Naroky boli vymazane pre ${users.length} osob v registracnej skupine ${registrationGroup.name}.`
          : mode === 'DATES'
            ? `Naroky podla kalendara boli nastavene pre ${users.length} osob v registracnej skupine ${registrationGroup.name}.`
            : `Naroky boli nastavene pre ${users.length} osob v registracnej skupine ${registrationGroup.name}.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
