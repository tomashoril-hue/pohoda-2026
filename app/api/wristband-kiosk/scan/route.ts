import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function fullName(profile: any) {
  return `${profile?.meno || ''} ${profile?.priezvisko || ''}`.trim()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function validateWristbandQrRule(qrCode: string) {
  const { data: settings, error: settingsError } = await supabaseServer
    .from('personnel_qr_wristband_settings')
    .select('enabled')
    .eq('id', 'DEFAULT')
    .maybeSingle()

  if (settingsError) {
    return { ok: false, error: settingsError.message }
  }

  if (settings?.enabled === false) {
    return { ok: true, error: '' }
  }

  if (!/^[0-9]{14}$/.test(qrCode)) {
    return {
      ok: false,
      error: 'QR kód náramku musí mať 14 číslic.'
    }
  }

  const typeCode = qrCode.slice(0, 2)
  const series = Number(qrCode.slice(2, 5))

  const { data: range, error: rangeError } = await supabaseServer
    .from('personnel_qr_wristband_ranges')
    .select('series_from, series_to, active')
    .eq('type_code', typeCode)
    .eq('active', true)
    .maybeSingle()

  if (rangeError) {
    return { ok: false, error: rangeError.message }
  }

  if (!range || series < range.series_from || series > range.series_to) {
    return {
      ok: false,
      error: `QR kód náramku nie je povolený pre typ ${typeCode} a sériu ${String(series).padStart(3, '0')}.`
    }
  }

  return { ok: true, error: '' }
}

async function requireKioskAccess() {
  const actor = await getCurrentUser()

  if (!actor) {
    return {
      ok: false as const,
      status: 401,
      error: 'Nie si prihlásený.',
      actor: null as any
    }
  }

  const access = await getGlobalAccess(actor.id)

  if (!access.canUseWristbandKiosk) {
    return {
      ok: false as const,
      status: 403,
      error: 'Nemáš oprávnenie na preskenovanie náramku.',
      actor
    }
  }

  return {
    ok: true as const,
    actor,
    access
  }
}

async function findPersonByActiveQr(qrCode: string, requireDatabaseQr = false) {
  const { data: qrRow, error: qrError } = await supabaseServer
    .from('user_qr_codes')
    .select('user_id')
    .eq('qr_code', qrCode)
    .eq('active', true)
    .maybeSingle()

  if (qrError) {
    return { ok: false as const, status: 500, error: qrError.message, profile: null as any }
  }

  if (!qrRow?.user_id) {
    return {
      ok: false as const,
      status: 404,
      error: 'Aktuálny QR kód sa nenašiel alebo už nie je aktívny.',
      profile: null as any
    }
  }

  if (requireDatabaseQr) {
    const { data: poolQr, error: poolQrError } = await supabaseServer
      .from('qr_codes')
      .select('id')
      .eq('code', qrCode)
      .maybeSingle()

    if (poolQrError) {
      return { ok: false as const, status: 500, error: poolQrError.message, profile: null as any }
    }

    if (!poolQr) {
      return {
        ok: false as const,
        status: 400,
        error: 'Ako prvý načítaj databázový QR kód osoby. Aktívny náramok nie je možné použiť.',
        profile: null as any
      }
    }
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, qr_code, aktivny')
    .eq('id', qrRow.user_id)
    .maybeSingle()

  if (profileError) {
    return { ok: false as const, status: 500, error: profileError.message, profile: null as any }
  }

  if (!profile) {
    return {
      ok: false as const,
      status: 404,
      error: 'Osoba k QR kódu sa nenašla.',
      profile: null as any
    }
  }

  if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
    return {
      ok: false as const,
      status: 403,
      error: 'Osoba je zablokovaná.',
      profile: null as any
    }
  }

  return { ok: true as const, profile }
}

async function findPersonByPreviousQrOwner(qrCode: string, userId: string) {
  if (!qrCode || !isUuid(userId)) {
    return {
      ok: false as const,
      status: 404,
      error: 'AktuĂˇlny QR kĂłd sa nenaĹˇiel alebo uĹľ nie je aktĂ­vny.',
      profile: null as any
    }
  }

  const { data: qrRow, error: qrError } = await supabaseServer
    .from('user_qr_codes')
    .select('user_id')
    .eq('qr_code', qrCode)
    .eq('user_id', userId)
    .maybeSingle()

  if (qrError) {
    return { ok: false as const, status: 500, error: qrError.message, profile: null as any }
  }

  if (!qrRow?.user_id) {
    return {
      ok: false as const,
      status: 404,
      error: 'AktuĂˇlny QR kĂłd sa nenaĹˇiel alebo uĹľ nie je aktĂ­vny.',
      profile: null as any
    }
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, qr_code, aktivny')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) {
    return { ok: false as const, status: 500, error: profileError.message, profile: null as any }
  }

  if (!profile) {
    return {
      ok: false as const,
      status: 404,
      error: 'Osoba k QR kĂłdu sa nenaĹˇla.',
      profile: null as any
    }
  }

  if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
    return {
      ok: false as const,
      status: 403,
      error: 'Osoba je zablokovanĂˇ.',
      profile: null as any
    }
  }

  return { ok: true as const, profile }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireKioskAccess()

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const body = await req.json()
    const mode = cleanText(body.mode).toUpperCase()
    const currentQr = cleanText(body.currentQr)
    const wristbandQr = cleanText(body.wristbandQr)
    const userId = cleanText(body.userId)

    if (mode !== 'LOOKUP' && mode !== 'REPLACE') {
      return NextResponse.json({ error: 'Neplatný režim preskenovania.' }, { status: 400 })
    }

    if (!currentQr) {
      return NextResponse.json({ error: 'Najprv načítaj aktuálny QR kód osoby.' }, { status: 400 })
    }

    let personLookup = await findPersonByActiveQr(currentQr, mode === 'LOOKUP')

    if (mode === 'REPLACE' && !personLookup.ok && userId) {
      personLookup = await findPersonByPreviousQrOwner(currentQr, userId)
    }

    if (!personLookup.ok) {
      return NextResponse.json({ error: personLookup.error }, { status: personLookup.status })
    }

    const profile = personLookup.profile
    const personName = fullName(profile) || profile.email || 'Bez mena'

    if (mode === 'LOOKUP') {
      return NextResponse.json({
        ok: true,
        userId: profile.id,
        personName,
        currentQr
      })
    }

    if (!wristbandQr) {
      return NextResponse.json({ error: 'Načítaj nový QR kód náramku.' }, { status: 400 })
    }

    if (wristbandQr === currentQr) {
      return NextResponse.json({ error: 'Nový náramok je rovnaký ako aktuálny QR.' }, { status: 400 })
    }

    const ruleValidation = await validateWristbandQrRule(wristbandQr)

    if (!ruleValidation.ok) {
      return NextResponse.json({ error: ruleValidation.error }, { status: 400 })
    }

    const { data: assignedRows, error: assignError } = await supabaseServer
      .rpc('replace_user_qr_any_code', {
        p_user_id: profile.id,
        p_qr_code: wristbandQr,
        p_assigned_by: access.actor.id,
        p_note: 'QR bol vymenený cez kiosk preskenovania náramku.'
      })

    if (assignError) {
      const alreadyAssigned = String(assignError.message || '').includes('QR_ALREADY_ASSIGNED')

      return NextResponse.json(
        {
          error: alreadyAssigned
            ? 'Tento QR kód náramku už bol použitý pri inej osobe.'
            : assignError.message || 'QR kód sa nepodarilo priradiť.'
        },
        { status: alreadyAssigned ? 409 : 500 }
      )
    }

    const assignedQr = Array.isArray(assignedRows) ? assignedRows[0] : assignedRows

    if (!assignedQr) {
      return NextResponse.json(
        { error: 'Tento QR kód náramku už bol použitý pri inej osobe.' },
        { status: 409 }
      )
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: access.actor.id,
        target_user_id: profile.id,
        action: 'WRISTBAND_KIOSK_QR_REPLACED',
        entity_table: 'user_qr_codes',
        entity_id: null,
        after_data: {
          qr_code_id: assignedQr.qr_code_id || null,
          mode: 'WRISTBAND_KIOSK'
        }
      })

    return NextResponse.json({
      ok: true,
      personName,
      message: `Náramok bol úspešne priradený osobe ${personName}.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
