import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { todayBratislavaIsoDate } from '@/lib/menuData'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

type MealType = 'OBED' | 'VECERA'
type FoodType = 'MASO' | 'VEGE' | 'DIETA'
type RequestedDay = {
  datum: string
  obed: boolean
  vecera: boolean
}

function normalizeFood(value: any): FoodType | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
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
  const zonedAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const offset = zonedAsUtc - localGuess.getTime()

  return new Date(localGuess.getTime() - offset).toISOString()
}

function defaultDeadlineIso(datum: string, typJedla: MealType) {
  const d = new Date(`${datum}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const previousDate = d.toISOString().slice(0, 10)
  return bratislavaLocalToUtcIso(previousDate, typJedla === 'OBED' ? 16 : 17)
}

function mealKey(datum: string, typ: MealType) {
  return `${datum}|${typ}`
}

function addDaysIso(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'self-ordering-submit', 80, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela pokusov. Skuste znova neskor.')

  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
  }

  const actorLimit = checkActorRateLimit(user.id, 'self-ordering-submit', 30, 10 * 60 * 1000)
  if (!actorLimit.ok) return rateLimitResponse(actorLimit, 'Prilis vela zmien. Skuste znova neskor.')

  const access = await getGlobalAccess(user.id)

  if (!access.isSelfOrderingMeal) {
    return NextResponse.json({ error: 'Nemáš povolené samostatné objednávanie stravy.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const defaultFood = normalizeFood(body.defaultFood)
  const days = Array.isArray(body.days) ? body.days : []

  if (!defaultFood) {
    return NextResponse.json({ error: 'Vyber predvolený typ stravy.' }, { status: 400 })
  }

  if (days.length === 0 || days.length > 80) {
    return NextResponse.json({ error: 'Vyber aspoň jeden deň.' }, { status: 400 })
  }

  const requestedDays: RequestedDay[] = days
    .map((item: any) => ({
      datum: String(item?.datum || '').trim(),
      obed: item?.obed === true,
      vecera: item?.vecera === true
    }))
    .filter((item: RequestedDay) => /^\d{4}-\d{2}-\d{2}$/.test(item.datum))

  const today = todayBratislavaIsoDate()
  const maxDate = addDaysIso(today, 20)
  const dateList = Array.from(new Set(requestedDays.map(item => item.datum)))
    .filter(datum => datum >= today && datum <= maxDate)

  if (dateList.length === 0) {
    return NextResponse.json({ error: 'Neplatné dni. Objednávať je možné najbližšie 3 týždne.' }, { status: 400 })
  }

  const allowedDateSet = new Set(dateList)
  const allowedRequestedDays = requestedDays.filter(day => allowedDateSet.has(day.datum))

  const nowIso = new Date().toISOString()
  const openedAt = user.self_ordering_opened_at ? new Date(user.self_ordering_opened_at) : new Date()
  const graceUntil = new Date(openedAt.getTime() + 24 * 60 * 60 * 1000)
  const ignoreDeadlines = Date.now() <= graceUntil.getTime()

  if (!user.self_ordering_opened_at) {
    await supabaseServer
      .from('users')
      .update({ self_ordering_opened_at: nowIso })
      .eq('id', user.id)
      .is('self_ordering_opened_at', null)
  }

  const [deadlineResult, entitlementResult] = await Promise.all([
    supabaseServer
      .from('menu_deadlines')
      .select('datum, typ_jedla, deadline_at, locked')
      .in('datum', dateList),
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', user.id)
      .in('datum', dateList)
  ])

  if (deadlineResult.error) return NextResponse.json({ error: deadlineResult.error.message }, { status: 500 })
  if (entitlementResult.error) return NextResponse.json({ error: entitlementResult.error.message }, { status: 500 })

  const deadlineByKey = new Map((deadlineResult.data || []).map((item: any) => [mealKey(item.datum, item.typ_jedla), item]))
  const entitlementByDate = new Map((entitlementResult.data || []).map((item: any) => [item.datum, item]))
  const skipped: string[] = []
  const finalByDate = new Map<string, { datum: string; obed: boolean; vecera: boolean }>()

  allowedRequestedDays.forEach(day => {
    const current: any = entitlementByDate.get(day.datum)
    finalByDate.set(day.datum, {
      datum: day.datum,
      obed: !!current?.obed,
      vecera: !!current?.vecera
    })
  })

  for (const day of allowedRequestedDays) {
    for (const typ of ['OBED', 'VECERA'] as MealType[]) {
      const requested = typ === 'OBED' ? day.obed : day.vecera
      const current = !!(entitlementByDate.get(day.datum) as any)?.[typ === 'OBED' ? 'obed' : 'vecera']
      if (requested === current) continue

      const key = mealKey(day.datum, typ)

      if (!ignoreDeadlines) {
        const deadline: any = deadlineByKey.get(key)
        const effectiveDeadline = deadline?.deadline_at || defaultDeadlineIso(day.datum, typ)

        if (deadline?.locked || Date.now() > new Date(effectiveDeadline).getTime()) {
          skipped.push(`${day.datum} ${typ}: po uzávierke`)
          continue
        }
      }

      const next = finalByDate.get(day.datum) || { datum: day.datum, obed: false, vecera: false }
      if (typ === 'OBED') next.obed = requested
      if (typ === 'VECERA') next.vecera = requested
      finalByDate.set(day.datum, next)
    }
  }

  const finalRows = Array.from(finalByDate.values())
  const entitlementRows = finalRows
    .filter(row => row.obed || row.vecera)
    .map(row => ({
      user_id: user.id,
      datum: row.datum,
      obed: row.obed,
      vecera: row.vecera,
      source: 'SELF_ORDERING',
      updated_by: user.id,
      updated_at: nowIso
    }))
  const { error: entitlementDeleteError } = await supabaseServer
    .from('user_food_entitlements')
    .delete()
    .eq('user_id', user.id)
    .in('datum', dateList)

  if (entitlementDeleteError) return NextResponse.json({ error: entitlementDeleteError.message }, { status: 500 })

  if (entitlementRows.length > 0) {
    const { error } = await supabaseServer
      .from('user_food_entitlements')
      .insert(entitlementRows)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const selectionRows = finalRows.flatMap(row => {
    const rows: any[] = []
    if (row.obed) rows.push({ user_id: user.id, group_id: null, datum: row.datum, typ_jedla: 'OBED', volba: defaultFood, zdroj: 'USER' })
    if (row.vecera) rows.push({ user_id: user.id, group_id: null, datum: row.datum, typ_jedla: 'VECERA', volba: defaultFood, zdroj: 'USER' })
    return rows
  })

  const selectionDeleteFilters = finalRows.flatMap(row => {
    const rows: Array<{ datum: string; typ: MealType }> = []
    if (!row.obed) rows.push({ datum: row.datum, typ: 'OBED' })
    if (!row.vecera) rows.push({ datum: row.datum, typ: 'VECERA' })
    return rows
  })

  for (const item of selectionDeleteFilters) {
    const { error } = await supabaseServer
      .from('vyber_jedal')
      .delete()
      .eq('user_id', user.id)
      .eq('datum', item.datum)
      .eq('typ_jedla', item.typ)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (selectionRows.length > 0) {
    const { error } = await supabaseServer
      .from('vyber_jedal')
      .upsert(selectionRows, { onConflict: 'user_id,datum,typ_jedla' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: userUpdateError } = await supabaseServer
    .from('users')
    .update({
      typ_stravy: defaultFood,
      self_ordering_required: false,
      self_ordering_completed_at: user.self_ordering_completed_at || nowIso,
      updated_at: nowIso
    })
    .eq('id', user.id)

  if (userUpdateError) return NextResponse.json({ error: userUpdateError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    skipped,
    ignoredDeadlines: ignoreDeadlines,
    graceUntil: graceUntil.toISOString(),
    savedDates: entitlementRows.length
  })
}
