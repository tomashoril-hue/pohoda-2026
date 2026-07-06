import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanEmail(value: any) {
  const email = cleanText(value).toLowerCase()
  return email || null
}

function cleanFood(value: any) {
  const food = cleanText(value).toUpperCase()

  if (food === 'MASO') return 'MASO'
  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA') return 'DIETA'

  return ''
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
    return { error: 'Nemozes pridavat ludi do tejto registracnej skupiny.', status: 403 }
  }

  return { ok: true }
}

async function rollbackPendingUser(userId: string) {
  await supabaseServer.from('user_food_entitlements').delete().eq('user_id', userId)
  await supabaseServer.from('personnel_work_periods').delete().eq('user_id', userId)
  await supabaseServer.from('user_registration_group_periods').delete().eq('user_id', userId)
  await supabaseServer.from('users').delete().eq('id', userId)
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = cleanText(body.registrationGroupId)
    const meno = cleanText(body.meno)
    const priezvisko = cleanText(body.priezvisko)
    const email = cleanEmail(body.email)
    const telefon = cleanText(body.telefon) || null
    const typStravy = cleanFood(body.typStravy) || 'MASO'
    const requestedValidFrom = cleanText(body.validFrom)
    const requestedValidTo = cleanText(body.validTo)
    const obed = body.obed === true
    const vecera = body.vecera === true
    const selectedDates: string[] = Array.isArray(body.selectedDates)
      ? Array.from(new Set<string>(
        body.selectedDates
          .map((item: any) => cleanText(item))
          .filter((item: string) => Boolean(item))
      )).sort()
      : []

    if (!registrationGroupId) return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    if (!meno || !priezvisko) return NextResponse.json({ error: 'Meno a priezvisko su povinne.' }, { status: 400 })
    if (!obed && !vecera) return NextResponse.json({ error: 'Vyber obed alebo veceru.' }, { status: 400 })
    if (selectedDates.some(date => !isIsoDate(date))) return NextResponse.json({ error: 'Kalendar obsahuje neplatny datum.' }, { status: 400 })

    const dates = selectedDates.length > 0
      ? selectedDates
      : isIsoDate(requestedValidFrom) && isIsoDate(requestedValidTo) && requestedValidTo >= requestedValidFrom
        ? dateRange(requestedValidFrom, requestedValidTo)
        : []
    const validFrom = dates[0] || ''
    const validTo = dates[dates.length - 1] || ''

    if (dates.length === 0 || !validFrom || !validTo) {
      return NextResponse.json({ error: 'Zadaj platne datumy od/do.' }, { status: 400 })
    }

    if (dates.length > 120) {
      return NextResponse.json({ error: 'Pri pridani brigadnika moze mat obdobie najviac 120 dni.' }, { status: 400 })
    }

    const access = await assertAccess(actor.id, registrationGroupId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data: registrationGroup, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 })
    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    if (email) {
      const { data: existingEmail, error: existingEmailError } = await supabaseServer
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (existingEmailError) return NextResponse.json({ error: existingEmailError.message }, { status: 500 })
      if (existingEmail) return NextResponse.json({ error: 'Pouzivatel s tymto emailom uz existuje.' }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { data: newUser, error: userError } = await supabaseServer
      .from('users')
      .insert({
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy: typStravy,
        qr_code: null,
        zdroj: 'MANAGER_REG_SKUPINY',
        aktivny: 'ANO',
        review_status: 'PENDING_REVIEW',
        registration_group_id: registrationGroupId,
        manual_created_by: actor.id,
        updated_at: now
      })
      .select('id, meno, priezvisko, email')
      .single()

    if (userError || !newUser) {
      return NextResponse.json({ error: userError?.message || 'Osobu sa nepodarilo pripravit.' }, { status: 500 })
    }

    const userId = newUser.id

    const { error: periodError } = await supabaseServer
      .from('user_registration_group_periods')
      .insert({
        user_id: userId,
        registration_group_id: registrationGroupId,
        valid_from: validFrom,
        valid_to: validTo,
        note: 'Pripravil manager registracnej skupiny v uprave brigadnikov.',
        created_by: actor.id
      })

    if (periodError) {
      await rollbackPendingUser(userId)
      return NextResponse.json({ error: periodError.message }, { status: 500 })
    }

    const { error: workPeriodError } = await supabaseServer
      .from('personnel_work_periods')
      .insert({
        user_id: userId,
        valid_from: validFrom,
        valid_to: validTo,
        source: 'MANUAL',
        created_by: actor.id,
        updated_by: actor.id
      })

    if (workPeriodError) {
      await rollbackPendingUser(userId)
      return NextResponse.json({ error: workPeriodError.message }, { status: 500 })
    }

    const { error: entitlementError } = await supabaseServer
      .from('user_food_entitlements')
      .insert(dates.map(datum => ({
        user_id: userId,
        datum,
        obed,
        vecera,
        source: 'PERSONALISTA',
        note: `Pripravil manager registracnej skupiny ${registrationGroup.name}.`,
        created_by: actor.id,
        updated_by: actor.id,
        updated_at: now
      })))

    if (entitlementError) {
      await rollbackPendingUser(userId)
      return NextResponse.json({ error: entitlementError.message }, { status: 500 })
    }

    const { data: qrRows, error: approveError } = await supabaseServer
      .rpc('approve_registration_user', {
        p_user_id: userId,
        p_actor_id: actor.id,
        p_registration_group_id: registrationGroupId,
        p_registration_group_note: 'Pridane cez upravu brigadnikov.'
      })

    if (approveError) {
      await rollbackPendingUser(userId)

      const message = approveError.message.includes('NO_FREE_QR_AVAILABLE')
        ? 'Nie je dostupny ziaden volny QR kod.'
        : approveError.message

      return NextResponse.json({ error: message }, { status: 409 })
    }

    const assigned = Array.isArray(qrRows) ? qrRows[0] : qrRows
    const qrCode = assigned?.qr_code || ''

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'BRIGADNIK_CREATED_APPROVED',
        entity_table: 'users',
        entity_id: userId,
        after_data: {
          registration_group_id: registrationGroupId,
          registration_group_name: registrationGroup.name,
          valid_from: validFrom,
          valid_to: validTo,
          selected_dates: selectedDates,
          days: dates.length,
          obed,
          vecera,
          typ_stravy: typStravy,
          qr_assigned: !!qrCode
        }
      })

    return NextResponse.json({
      ok: true,
      user: {
        ...newUser,
        qr_code: qrCode,
        review_status: 'APPROVED'
      },
      message: `Brigadnik bol pridany a QR kod bol prideleny.`
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
