import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
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

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
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
      return NextResponse.json({ error: currentPeriodError.message }, { status: 500 })
    }

    const { error: userUpdateError } = await supabaseServer
      .from('users')
      .update({
        registration_group_id: currentPeriod?.registration_group_id || null,
        registration_group_note: currentPeriod?.note || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (userUpdateError) {
      return NextResponse.json({ error: userUpdateError.message }, { status: 500 })
    }

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

    let adjustedPreviousPeriod: any = null
    const overlapEnd = validTo || '9999-12-31'
    const { data: overlappingPeriods, error: overlapError } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, registration_group_id, valid_from, valid_to, note')
      .eq('user_id', userId)
      .lte('valid_from', overlapEnd)
      .or(`valid_to.is.null,valid_to.gte.${validFrom}`)
      .order('valid_from', { ascending: true })

    if (overlapError) {
      return NextResponse.json({ error: overlapError.message }, { status: 500 })
    }

    const overlaps = overlappingPeriods || []

    if (overlaps.length === 1) {
      const previous = overlaps[0]
      const previousCanBeClosed = previous.valid_from < validFrom
        && (previous.valid_to === null || !validTo || previous.valid_to <= validTo)

      if (previousCanBeClosed) {
        const previousValidTo = addDaysIso(validFrom, -1)

        if (previousValidTo >= previous.valid_from) {
          const { error: closePreviousError } = await supabaseServer
            .from('user_registration_group_periods')
            .update({ valid_to: previousValidTo })
            .eq('id', previous.id)

          if (closePreviousError) {
            return NextResponse.json({ error: closePreviousError.message }, { status: 500 })
          }

          adjustedPreviousPeriod = {
            id: previous.id,
            valid_to: previousValidTo
          }
        }
      }
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
      const overlaps = insertError.code === '23P01'
        || insertError.message.toLowerCase().includes('no_overlap')

      return NextResponse.json(
        {
          error: overlaps
            ? 'Obdobie sa prekryva s existujucim zaradenim tejto osoby. Uprav datumy tak, aby v jeden den platila iba jedna registracna skupina.'
            : insertError.message
        },
        { status: overlaps ? 409 : 500 }
      )
    }

    const today = slovakiaDateIso()
    const isCurrent = validFrom <= today && (!validTo || validTo >= today)

    if (isCurrent) {
      const { error: userUpdateError } = await supabaseServer
        .from('users')
        .update({
          registration_group_id: registrationGroupId,
          registration_group_note: note,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)

      if (userUpdateError) {
        return NextResponse.json({ error: userUpdateError.message }, { status: 500 })
      }
    }

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
          current_legacy_group_updated: isCurrent,
          adjusted_previous_period: adjustedPreviousPeriod
        },
        note: 'Naroky na stravu neboli zmenene.'
      })

    return NextResponse.json({
      ok: true,
      period,
      message: 'Zaradenie bolo ulozene. Naroky na stravu ostali nezmenene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
