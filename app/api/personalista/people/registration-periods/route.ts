import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { setMissingBaseRegistrationGroup } from '@/lib/baseRegistrationGroup'
import { slovakiaDateIso } from '@/lib/date'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanDate(value: any) {
  const date = cleanText(value)

  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function isoDateAdd(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''

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

async function refreshCurrentRegistrationGroupSnapshot(userId: string) {
  const today = slovakiaDateIso()
  const { data: currentPeriod, error: currentPeriodError } = await supabaseServer
    .from('user_registration_group_periods')
    .select('id, registration_group_id, valid_from, valid_to, note')
    .eq('user_id', userId)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (currentPeriodError) {
    throw currentPeriodError
  }

  return currentPeriod
}

function overlapErrorResponse(error: any) {
  const overlaps = error?.code === '23P01'
    || String(error?.message || '').toLowerCase().includes('no_overlap')

  return NextResponse.json(
    {
      error: overlaps
        ? 'Obdobie sa prekryva s existujucim zaradenim tejto osoby. Uprav datumy tak, aby v jeden den platila iba jedna registracna skupina.'
        : error?.message || 'Zaradenie sa nepodarilo ulozit.'
    },
    { status: overlaps ? 409 : 500 }
  )
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const periodId = cleanText(body.periodId)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!periodId) {
      return NextResponse.json({ error: 'Chyba zaradenie.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const { data: period, error: periodError } = await supabaseServer
      .from('user_registration_group_periods')
      .select(`
        id,
        user_id,
        registration_group_id,
        valid_from,
        valid_to,
        note,
        registration_groups (
          id,
          name
        )
      `)
      .eq('id', periodId)
      .eq('user_id', userId)
      .maybeSingle()

    if (periodError) {
      return NextResponse.json({ error: periodError.message }, { status: 500 })
    }

    if (!period) {
      return NextResponse.json({ error: 'Zaradenie neexistuje.' }, { status: 404 })
    }

    const { error: deleteError } = await supabaseServer
      .from('user_registration_group_periods')
      .delete()
      .eq('id', periodId)
      .eq('user_id', userId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const currentPeriod = await refreshCurrentRegistrationGroupSnapshot(userId)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_REGISTRATION_GROUP_PERIOD_DELETED',
        entity_table: 'user_registration_group_periods',
        entity_id: period.id,
        before_data: period,
        after_data: {
          current_registration_group_id: currentPeriod?.registration_group_id || null,
          current_registration_group_note: currentPeriod?.note || null
        },
        note: 'Naroky na stravu neboli zmenene.'
      })

    return NextResponse.json({
      ok: true,
      message: 'Zaradenie bolo vymazane. Naroky na stravu ostali nezmenene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
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
    const validFrom = cleanDate(body.validFrom)
    const validTo = cleanDate(body.validTo) || null
    const note = cleanText(body.note) || null

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (!validFrom) {
      return NextResponse.json({ error: 'Vyber datum od.' }, { status: 400 })
    }

    if (validTo && validTo < validFrom) {
      return NextResponse.json({ error: 'Datum do nemoze byt pred datumom od.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
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

    const { data: existingPeriods, error: existingPeriodsError } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .eq('user_id', userId)

    if (existingPeriodsError) {
      return NextResponse.json({ error: existingPeriodsError.message }, { status: 500 })
    }

    const overlappingPeriods = (existingPeriods || [])
      .filter((row: any) => periodOverlaps(row, validFrom, validTo))
    const autoClosablePeriod = overlappingPeriods.length === 1
      && overlappingPeriods[0].valid_to === null
      && overlappingPeriods[0].valid_from < validFrom
      ? overlappingPeriods[0]
      : null

    if (overlappingPeriods.length > 0 && !autoClosablePeriod) {
      return NextResponse.json(
        { error: 'Obdobie sa prekryva s existujucim zaradenim. V jeden den moze platit iba jedna registracna skupina.' },
        { status: 409 }
      )
    }

    let closedPreviousPeriod: any = null

    if (autoClosablePeriod) {
      const previousValidTo = isoDateAdd(validFrom, -1)

      if (!previousValidTo || previousValidTo < autoClosablePeriod.valid_from) {
        return NextResponse.json(
          { error: 'Otvorene zaradenie sa nepodarilo automaticky ukoncit. Uprav datumy rucne.' },
          { status: 409 }
        )
      }

      const { data: updatedPreviousPeriod, error: closeError } = await supabaseServer
        .from('user_registration_group_periods')
        .update({
          valid_to: previousValidTo,
          note: autoClosablePeriod.note
        })
        .eq('id', autoClosablePeriod.id)
        .eq('user_id', userId)
        .is('valid_to', null)
        .select('id, user_id, registration_group_id, valid_from, valid_to, note')
        .single()

      if (closeError) {
        return overlapErrorResponse(closeError)
      }

      closedPreviousPeriod = updatedPreviousPeriod
    }

    const { data: period, error: insertError } = await supabaseServer
      .from('user_registration_group_periods')
      .insert({
        user_id: userId,
        registration_group_id: registrationGroupId,
        valid_from: validFrom,
        valid_to: validTo,
        note,
        created_by: actor.id
      })
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .single()

    if (insertError) {
      return overlapErrorResponse(insertError)
    }

    const baseRegistrationGroupUpdated = await setMissingBaseRegistrationGroup([userId], registrationGroupId)
    const currentPeriod = await refreshCurrentRegistrationGroupSnapshot(userId)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_REGISTRATION_GROUP_PERIOD_CREATED',
        entity_table: 'user_registration_group_periods',
        entity_id: period.id,
        after_data: {
          ...period,
          registration_group_name: registrationGroup.name,
          auto_closed_previous_period: closedPreviousPeriod,
          base_registration_group_updated: baseRegistrationGroupUpdated > 0,
          current_registration_group_id: currentPeriod?.registration_group_id || null
        },
        note: 'Naroky na stravu neboli zmenene.'
      })

    return NextResponse.json({
      ok: true,
      period,
      closedPreviousPeriod,
      message: closedPreviousPeriod
        ? 'Zaradenie bolo ulozene. Predchadzajuce otvorene zaradenie bolo automaticky ukoncene. Naroky na stravu ostali nezmenene.'
        : 'Zaradenie bolo ulozene. Naroky na stravu ostali nezmenene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const periodId = cleanText(body.periodId)
    const registrationGroupId = cleanText(body.registrationGroupId)
    const validFrom = cleanDate(body.validFrom)
    const validTo = cleanDate(body.validTo) || null
    const note = cleanText(body.note) || null
    const rawItems = Array.isArray(body.items) ? body.items : []

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!periodId && rawItems.length === 0) {
      return NextResponse.json({ error: 'Chyba zaradenie.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (rawItems.length === 0 && !validFrom) {
      return NextResponse.json({ error: 'Vyber datum od.' }, { status: 400 })
    }

    if (rawItems.length === 0 && validTo && validTo < validFrom) {
      return NextResponse.json({ error: 'Datum do nemoze byt pred datumom od.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const items = rawItems
      .map((item: any) => ({
        periodId: cleanText(item?.periodId),
        validFrom: cleanDate(item?.validFrom),
        validTo: cleanDate(item?.validTo) || null
      }))
      .filter((item: any) => item.validFrom)

    if (rawItems.length > 0) {
      if (items.length !== rawItems.length) {
        return NextResponse.json({ error: 'Niektore oznacene obdobia nemaju platny datum od.' }, { status: 400 })
      }

      if (items.some((item: any) => item.validTo && item.validTo < item.validFrom)) {
        return NextResponse.json({ error: 'Datum do nemoze byt pred datumom od.' }, { status: 400 })
      }

      if (items.length > 30) {
        return NextResponse.json({ error: 'Naraz je mozne upravit najviac 30 obdobi.' }, { status: 400 })
      }
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

    if (items.length > 0) {
      const existingPeriodIds = items.map((item: any) => item.periodId).filter(Boolean)
      const beforeById = new Map<string, any>()

      if (existingPeriodIds.length > 0) {
        const { data: beforeRows, error: beforeError } = await supabaseServer
          .from('user_registration_group_periods')
          .select('id, user_id, registration_group_id, valid_from, valid_to, note')
          .eq('user_id', userId)
          .in('id', existingPeriodIds)

        if (beforeError) {
          return NextResponse.json({ error: beforeError.message }, { status: 500 })
        }

        ;(beforeRows || []).forEach((row: any) => {
          beforeById.set(row.id, row)
        })

        if (beforeById.size !== existingPeriodIds.length) {
          return NextResponse.json({ error: 'Niektore oznacene zaradenia uz neexistuju.' }, { status: 404 })
        }
      }

      const changedPeriods = []

      for (const item of items) {
        if (item.periodId) {
          const { data: period, error: updateError } = await supabaseServer
            .from('user_registration_group_periods')
            .update({
              registration_group_id: registrationGroupId,
              valid_from: item.validFrom,
              valid_to: item.validTo,
              note
            })
            .eq('id', item.periodId)
            .eq('user_id', userId)
            .select('id, user_id, registration_group_id, valid_from, valid_to, note')
            .single()

          if (updateError) {
            return overlapErrorResponse(updateError)
          }

          changedPeriods.push(period)
        } else {
          const { data: period, error: insertError } = await supabaseServer
            .from('user_registration_group_periods')
            .insert({
              user_id: userId,
              registration_group_id: registrationGroupId,
              valid_from: item.validFrom,
              valid_to: item.validTo,
              note,
              created_by: actor.id
            })
            .select('id, user_id, registration_group_id, valid_from, valid_to, note')
            .single()

          if (insertError) {
            return overlapErrorResponse(insertError)
          }

          changedPeriods.push(period)
        }
      }

      const baseRegistrationGroupUpdated = await setMissingBaseRegistrationGroup([userId], registrationGroupId)
      const refreshedPeriod = await refreshCurrentRegistrationGroupSnapshot(userId)

      await supabaseServer
        .from('personnel_audit_log')
        .insert({
          actor_user_id: actor.id,
          target_user_id: userId,
          action: 'PERSON_REGISTRATION_GROUP_PERIODS_BULK_UPDATED',
          entity_table: 'user_registration_group_periods',
          entity_id: null,
          before_data: {
            periods: Array.from(beforeById.values())
          },
          after_data: {
            periods: changedPeriods,
            registration_group_name: registrationGroup.name,
            base_registration_group_updated: baseRegistrationGroupUpdated > 0,
            current_registration_group_id: refreshedPeriod?.registration_group_id || null
          },
          note: 'Hromadna uprava oznacenych zaradeni. Naroky na stravu neboli zmenene.'
        })

      return NextResponse.json({
        ok: true,
        periods: changedPeriods,
        message: `Oznacene zaradenia boli ulozene (${changedPeriods.length}). Naroky na stravu ostali nezmenene.`
      })
    }

    const { data: currentPeriod, error: currentPeriodError } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .eq('id', periodId)
      .eq('user_id', userId)
      .maybeSingle()

    if (currentPeriodError) {
      return NextResponse.json({ error: currentPeriodError.message }, { status: 500 })
    }

    if (!currentPeriod) {
      return NextResponse.json({ error: 'Zaradenie neexistuje.' }, { status: 404 })
    }

    const { data: period, error: updateError } = await supabaseServer
      .from('user_registration_group_periods')
      .update({
        registration_group_id: registrationGroupId,
        valid_from: validFrom,
        valid_to: validTo,
        note
      })
      .eq('id', periodId)
      .eq('user_id', userId)
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .single()

    if (updateError) {
      return overlapErrorResponse(updateError)
    }

    const baseRegistrationGroupUpdated = await setMissingBaseRegistrationGroup([userId], registrationGroupId)
    const refreshedPeriod = await refreshCurrentRegistrationGroupSnapshot(userId)

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_REGISTRATION_GROUP_PERIOD_UPDATED',
        entity_table: 'user_registration_group_periods',
        entity_id: period.id,
        before_data: currentPeriod,
        after_data: {
          ...period,
          registration_group_name: registrationGroup.name,
          base_registration_group_updated: baseRegistrationGroupUpdated > 0,
          current_registration_group_id: refreshedPeriod?.registration_group_id || null
        },
        note: 'Naroky na stravu neboli zmenene.'
      })

    return NextResponse.json({
      ok: true,
      period,
      message: 'Zaradenie bolo upravene. Naroky na stravu ostali nezmenene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
