import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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

export async function POST(req: Request) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
  }

  const access = await getGlobalAccess(user.id)
  const isOnlyMenuKiosk =
    access.isMenuKiosk &&
    access.roles.length > 0 &&
    access.roles.every(role => role === 'MENU_KIOSK')

  if (isOnlyMenuKiosk) {
    return NextResponse.json({ error: 'Tento účet môže používať iba kiosk výberu stravy.' }, { status: 403 })
  }

  const body = await req.json()
  const datum = String(body.datum || '').trim()
  const typ_jedla = String(body.typ_jedla || '').trim().toUpperCase()
  const volba = normalizeChoice(body.volba)

  if (!datum || !typ_jedla || !volba) {
    return NextResponse.json({ error: 'Chýbajú údaje.' }, { status: 400 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !['OBED', 'VECERA'].includes(typ_jedla)) {
    return NextResponse.json({ error: 'Neplatný dátum alebo typ jedla.' }, { status: 400 })
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
      .eq('typ_jedla', typ_jedla)
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
    .eq('typ_jedla', typ_jedla)
    .maybeSingle()

  if (deadline?.locked) {
    return NextResponse.json({ error: 'Výber je už uzamknutý.' }, { status: 403 })
  }

  const effectiveDeadline = deadline?.deadline_at || defaultDeadlineIso(datum, typ_jedla)

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
      typ_jedla,
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

  return NextResponse.json({ ok: true })
}
