import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

type Meal = 'OBED' | 'VECERA'
type ReportType = 'ISSUED' | 'UNISSUED' | 'ENTITLED' | 'CANCELLED'
type Choice = 'MASO' | 'VEGE' | 'DIETA' | 'NEZADANE'

const JOURNAL_PRINTER_ID = 'vydaj-zurnal'
const PRINT_TIME_ZONE = 'Europe/Bratislava'

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeDate(value: unknown) {
  const text = cleanText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeMeal(value: unknown): Meal {
  const text = cleanText(value).toUpperCase()
  return text === 'VECERA' || text === 'VE\u010CERA' ? 'VECERA' : 'OBED'
}

function normalizeReportType(value: unknown): ReportType {
  const text = cleanText(value).toUpperCase()
  if (text === 'UNISSUED') return 'UNISSUED'
  if (text === 'ENTITLED') return 'ENTITLED'
  if (text === 'CANCELLED') return 'CANCELLED'
  return 'ISSUED'
}

function normalizeChoice(value: unknown): Choice {
  const text = cleanText(value).toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DI\u00C9TA') return 'DIETA'
  return 'NEZADANE'
}

function isNoInterest(value: unknown) {
  return cleanText(value).toUpperCase() === 'BEZ_ZAUJMU'
}

function fullName(user: any) {
  return cleanText(`${cleanText(user?.meno)} ${cleanText(user?.priezvisko)}`) || cleanText(user?.email) || 'Bez mena'
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
  let from = 0

  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const page = data || []
    rows.push(...page)

    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

function registrationGroupForDate(user: any, periods: any[], date: string) {
  const normalizedPeriods = periods
    .map(period => ({
      ...period,
      valid_from: normalizeDate(period.valid_from),
      valid_to: normalizeDate(period.valid_to)
    }))
    .filter(period => period.valid_from)

  const period = normalizedPeriods
    .filter(period => period.valid_from <= date && (!period.valid_to || period.valid_to >= date))
    .sort((a, b) => {
      const fromCompare = b.valid_from.localeCompare(a.valid_from)
      if (fromCompare !== 0) return fromCompare
      return cleanText(b.id).localeCompare(cleanText(a.id))
    })[0]

  if (period?.registration_group_id) return period.registration_group_id
  return user?.registration_group_id || ''
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value

  return new Intl.DateTimeFormat('sk-SK', {
    timeZone: PRINT_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)))
}

function timeLabel(value: string) {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      timeZone: PRINT_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function reportTitle(type: ReportType) {
  if (type === 'UNISSUED') return 'NEVYDANE JEDLA'
  if (type === 'ENTITLED') return 'VSETKY PLATNE JEDLA'
  if (type === 'CANCELLED') return 'ODHLASENE JEDLA'
  return 'VYDANE JEDLA'
}

function zplText(value: unknown, maxLength = 120) {
  return cleanText(value)
    .replace(/[\^~]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
}

function buildSummary(rows: Array<{ choice: Choice }>) {
  return rows.reduce((acc, row) => {
    acc.total += 1
    acc[row.choice] += 1
    return acc
  }, { total: 0, MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 })
}

function zplSectionName(row: any) {
  return zplText(row.sectionName || row.groupName || 'Nezaradeny', 58)
}

function groupRowsForPrint(rows: any[]) {
  const sections: Array<{ name: string; rows: any[] }> = []
  const sectionByName = new Map<string, { name: string; rows: any[] }>()

  rows.forEach(row => {
    const name = zplSectionName(row)
    let section = sectionByName.get(name)

    if (!section) {
      section = { name, rows: [] }
      sectionByName.set(name, section)
      sections.push(section)
    }

    section.rows.push(row)
  })

  return sections
}

function buildReportZpl(input: {
  type: ReportType
  datum: string
  meal: Meal
  rows: any[]
  summary: ReturnType<typeof buildSummary>
}) {
  const sections = groupRowsForPrint(input.rows)
  const sectionHeight = 34
  const rowHeight = input.type === 'ISSUED' ? 39 : 31
  const contentHeight = sections.reduce((total, section) => total + sectionHeight + section.rows.length * rowHeight, 0)
  const height = Math.max(430, 160 + contentHeight)
  const title = reportTitle(input.type)
  const lines = [
    '^XA',
    '^CI28',
    '^PW384',
    '^LL' + height,
    '^MMT',
    '^MNN',
    '^POI',
    '~TA020',
    '^LT0',
    '^FO12,18^FB360,1,0,C,0^A0N,24,24^FD' + title + '^FS',
    '^FO12,52^FB360,1,0,C,0^A0N,19,19^FD' + zplText(`${dateLabel(input.datum)}  ${input.meal}`, 48) + '^FS',
    '^FO12,84^FB360,1,0,C,0^A0N,18,18^FDSPOLU ' + input.summary.total + '  MASO ' + input.summary.MASO + '  VEGE ' + input.summary.VEGE + '  DIETA ' + input.summary.DIETA + '^FS',
    '^FO12,116^GB360,1,1^FS'
  ]

  let y = 132
  let rowNumber = 1

  sections.forEach(section => {
    lines.push('^FO12,' + y + '^GB360,25,1,8^FS')
    lines.push('^FO20,' + (y + 6) + '^FB280,1,0,L,0^A0N,16,16^FD' + zplText(section.name, 42) + '^FS')
    lines.push('^FO305,' + (y + 6) + '^FB56,1,0,R,0^A0N,16,16^FD' + section.rows.length + ' ks^FS')
    y += sectionHeight

    section.rows.forEach(row => {
      const firstLine = `${rowNumber}. ${row.name}`

      if (input.type === 'ISSUED') {
        lines.push('^FO16,' + y + '^FB260,1,0,L,0^A0N,17,17^FD' + zplText(firstLine, 43) + '^FS')
        lines.push('^FO290,' + y + '^FB78,1,0,R,0^A0N,17,17^FD' + zplText(row.choice, 10) + '^FS')
        lines.push('^FO32,' + (y + 20) + '^FB244,1,0,L,0^A0N,14,14^FD' + zplText(row.sourceName || row.method || '', 42) + '^FS')
        lines.push('^FO290,' + (y + 20) + '^FB78,1,0,R,0^A0N,14,14^FD' + zplText(timeLabel(row.issuedAt), 12) + '^FS')
      } else {
        lines.push('^FO16,' + y + '^FB270,1,0,L,0^A0N,16,16^FD' + zplText(firstLine, 45) + '^FS')
        lines.push('^FO292,' + y + '^FB76,1,0,R,0^A0N,16,16^FD' + zplText(row.choice, 10) + '^FS')
      }

      y += rowHeight
      rowNumber += 1
    })
  })

  lines.push('^XZ')
  return lines.join('\n')
}

async function buildReport(datum: string, meal: Meal, type: ReportType) {
  const entitlementRows = await fetchAll((from, to) => supabaseServer
    .from('user_food_entitlements')
    .select('user_id, datum, obed, vecera')
    .eq('datum', datum)
    .range(from, to)
  )

  const entitlementUserIds = Array.from(new Set(entitlementRows.map((row: any) => row.user_id).filter(Boolean)))

  const issuedRows = await fetchAll((from, to) => supabaseServer
    .from('vydaj_jedal')
    .select('id, user_id, group_id, hromadny_vydaj_id, registration_group_issue_id, datum, typ_jedla, volba, sposob, source, issued_at')
    .eq('datum', datum)
    .eq('typ_jedla', meal)
    .eq('status', 'VYDANE')
    .order('issued_at', { ascending: true })
    .range(from, to)
  )

  const issuedUserIds = issuedRows.map((row: any) => row.user_id).filter(Boolean)
  const userIds = Array.from(new Set([...entitlementUserIds, ...issuedUserIds]))

  if (userIds.length === 0) {
    return {
      type,
      datum,
      meal,
      rows: [],
      summary: buildSummary([])
    }
  }

  const userRows: any[] = []
  const periodRows: any[] = []
  const selectionRows: any[] = []

  for (const userIdChunk of chunks(userIds, 400)) {
    userRows.push(...await fetchAll((from, to) => supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, typ_stravy, aktivny, registration_group_id')
      .in('id', userIdChunk)
      .range(from, to)
    ))

    periodRows.push(...await fetchAll((from, to) => supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to')
      .in('user_id', userIdChunk)
      .lte('valid_from', datum)
      .or(`valid_to.is.null,valid_to.gte.${datum}`)
      .range(from, to)
    ))

    selectionRows.push(...await fetchAll((from, to) => supabaseServer
      .from('vyber_jedal')
      .select('user_id, datum, typ_jedla, volba')
      .in('user_id', userIdChunk)
      .eq('datum', datum)
      .eq('typ_jedla', meal)
      .range(from, to)
    ))
  }

  const registrationIssueIds = Array.from(new Set(issuedRows.map((row: any) => row.registration_group_issue_id).filter(Boolean)))
  const legacyIssueIds = Array.from(new Set(issuedRows.map((row: any) => row.hromadny_vydaj_id).filter(Boolean)))

  const { data: registrationIssueRows, error: registrationIssueError } = registrationIssueIds.length > 0
    ? await supabaseServer
      .from('registration_group_issues')
      .select('id, title, registration_group_id')
      .in('id', registrationIssueIds)
    : { data: [], error: null }

  if (registrationIssueError) throw registrationIssueError

  const { data: legacyIssueRows, error: legacyIssueError } = legacyIssueIds.length > 0
    ? await supabaseServer
      .from('hromadne_vydaje')
      .select(`
        id,
        group_id,
        groups (
          name
        )
      `)
      .in('id', legacyIssueIds)
    : { data: [], error: null }

  if (legacyIssueError) throw legacyIssueError

  const userById = new Map(userRows.map((row: any) => [row.id, row]))
  const periodsByUserId = new Map<string, any[]>()
  periodRows.forEach((row: any) => {
    const list = periodsByUserId.get(row.user_id) || []
    list.push(row)
    periodsByUserId.set(row.user_id, list)
  })

  const selectionByUserId = new Map(selectionRows.map((row: any) => [row.user_id, row]))
  const registrationIssueById = new Map((registrationIssueRows || []).map((row: any) => [row.id, row]))
  const legacyIssueById = new Map((legacyIssueRows || []).map((row: any) => [row.id, row]))

  const groupIds = Array.from(new Set(userRows
    .flatMap((user: any) => [
      user.registration_group_id,
      ...((periodsByUserId.get(user.id) || []).map(period => period.registration_group_id)),
      ...((registrationIssueRows || []).map((issue: any) => issue.registration_group_id))
    ])
    .filter(Boolean)
  ))

  const { data: groupRows, error: groupError } = groupIds.length > 0
    ? await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .in('id', groupIds)
    : { data: [], error: null }

  if (groupError) throw groupError

  const groupById = new Map((groupRows || []).map((row: any) => [row.id, row]))
  const issuedByUserId = new Map<string, any>()
  issuedRows.forEach((row: any) => {
    if (row.user_id && !issuedByUserId.has(row.user_id)) issuedByUserId.set(row.user_id, row)
  })

  const entitlementByUserId = new Map(entitlementRows.map((row: any) => [row.user_id, row]))

  function issuedSourceName(issued: any, fallbackGroupName: string) {
    if (issued?.registration_group_issue_id) {
      const issue: any = registrationIssueById.get(issued.registration_group_issue_id)
      const group: any = groupById.get(issue?.registration_group_id)
      return cleanText(issue?.title) || cleanText(group?.name) || fallbackGroupName
    }

    if (issued?.hromadny_vydaj_id) {
      const legacyIssue: any = legacyIssueById.get(issued.hromadny_vydaj_id)
      const legacyGroup = Array.isArray(legacyIssue?.groups) ? legacyIssue.groups[0] : legacyIssue?.groups
      return cleanText(legacyGroup?.name) || fallbackGroupName
    }

    return ''
  }

  const entitlementItems = entitlementRows
    .map((entitlement: any) => {
      const user: any = userById.get(entitlement.user_id)
      if (!user || cleanText(user.aktivny).toUpperCase() !== 'ANO') return null

      const hasEntitlement = meal === 'OBED' ? entitlement.obed === true : entitlement.vecera === true
      if (!hasEntitlement) return null

      const selection: any = selectionByUserId.get(entitlement.user_id)
      const cancelled = isNoInterest(selection?.volba)
      const choice = normalizeChoice(cancelled ? user.typ_stravy : (selection?.volba || user.typ_stravy))
      const groupId = registrationGroupForDate(user, periodsByUserId.get(user.id) || [], datum)
      const group: any = groupById.get(groupId)
      const issued = issuedByUserId.get(user.id)
      const groupName = cleanText(group?.name) || 'Nezaradeny'
      const sourceName = issuedSourceName(issued, groupName)

      return {
        userId: user.id,
        name: fullName(user),
        email: cleanText(user.email),
        groupName,
        sectionName: sourceName || groupName,
        sourceName,
        choice,
        cancelled,
        issued: Boolean(issued),
        issuedAt: issued?.issued_at || '',
        method: issued?.sposob || ''
      }
    })
    .filter(Boolean)

  const issuedItems = issuedRows
    .map((issued: any) => {
      const user: any = userById.get(issued.user_id)
      if (!user) return null

      const entitlement: any = entitlementByUserId.get(user.id)
      const selection: any = selectionByUserId.get(user.id)
      const groupId = registrationGroupForDate(user, periodsByUserId.get(user.id) || [], datum)
      const group: any = groupById.get(groupId)
      const groupName = cleanText(group?.name) || 'Nezaradeny'
      const sourceName = issuedSourceName(issued, groupName)

      return {
        userId: user.id,
        name: fullName(user),
        email: cleanText(user.email),
        groupName,
        sectionName: sourceName || groupName,
        sourceName,
        choice: normalizeChoice(issued.volba || selection?.volba || user.typ_stravy),
        cancelled: isNoInterest(selection?.volba),
        issued: true,
        issuedAt: issued.issued_at || '',
        method: issued.sposob || '',
        hadEntitlement: entitlement ? (meal === 'OBED' ? entitlement.obed === true : entitlement.vecera === true) : false
      }
    })
    .filter(Boolean)

  let rows: any[]
  if (type === 'ISSUED') {
    rows = issuedItems
  } else if (type === 'CANCELLED') {
    rows = entitlementItems.filter((row: any) => row.cancelled)
  } else if (type === 'UNISSUED') {
    rows = entitlementItems.filter((row: any) => !row.cancelled && !row.issued)
  } else {
    rows = entitlementItems.filter((row: any) => !row.cancelled)
  }

  rows.sort((a, b) => {
    const sectionCompare = cleanText(a.sectionName).localeCompare(cleanText(b.sectionName), 'sk')
    if (sectionCompare !== 0) return sectionCompare
    const groupCompare = cleanText(a.groupName).localeCompare(cleanText(b.groupName), 'sk')
    if (groupCompare !== 0) return groupCompare
    return cleanText(a.name).localeCompare(cleanText(b.name), 'sk')
  })

  return {
    type,
    datum,
    meal,
    rows,
    summary: buildSummary(rows)
  }
}

function getRequestParams(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return {
    datum: normalizeDate(searchParams.get('datum')),
    meal: normalizeMeal(searchParams.get('typJedla') || searchParams.get('meal')),
    type: normalizeReportType(searchParams.get('type'))
  }
}

async function requireAccess() {
  const actor = await getCurrentUser()

  if (!actor) {
    return { error: NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 }) }
  }

  const access = await getGlobalAccess(actor.id)
  if (!access.canAdminFoodIssue) {
    return { error: NextResponse.json({ error: 'Reporty vydaja moze pouzit iba ADMIN alebo ADMIN_VYDAJ.' }, { status: 403 }) }
  }

  return { actor }
}

export async function GET(req: NextRequest) {
  try {
    const access = await requireAccess()
    if (access.error) return access.error

    const params = getRequestParams(req)
    if (!params.datum) return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })

    const report = await buildReport(params.datum, params.meal, params.type)

    return NextResponse.json({ ok: true, report })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Report sa nepodarilo nacitat.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess()
    if (access.error) return access.error

    const body = await req.json().catch(() => ({}))
    const datum = normalizeDate(body.datum || body.date)
    const meal = normalizeMeal(body.typJedla || body.meal)
    const type = normalizeReportType(body.type)

    if (!datum) return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })

    const report = await buildReport(datum, meal, type)
    const zpl = buildReportZpl(report)

    const { data, error } = await supabaseServer
      .from('print_jobs')
      .insert({
        printer_id: JOURNAL_PRINTER_ID,
        status: 'pending',
        created_by: access.actor.id,
        payload: {
          type: 'zpl',
          template: 'meal_issue_report',
          reportType: type,
          datum,
          meal,
          count: report.rows.length,
          summary: report.summary,
          zpl
        }
      })
      .select('id, printer_id, status')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      report,
      job: data,
      message: 'Report bol odoslany na paskovu tlaciaren.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Report sa nepodarilo vytlacit.' }, { status: 500 })
  }
}
