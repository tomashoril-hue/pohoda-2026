import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { loadMenuSelectionData } from '@/lib/menuData'
import { createMenuKioskToken } from '@/lib/menuKioskToken'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanQrText(value: any) {
  let text = String(value || '').trim()

  if (!text) return ''

  text = text
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()

  try {
    const url = new URL(text)
    const queryValue =
      url.searchParams.get('qr') ||
      url.searchParams.get('qrCode') ||
      url.searchParams.get('code') ||
      url.searchParams.get('token')

    if (queryValue) {
      text = queryValue
    } else {
      const lastPathPart = url.pathname.split('/').filter(Boolean).pop()
      if (lastPathPart) text = lastPathPart
    }
  } catch {
    // Plain QR values are expected. URL parsing is a compatibility path.
  }

  return text.replace(/\s+/g, '').trim()
}

function fullName(profile: any) {
  return `${profile?.meno || ''} ${profile?.priezvisko || ''}`.trim()
}

async function requireMenuKioskAccess() {
  const actor = await getCurrentUser()

  if (!actor) {
    return { ok: false as const, status: 401, error: 'Nie si prihlásený.' }
  }

  const access = await getGlobalAccess(actor.id)

  if (!access.canUseMenuKiosk) {
    return { ok: false as const, status: 403, error: 'Nemáš oprávnenie na kiosk výberu stravy.' }
  }

  return { ok: true as const, actor, access }
}

async function findPersonByQr(qrCode: string) {
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
    return { ok: false as const, status: 404, error: 'QR kód sa nenašiel alebo už nie je aktívny.', profile: null as any }
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, typ_stravy, aktivny')
    .eq('id', qrRow.user_id)
    .maybeSingle()

  if (profileError) {
    return { ok: false as const, status: 500, error: profileError.message, profile: null as any }
  }

  if (!profile) {
    return { ok: false as const, status: 404, error: 'Osoba k QR kódu sa nenašla.', profile: null as any }
  }

  if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
    return { ok: false as const, status: 403, error: 'Osoba je zablokovana.', profile: null as any }
  }

  return { ok: true as const, profile }
}

export async function POST(req: NextRequest) {
  try {
    const ipLimit = checkRateLimit(req, 'menu-kiosk-scan', 180, 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela skenov. Chvilu pockajte.')

    const access = await requireMenuKioskAccess()

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const actorLimit = checkActorRateLimit(access.actor.id, 'menu-kiosk-scan', 300, 60 * 1000)
    if (!actorLimit.ok) return rateLimitResponse(actorLimit, 'Prilis vela skenov. Chvilu pockajte.')

    const body = await req.json()
    const qrCode = cleanQrText(body.qrCode)

    if (!qrCode) {
      return NextResponse.json({ error: 'Načítaj QR kód alebo náramok.' }, { status: 400 })
    }

    const lookup = await findPersonByQr(qrCode)

    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status })
    }

    const profile = lookup.profile
    const menuData = await loadMenuSelectionData(profile.id)

    return NextResponse.json({
      ok: true,
      token: createMenuKioskToken(profile.id),
      userId: profile.id,
      personName: fullName(profile) || profile.email || 'Bez mena',
      defaultFood: profile.typ_stravy || null,
      ...menuData
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
