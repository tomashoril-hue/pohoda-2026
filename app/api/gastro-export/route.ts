import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

type MealCode = 'OBED' | 'VECERA'
type FoodChoice = 'MASO' | 'VEGE' | 'DIETA'

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function cleanText(value: any) {
  return String(value || '').trim()
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

function normalizeChoice(value: any): FoodChoice {
  const text = cleanText(value).toUpperCase()
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA' || text === 'DIĂ‰TA') return 'DIETA'
  return 'MASO'
}

function mealLabel(meal: MealCode, choice: FoodChoice) {
  const base = meal === 'OBED' ? 'Obed' : 'Večera'

  if (choice === 'VEGE') return `${base} V`
  if (choice === 'DIETA') return `${base} diéta`

  return base
}

function mealLabelSortValue(meal: string) {
  const text = cleanText(meal).toLowerCase()

  if (text === 'obed') return 1
  if (text === 'obed v') return 2
  if (text === 'obed diéta' || text === 'obed dieta') return 3
  if (text === 'večera' || text === 'vecera') return 4
  if (text === 'večera v' || text === 'vecera v') return 5
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
  const period = periods.find(item => {
    return item.valid_from <= date && (!item.valid_to || item.valid_to >= date)
  })

  // Fallback for older users that still only have users.registration_group_id.
  return period?.registration_group_id || user?.registration_group_id || ''
}

export async function GET(req: NextRequest) {
  try {
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

    const groups: RegistrationGroup[] = (groupRows || []).map((group: any) => ({
      id: group.id,
      name: group.name || 'Registracna skupina',
      sheetColumnName: group.name || 'Registracna skupina'
    }))
    const activeGroupById = new Map(groups.map(group => [group.id, group]))

    const entitlementRows = await fetchAll((from, to) => supabaseServer
      .from('user_food_entitlements')
      // Schema note: this export counts planned entitlements. If the source table
      // changes, it must still provide user_id, datum, obed and vecera.
      .select('user_id, datum, obed, vecera')
      .gte('datum', dateFrom)
      .lte('datum', dateTo)
      .range(from, to)
    )

    const userIds = Array.from(new Set(
      entitlementRows.map((row: any) => row.user_id).filter(Boolean)
    ))

    if (userIds.length === 0 || groups.length === 0) {
      return NextResponse.json({
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
        .range(from, to)
      ))
    }

    const userById = new Map(userRows.map((row: any) => [row.id, row]))
    const selectionByKey = new Map(
      selectionRows.map((row: any) => [`${row.user_id}|${row.datum}|${row.typ_jedla}`, row])
    )
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

      if (!activeUser(user)) return

      const registrationGroupId = registrationGroupForDate(
        user,
        periodsByUserId.get(row.user_id) || [],
        row.datum
      )
      const group = activeGroupById.get(registrationGroupId)

      if (!group) return

      ;([
        ['OBED', row.obed],
        ['VECERA', row.vecera]
      ] as Array<[MealCode, boolean]>).forEach(([meal, enabled]) => {
        if (enabled !== true) return

        const selection = selectionByKey.get(`${row.user_id}|${row.datum}|${meal}`)
        const choice = normalizeChoice(selection?.volba || user?.typ_stravy)
        const key = `${row.datum}|${meal}|${choice}|${group.name}`
        rowKeys.add(`${row.datum}|${meal}|${choice}`)
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

    return NextResponse.json({
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
