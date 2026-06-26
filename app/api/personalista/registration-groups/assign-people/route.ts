import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanDate(value: any) {
  const date = cleanText(value)

  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
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

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function periodOverlaps(row: any, validFrom: string, validTo: string | null) {
  const end = validTo || '9999-12-31'
  const rowEnd = row.valid_to || '9999-12-31'

  return validFrom <= rowEnd && row.valid_from <= end
}

function fullName(user: any) {
  return [user?.priezvisko, user?.meno].filter(Boolean).join(' ').trim()
    || user?.email
    || user?.id
    || 'Bez mena'
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

  return currentByUserId
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
    const action = cleanText(body.action).toUpperCase() || 'ASSIGN'
    const registrationGroupId = cleanText(body.registrationGroupId)
    const registrationGroupNote = cleanText(body.registrationGroupNote) || null
    const validFrom = cleanDate(body.validFrom)
    const validTo = cleanDate(body.validTo) || null
    const userIds = cleanUserIds(body.userIds)

    if (action !== 'ASSIGN' && action !== 'CLEAR_PERIODS') {
      return NextResponse.json({ error: 'Neplatna akcia.' }, { status: 400 })
    }

    if (action === 'ASSIGN' && !registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (action === 'ASSIGN' && !validFrom) {
      return NextResponse.json({ error: 'Vyber datum od.' }, { status: 400 })
    }

    if (action === 'ASSIGN' && validTo && validTo < validFrom) {
      return NextResponse.json({ error: 'Datum do nemoze byt pred datumom od.' }, { status: 400 })
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

    let registrationGroup: any = null

    if (action === 'ASSIGN') {
      const { data, error: registrationGroupError } = await supabaseServer
        .from('registration_groups')
        .select('id, name, active')
        .eq('id', registrationGroupId)
        .maybeSingle()

      if (registrationGroupError) {
        return NextResponse.json({ error: registrationGroupError.message }, { status: 500 })
      }

      if (!data || data.active === false) {
        return NextResponse.json(
          { error: 'Registracna skupina neexistuje alebo nie je aktivna.' },
          { status: 404 }
        )
      }

      registrationGroup = data
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

    const beforeData = users.map(user => ({
      id: user.id,
      email: user.email,
      meno: user.meno,
      priezvisko: user.priezvisko,
      registration_group_id: user.registration_group_id,
      registration_group_note: user.registration_group_note
    }))

    if (action === 'CLEAR_PERIODS') {
      const beforePeriods: any[] = []

      for (const userIdChunk of chunk(userIds, 250)) {
        const { data, error } = await supabaseServer
          .from('user_registration_group_periods')
          .select('id, user_id, registration_group_id, valid_from, valid_to, note')
          .in('user_id', userIdChunk)
          .order('valid_from', { ascending: true })

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        beforePeriods.push(...(data || []))
      }

      for (const userIdChunk of chunk(userIds, 250)) {
        const { error } = await supabaseServer
          .from('user_registration_group_periods')
          .delete()
          .in('user_id', userIdChunk)

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
      }

      await refreshCurrentRegistrationGroups(userIds)

      await supabaseServer
        .from('personnel_audit_log')
        .insert({
          actor_user_id: actor.id,
          target_user_id: null,
          action: 'REGISTRATION_GROUP_PERIODS_BULK_CLEARED',
          entity_table: 'user_registration_group_periods',
          entity_id: null,
          before_data: {
            users: beforeData,
            periods: beforePeriods
          },
          after_data: {
            user_ids: userIds,
            users: users.length,
            deleted_periods: beforePeriods.length,
            food_entitlements_changed: false
          },
          note: `Hromadne vymazanie vsetkych registracnych zaradeni pre ${users.length} osob. Naroky na stravu neboli zmenene.`
        })

      return NextResponse.json({
        ok: true,
        updated: users.length,
        deletedPeriods: beforePeriods.length,
        message: `Vymazane registracne zaradenia pre ${users.length} osob (${beforePeriods.length} obdobi). Naroky na stravu ostali nezmenene.`
      })
    }

    const periodsByUserId = new Map<string, any[]>()

    for (const userIdChunk of chunk(userIds, 250)) {
      const { data, error } = await supabaseServer
        .from('user_registration_group_periods')
        .select('id, user_id, registration_group_id, valid_from, valid_to, note')
        .in('user_id', userIdChunk)
        .order('valid_from', { ascending: true })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      ;(data || []).forEach((period: any) => {
        const list = periodsByUserId.get(period.user_id) || []
        list.push(period)
        periodsByUserId.set(period.user_id, list)
      })
    }

    const closePlans: { userId: string; period: any; previousValidTo: string }[] = []
    const conflicts: string[] = []

    for (const user of users) {
      const existingPeriods = periodsByUserId.get(user.id) || []
      const overlappingPeriods = existingPeriods.filter(period => periodOverlaps(period, validFrom, validTo))
      const autoClosablePeriod = overlappingPeriods.length === 1
        && overlappingPeriods[0].valid_to === null
        && overlappingPeriods[0].valid_from < validFrom
        ? overlappingPeriods[0]
        : null

      if (overlappingPeriods.length > 0 && !autoClosablePeriod) {
        conflicts.push(fullName(user))
        continue
      }

      if (autoClosablePeriod) {
        const previousValidTo = addDaysIso(validFrom, -1)

        if (!previousValidTo || previousValidTo < autoClosablePeriod.valid_from) {
          conflicts.push(fullName(user))
          continue
        }

        closePlans.push({ userId: user.id, period: autoClosablePeriod, previousValidTo })
      }
    }

    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, 12).join(', ')
      const suffix = conflicts.length > 12 ? ` a dalsich ${conflicts.length - 12}` : ''

      return NextResponse.json(
        {
          error: `Niektore osoby maju konflikt v zaradeni: ${shown}${suffix}. Uprav datumy alebo pouzi nasledujuci den po predchadzajucom zaradeni.`
        },
        { status: 409 }
      )
    }

    for (const plan of closePlans) {
      const { error: closeError } = await supabaseServer
        .from('user_registration_group_periods')
        .update({ valid_to: plan.previousValidTo })
        .eq('id', plan.period.id)
        .eq('user_id', plan.userId)
        .is('valid_to', null)

      if (closeError) {
        return NextResponse.json({ error: closeError.message }, { status: 500 })
      }
    }

    for (const user of users) {
      const { error: insertPeriodError } = await supabaseServer
        .from('user_registration_group_periods')
        .insert({
          user_id: user.id,
          registration_group_id: registrationGroupId,
          valid_from: validFrom,
          valid_to: validTo,
          note: registrationGroupNote,
          created_by: actor.id
        })

      if (insertPeriodError) {
        const overlaps = insertPeriodError.code === '23P01'
          || insertPeriodError.message.toLowerCase().includes('no_overlap')

        return NextResponse.json(
          {
            error: overlaps
              ? 'Niektora osoba ma naplanovane zaradenie, ktore sa prekryva s novym priradenim. Uprav ju v detaile osoby.'
              : insertPeriodError.message
          },
          { status: overlaps ? 409 : 500 }
        )
      }
    }

    await refreshCurrentRegistrationGroups(userIds)

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
          valid_from: validFrom,
          valid_to: validTo,
          user_ids: userIds,
          users: users.length,
          auto_closed_periods: closePlans.map(plan => ({
            id: plan.period.id,
            user_id: plan.userId,
            previous_valid_to: plan.previousValidTo
          })),
          food_entitlements_changed: false
        },
        note: `Manualne priradenie ${users.length} osob do registracnej skupiny ${registrationGroup.name}. Naroky na stravu neboli zmenene.`
      })

    return NextResponse.json({
      ok: true,
      updated: users.length,
      autoClosed: closePlans.length,
      message: closePlans.length > 0
        ? `Do registracnej skupiny ${registrationGroup.name} bolo priradenych ${users.length} osob. Predchadzajuce otvorene zaradenia boli ukoncene (${closePlans.length}). Naroky na stravu ostali nezmenene.`
        : `Do registracnej skupiny ${registrationGroup.name} bolo priradenych ${users.length} osob. Naroky na stravu ostali nezmenene.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
