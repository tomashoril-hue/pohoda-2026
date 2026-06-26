import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

type MealCode = 'OBED' | 'VECERA'
type FoodChoice = 'MASO' | 'VEGE' | 'DIETA'
type SelectionChoice = FoodChoice | 'BEZ_ZAUJMU'

type RegistrationGroup = {
  id: string
  name: string
  sheetColumnName: string
}

type ExportItem = {
  date: string
  meal: string
  groupName: string
  count: number
}

type ExportRow = {
  date: string
  day: string
  meal: string
}

const UNASSIGNED_GROUP_ID = '__UNASSIGNED__'
const UNASSIGNED_GROUP_NAME = 'Nezaradený'

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    }
  )
}

function jsonOk(body: any) {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store, max-age=0'
    }
  })
}

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanIsoDate(value: any) {
  const text = cleanText(value)
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)

  return match?.[1] || ''
}

function parseYear(value: any) {
  const year = Number.parseInt(cleanText(value), 10)

  if (!Number.isInteger(year) || year < 2020 || year > 2100) return 0

  return year
}

function bearerToken(req: NextRequest) {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)

  return match?.[1]?.trim() || ''
}

function normalizeChoice(value: any): SelectionChoice {
  const text = cleanText(value).toUpperCase()
  if (text === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA' || text === 'DIĂ‰TA') return 'DIETA'
  return 'MASO'
}

function normalizeMealCode(value: any): MealCode | '' {
  const text = cleanText(value).toUpperCase()

  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA') return 'VECERA'

  return ''
}

function selectionKey(userId: any, date: any, meal: any) {
  const normalizedUserId = cleanText(userId)
  const normalizedDate = cleanIsoDate(date)
  const normalizedMeal = normalizeMealCode(meal)

  if (!normalizedUserId || !normalizedDate || !normalizedMeal) return ''

  return `${normalizedUserId}|${normalizedDate}|${normalizedMeal}`
}

function mealLabel(meal: MealCode, choice: FoodChoice) {
  const base = meal === 'OBED' ? 'Obed' : 'Večera'

  if (choice === 'VEGE') return `${base} vege`
  if (choice === 'DIETA') return `${base} diéta`

  return `${base} mäso`
}

function mealLabelSortValue(meal: string) {
  const text = cleanText(meal).toLowerCase()

  if (text === 'obed mäso' || text === 'obed maso' || text === 'obed') return 1
  if (text === 'obed vege' || text === 'obed v') return 2
  if (text === 'obed diéta' || text === 'obed dieta') return 3
  if (text === 'večera mäso' || text === 'vecera maso' || text === 'večera' || text === 'vecera') return 4
  if (text === 'večera vege' || text === 'vecera vege' || text === 'večera v' || text === 'vecera v') return 5
  if (text === 'večera diéta' || text === 'vecera dieta') return 6

  return 99
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00.000Z`)
  const label = new Intl.DateTimeFormat('sk-SK', {
    weekday: 'long',
    timeZone: 'UTC'
  }).format(parsed)

  return label.charAt(0).toUpperCase() + label.slice(1)
}

function activeUser(row: any) {
  return String(row?.aktivny || '').toUpperCase() === 'ANO'
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }

  return result
}

async function fetchAll(buildQuery: (from: number, to: number) => any) {
  const pageSize = 1000
  const rows: any[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const page = data || []
    rows.push(...page)

    if (page.length < pageSize) return rows
  }
}

function registrationGroupForDate(user: any, periods: any[], date: string) {
  const normalizedDate = cleanIsoDate(date)
  const normalizedPeriods = periods
    .map(item => ({
      ...item,
      valid_from: cleanIsoDate(item.valid_from),
      valid_to: cleanIsoDate(item.valid_to)
    }))
    .filter(item => item.valid_from)

  const period = normalizedPeriods
    .filter(item => {
      return item.valid_from <= normalizedDate && (!item.valid_to || item.valid_to >= normalizedDate)
    })
    .sort((a, b) => {
      const fromCompare = b.valid_from.localeCompare(a.valid_from)
      if (fromCompare !== 0) return fromCompare

      return cleanText(b.id).localeCompare(cleanText(a.id))
    })[0]

  // Older users can still have only users.registration_group_id. If they have
  // period history, a missing matching period means "Nezaradený" for that date.
  if (period?.registration_group_id) return period.registration_group_id
  if (normalizedPeriods.length === 0) return user?.registration_group_id || UNASSIGNED_GROUP_ID

  return UNASSIGNED_GROUP_ID
}

export async function GET(req: NextRequest) {
  try {
    const ipLimit = checkRateLimit(req, 'gastro-export', 120, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela exportov. Skuste znova neskor.')

    const expectedToken = cleanText(process.env.GASTRO_EXPORT_TOKEN)

    if (!expectedToken) {
      return jsonError('GASTRO_EXPORT_TOKEN nie je nastavene na serveri.', 500)
    }

    if (bearerToken(req) !== expectedToken) {
      return jsonError('Neplatny export token.', 401)
    }

    const year = parseYear(req.nextUrl.searchParams.get('year'))

    if (!year) {
      return jsonError('Neplatny alebo chybajuci rok.', 400)
    }

    const dateFrom = `${year}-01-01`
    const dateTo = `${year}-12-31`

    const { data: groupRows, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true })

    if (groupError) {
      return jsonError(groupError.message, 500)
    }

    const groups: RegistrationGroup[] = [
      ...(groupRows || []).map((group: any) => ({
        id: group.id,
        name: group.name || 'Registracna skupina',
        sheetColumnName: group.name || 'Registracna skupina'
      })),
      {
        id: UNASSIGNED_GROUP_ID,
        name: UNASSIGNED_GROUP_NAME,
        sheetColumnName: UNASSIGNED_GROUP_NAME
      }
    ]
    const activeGroupById = new Map(groups.map(group => [group.id, group]))

    const entitlementRows = await fetchAll((from, to) => supabaseServer
      .from('user_food_entitlements')
      // Schema note: this export counts planned entitlements. If the source table
      // changes, it must still provide user_id, datum, obed and vecera.
      .select('user_id, datum, obed, vecera')
      .gte('datum', dateFrom)
      .lte('datum', dateTo)
      .order('user_id', { ascending: true })
      .order('datum', { ascending: true })
      .range(from, to)
    )

    const userIds = Array.from(new Set(
      entitlementRows.map((row: any) => row.user_id).filter(Boolean)
    ))

    if (userIds.length === 0 || groups.length === 0) {
      return jsonOk({
        year,
        generatedAt: new Date().toISOString(),
        groups,
        rows: [],
        items: []
      })
    }

    const userRows: any[] = []
    const periodRows: any[] = []
    const selectionRows: any[] = []

    for (const userIdChunk of chunks(userIds, 400)) {
      userRows.push(...await fetchAll((from, to) => supabaseServer
        .from('users')
        // No personal data is exported. These columns are used only server-side.
        .select('id, aktivny, registration_group_id, typ_stravy')
        .in('id', userIdChunk)
        .order('id', { ascending: true })
        .range(from, to)
      ))

      periodRows.push(...await fetchAll((from, to) => supabaseServer
        .from('user_registration_group_periods')
        // Schema note: this table is the preferred source for group membership
        // valid on a concrete date.
        .select('user_id, registration_group_id, valid_from, valid_to')
        .in('user_id', userIdChunk)
        .lte('valid_from', dateTo)
        .or(`valid_to.is.null,valid_to.gte.${dateFrom}`)
        .order('user_id', { ascending: true })
        .order('valid_from', { ascending: false })
        .range(from, to)
      ))

      selectionRows.push(...await fetchAll((from, to) => supabaseServer
        .from('vyber_jedal')
        // Optional user meal selection. Fallback is users.typ_stravy.
        .select('user_id, datum, typ_jedla, volba')
        .in('user_id', userIdChunk)
        .gte('datum', dateFrom)
        .lte('datum', dateTo)
        .order('user_id', { ascending: true })
        .order('datum', { ascending: true })
        .order('typ_jedla', { ascending: true })
        .range(from, to)
      ))
    }

    const userById = new Map(userRows.map((row: any) => [row.id, row]))
    const selectionByKey = new Map<string, any>()

    selectionRows.forEach((row: any) => {
      const key = selectionKey(row.user_id, row.datum, row.typ_jedla)

      if (key) selectionByKey.set(key, row)
    })
    const periodsByUserId = new Map<string, any[]>()

    periodRows.forEach((row: any) => {
      const list = periodsByUserId.get(row.user_id) || []
      list.push(row)
      periodsByUserId.set(row.user_id, list)
    })

    const countByKey = new Map<string, number>()
    const rowKeys = new Set<string>()

    entitlementRows.forEach((row: any) => {
      const user = userById.get(row.user_id)
      const entitlementDate = cleanIsoDate(row.datum)

      if (!activeUser(user)) return
      if (!entitlementDate) return

      const registrationGroupId = registrationGroupForDate(
        user,
        periodsByUserId.get(row.user_id) || [],
        entitlementDate
      )
      const group = activeGroupById.get(registrationGroupId) || activeGroupById.get(UNASSIGNED_GROUP_ID)

      if (!group) return

      ;([
        ['OBED', row.obed],
        ['VECERA', row.vecera]
      ] as Array<[MealCode, boolean]>).forEach(([meal, enabled]) => {
        if (enabled !== true) return

        const selection = selectionByKey.get(selectionKey(row.user_id, entitlementDate, meal))
        const choice = normalizeChoice(selection?.volba || user?.typ_stravy)

        if (choice === 'BEZ_ZAUJMU') return

        const key = `${entitlementDate}|${meal}|${choice}|${group.name}`
        rowKeys.add(`${entitlementDate}|${meal}|${choice}`)
        countByKey.set(key, (countByKey.get(key) || 0) + 1)
      })
    })

    const rows: ExportRow[] = Array.from(rowKeys)
      .map(key => {
        const [date, meal, choice] = key.split('|')

        return {
          date,
          day: dayLabel(date),
          meal: mealLabel(meal as MealCode, choice as FoodChoice)
        }
      })
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare

        return mealLabelSortValue(a.meal) - mealLabelSortValue(b.meal)
      })

    const items: ExportItem[] = Array.from(countByKey.entries())
      .map(([key, count]) => {
        const [date, meal, choice, groupName] = key.split('|')

        return {
          date,
          meal: mealLabel(meal as MealCode, choice as FoodChoice),
          groupName,
          count
        }
      })
      .sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare

        const mealCompare = a.meal.localeCompare(b.meal, 'sk')
        if (mealCompare !== 0) return mealCompare

        return a.groupName.localeCompare(b.groupName, 'sk')
      })

    return jsonOk({
      year,
      generatedAt: new Date().toISOString(),
      groups,
      rows,
      items
    })
  } catch (err: any) {
    return jsonError(err?.message || 'Gastro export sa nepodarilo pripravit.', 500)
  }
}
