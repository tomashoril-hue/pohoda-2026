import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { verifyMenuKioskToken } from '@/lib/menuKioskToken'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeChoice(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIETA'

  return null
}

function bratislavaLocalToUtcIso(datum: string, hour: number) {
  const localGuess = new Date(`${datum}T${String(hour).padStart(2, '0')}:00:00.000Z`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(localGuess)
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value || 0)
  const zonedAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  const offset = zonedAsUtc - localGuess.getTime()

  return new Date(localGuess.getTime() - offset).toISOString()
}

function defaultDeadlineIso(datum: string, typJedla: string) {
  const d = new Date(`${datum}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const previousDate = d.toISOString().slice(0, 10)
  return bratislavaLocalToUtcIso(previousDate, typJedla === 'OBED' ? 16 : 17)
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

  return { ok: true as const, actor }
}

export async function POST(req: NextRequest) {
  try {
    const ipLimit = checkRateLimit(req, 'menu-kiosk-select', 120, 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela zmien. Chvilu pockajte.')

    const access = await requireMenuKioskAccess()

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const actorLimit = checkActorRateLimit(access.actor.id, 'menu-kiosk-select', 240, 60 * 1000)
    if (!actorLimit.ok) return rateLimitResponse(actorLimit, 'Prilis vela zmien. Chvilu pockajte.')

    const body = await req.json()
    const token = String(body.token || '').trim()
    const tokenResult = verifyMenuKioskToken(token)

    if (!tokenResult.ok) {
      return NextResponse.json({ error: tokenResult.error }, { status: 401 })
    }

    const datum = String(body.datum || '').trim()
    const typJedla = String(body.typ_jedla || '').trim().toUpperCase()
    const volba = normalizeChoice(body.volba)

    if (!datum || !typJedla || !volba) {
      return NextResponse.json({ error: 'Chýbajú údaje.' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !['OBED', 'VECERA'].includes(typJedla)) {
      return NextResponse.json({ error: 'Neplatný dátum alebo typ jedla.' }, { status: 400 })
    }

    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, typ_stravy, aktivny')
      .eq('id', tokenResult.userId)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json({ error: 'Osoba nie je aktívna.' }, { status: 403 })
    }

    if (volba === 'DIETA' && normalizeChoice(user.typ_stravy) !== 'DIETA') {
      return NextResponse.json(
        { error: 'Diétu môže vybrať iba osoba s nastavenou diétou.' },
        { status: 403 }
      )
    }

    if (volba !== 'BEZ_ZAUJMU') {
      const { data: menuItem, error: menuError } = await supabaseServer
        .from('jedalny_listok')
        .select('id')
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .eq('varianta', volba)
        .eq('aktivne', true)
        .maybeSingle()

      if (menuError) {
        return NextResponse.json({ error: menuError.message }, { status: 500 })
      }

      if (!menuItem) {
        return NextResponse.json({ error: 'Táto možnosť nie je v jedálnom lístku.' }, { status: 400 })
      }
    }

    const { data: deadline } = await supabaseServer
      .from('menu_deadlines')
      .select('deadline_at, locked')
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .maybeSingle()

    if (deadline?.locked) {
      return NextResponse.json({ error: 'Výber je už uzamknutý.' }, { status: 403 })
    }

    const effectiveDeadline = deadline?.deadline_at || defaultDeadlineIso(datum, typJedla)

    if (Date.now() > new Date(effectiveDeadline).getTime()) {
      return NextResponse.json({ error: 'Čas na zmenu výberu už vypršal.' }, { status: 403 })
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    const { error } = await supabaseServer.from('vyber_jedal').upsert(
      {
        user_id: user.id,
        group_id: membership?.group_id || null,
        datum,
        typ_jedla: typJedla,
        volba,
        zdroj: 'USER',
      },
      {
        onConflict: 'user_id,datum,typ_jedla',
      }
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: access.actor.id,
        target_user_id: user.id,
        action: 'MENU_KIOSK_SELECTION_UPDATED',
        entity_table: 'vyber_jedal',
        entity_id: null,
        after_data: { datum, typ_jedla: typJedla, volba }
      })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
