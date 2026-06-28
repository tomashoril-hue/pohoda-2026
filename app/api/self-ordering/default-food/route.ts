import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { todayBratislavaIsoDate } from '@/lib/menuData'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

type MealType = 'OBED' | 'VECERA'
type FoodType = 'MASO' | 'VEGE' | 'DIETA'

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
  const ipLimit = checkRateLimit(req, 'self-ordering-default-food', 50, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela zmien. Skuste znova neskor.')

  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
  }

  const actorLimit = checkActorRateLimit(user.id, 'self-ordering-default-food', 12, 10 * 60 * 1000)
  if (!actorLimit.ok) return rateLimitResponse(actorLimit, 'Prilis vela zmien. Skuste znova neskor.')

  const access = await getGlobalAccess(user.id)

  if (!access.isSelfOrderingMeal) {
    return NextResponse.json({ error: 'Nemas povolene samostatne objednavanie stravy.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const defaultFood = normalizeFood(body.defaultFood)

  if (!defaultFood) {
    return NextResponse.json({ error: 'Vyber predvoleny typ stravy.' }, { status: 400 })
  }

  const today = todayBratislavaIsoDate()
  const defaultMaxDate = addDaysIso(today, 20)
  const { data: latestEntitlement, error: latestEntitlementError } = await supabaseServer
    .from('user_food_entitlements')
    .select('datum')
    .eq('user_id', user.id)
    .gte('datum', today)
    .order('datum', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestEntitlementError) return NextResponse.json({ error: latestEntitlementError.message }, { status: 500 })

  const latestEntitlementDate = latestEntitlement?.datum || ''
  const maxDate = latestEntitlementDate > defaultMaxDate ? latestEntitlementDate : defaultMaxDate
  const nowIso = new Date().toISOString()
  const [entitlementResult, selectionResult] = await Promise.all([
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', user.id)
      .gte('datum', today)
      .lte('datum', maxDate),
    supabaseServer
      .from('vyber_jedal')
      .select('datum, typ_jedla')
      .eq('user_id', user.id)
      .gte('datum', today)
      .lte('datum', maxDate)
  ])

  if (entitlementResult.error) return NextResponse.json({ error: entitlementResult.error.message }, { status: 500 })
  if (selectionResult.error) return NextResponse.json({ error: selectionResult.error.message }, { status: 500 })

  const targetMealMap = new Map<string, { datum: string; typ: MealType }>()
  const addTargetMeal = (datum: string, typ: MealType) => {
    targetMealMap.set(mealKey(datum, typ), { datum, typ })
  }

  ;(entitlementResult.data || []).forEach((item: any) => {
    if (item.obed) addTargetMeal(item.datum, 'OBED')
    if (item.vecera) addTargetMeal(item.datum, 'VECERA')
  })

  ;(selectionResult.data || []).forEach((item: any) => {
    const typ = item.typ_jedla === 'OBED' || item.typ_jedla === 'VECERA' ? item.typ_jedla : null
    if (typ) addTargetMeal(item.datum, typ)
  })

  const targetMeals = Array.from(targetMealMap.values())

  const dateList = Array.from(new Set(targetMeals.map(item => item.datum)))
  const deadlineResult = dateList.length > 0
    ? await supabaseServer
      .from('menu_deadlines')
      .select('datum, typ_jedla, deadline_at, locked')
      .in('datum', dateList)
    : { data: [], error: null }

  if (deadlineResult.error) return NextResponse.json({ error: deadlineResult.error.message }, { status: 500 })

  const deadlineByKey = new Map((deadlineResult.data || []).map((item: any) => [mealKey(item.datum, item.typ_jedla), item]))
  const skipped: string[] = []
  const unlockedMeals = targetMeals.filter(item => {
    const deadline: any = deadlineByKey.get(mealKey(item.datum, item.typ))
    const effectiveDeadline = deadline?.deadline_at || defaultDeadlineIso(item.datum, item.typ)

    if (deadline?.locked || Date.now() > new Date(effectiveDeadline).getTime()) {
      skipped.push(`${item.datum} ${item.typ}: po uzavierke`)
      return false
    }

    return true
  })

  if (unlockedMeals.length > 0) {
    const selectionRows = unlockedMeals.map(item => ({
      user_id: user.id,
      group_id: null,
      datum: item.datum,
      typ_jedla: item.typ,
      volba: defaultFood,
      zdroj: 'USER'
    }))
    const { error } = await supabaseServer
      .from('vyber_jedal')
      .upsert(selectionRows, { onConflict: 'user_id,datum,typ_jedla' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: userUpdateError } = await supabaseServer
    .from('users')
    .update({
      typ_stravy: defaultFood,
      updated_at: nowIso
    })
    .eq('id', user.id)

  if (userUpdateError) return NextResponse.json({ error: userUpdateError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    defaultFood,
    changedCount: unlockedMeals.length,
    skipped
  })
}
