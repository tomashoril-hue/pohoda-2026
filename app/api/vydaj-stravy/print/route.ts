import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const DEFAULT_LABEL_PRINTER_ID = 'vydaj-1'
const DEFAULT_JOURNAL_PRINTER_ID = 'vydaj-zurnal'
const PRINT_TIME_ZONE = 'Europe/Bratislava'

type PrintScope =
  | { kind: 'INDIVIDUAL'; id: string }
  | { kind: 'LEGACY_BULK'; id: string }
  | { kind: 'REGISTRATION_BULK'; id: string }

type PrintKind = 'LABELS' | 'JOURNAL'

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function zplText(value: unknown, maxLength = 120) {
  return cleanText(value)
    .replace(/[\^~]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
}

function normalizePrinterId(value: unknown, fallback: string) {
  const printerId = cleanText(value) || fallback
  return printerId.slice(0, 80)
}

function normalizePrintKind(value: unknown): PrintKind {
  const text = cleanText(value).toUpperCase()

  if (text === 'JOURNAL' || text === 'ZURNAL' || text === '\u017DURN\u00C1L' || text === 'REPORT') {
    return 'JOURNAL'
  }

  return 'LABELS'
}

function normalizeChoice(value: unknown) {
  const text = cleanText(value).toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DI\u00C9TA') return 'DIETA'
  return 'NEZADANE'
}

function choiceLabel(value: unknown) {
  const choice = normalizeChoice(value)
  if (choice === 'DIETA') return 'DIETA'
  if (choice === 'VEGE') return 'VEGE'
  if (choice === 'MASO') return 'MASO'
  return 'NEZADANE'
}

function mealLabel(value: unknown) {
  return cleanText(value).toUpperCase() === 'VECERA' ? 'VECERA' : 'OBED'
}

function parseScope(value: unknown): PrintScope | null {
  const text = cleanText(value)

  if (!text) return null
  if (text.startsWith('bulk:')) return { kind: 'LEGACY_BULK', id: text.slice(5) }
  if (text.startsWith('registration:')) return { kind: 'REGISTRATION_BULK', id: text.slice(13) }

  return { kind: 'INDIVIDUAL', id: text }
}

function fullName(user: any) {
  return cleanText(`${cleanText(user?.meno)} ${cleanText(user?.priezvisko)}`) || cleanText(user?.email)
}

function formatPrintDateTime(value?: string) {
  const date = value ? new Date(value) : new Date()

  const parts = new Intl.DateTimeFormat('sk-SK', {
    timeZone: PRINT_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date)

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value || ''

  return `${getPart('day')}.${getPart('month')}.${getPart('year')} ${getPart('hour')}:${getPart('minute')}`
}

function summaryFromRows(rows: any[]) {
  return rows.reduce((acc: Record<string, number>, row: any) => {
    const choice = normalizeChoice(row.volba)
    acc[choice] = (acc[choice] || 0) + 1
    return acc
  }, { MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 })
}

function buildMealLabelZpl(input: {
  name: string
  groupName: string
  choice: string
  issuedAt: string
}) {
  const name = zplText(input.name || 'Bez mena', 52)
  const groupName = zplText(input.groupName || '-', 54)
  const choice = zplText(choiceLabel(input.choice), 18)
  const issuedAt = zplText(formatPrintDateTime(input.issuedAt), 24)

  return [
    '^XA',
    '^CI28',
    '^PW384',
    '^LL252',
    '^MMT',
    '^MNN',
    '^POI',
    '~TA020',
    '^LT0',
    '^FO14,16^GB356,220,2,12^FS',
    '^FO0,34^FB384,1,0,C,0^A0N,25,25^FD' + name + '^FS',
    '^FO22,74^FB340,2,0,C,0^A0N,18,18^FD' + groupName + '^FS',
    '^FO112,128^GB160,32,2,15^FS',
    '^FO112,136^FB160,1,0,C,0^A0N,18,18^FD' + choice + '^FS',
    '^FO0,188^FB384,1,0,C,0^A0N,21,21^FD' + issuedAt + '^FS',
    '^XZ'
  ].join('\n')
}

function buildReportZpl(input: {
  title: string
  meal: string
  issuedAt: string
  rows: Array<{ name: string; choice: string }>
}) {
  const rowHeight = 30
  const height = Math.max(430, 190 + input.rows.length * rowHeight)
  const summary = input.rows.reduce((acc: Record<string, number>, row) => {
    const choice = normalizeChoice(row.choice)
    acc[choice] = (acc[choice] || 0) + 1
    return acc
  }, { MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 })

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
    '^FO12,18^FB360,1,0,C,0^A0N,25,25^FDREPORT VYDAJA^FS',
    '^FO12,52^FB360,2,0,C,0^A0N,19,19^FD' + zplText(input.title || 'Vydaj stravy', 70) + '^FS',
    '^FO12,98^FB360,1,0,C,0^A0N,18,18^FD' + zplText(mealLabel(input.meal) + '  ' + formatPrintDateTime(input.issuedAt), 48) + '^FS',
    '^FO12,126^FB360,1,0,C,0^A0N,17,17^FDMASO ' + (summary.MASO || 0) + '  VEGE ' + (summary.VEGE || 0) + '  DIETA ' + (summary.DIETA || 0) + '^FS',
    '^FO12,154^GB360,1,1^FS'
  ]

  input.rows.forEach((row, index) => {
    const y = 172 + index * rowHeight
    lines.push('^FO12,' + y + '^FB270,1,0,L,0^A0N,17,17^FD' + zplText(`${index + 1}. ${row.name}`, 42) + '^FS')
    lines.push('^FO292,' + y + '^FB80,1,0,R,0^A0N,17,17^FD' + zplText(choiceLabel(row.choice), 10) + '^FS')
  })

  lines.push('^XZ')

  return lines.join('\n')
}

async function loadIssuedRows(scope: PrintScope) {
  const selectIssued = 'id, user_id, group_id, hromadny_vydaj_id, registration_group_issue_id, datum, typ_jedla, volba, sposob, issued_by, issued_at, qr_code, source'

  if (scope.kind === 'LEGACY_BULK') {
    return supabaseServer
      .from('vydaj_jedal')
      .select(selectIssued)
      .eq('hromadny_vydaj_id', scope.id)
      .eq('status', 'VYDANE')
      .order('issued_at', { ascending: true })
      .limit(1000)
  }

  if (scope.kind === 'REGISTRATION_BULK') {
    return supabaseServer
      .from('vydaj_jedal')
      .select(selectIssued)
      .eq('registration_group_issue_id', scope.id)
      .eq('sposob', 'HROMADNE')
      .eq('status', 'VYDANE')
      .order('issued_at', { ascending: true })
      .limit(1000)
  }

  const { data: row, error } = await supabaseServer
    .from('vydaj_jedal')
    .select(selectIssued)
    .eq('id', scope.id)
    .eq('status', 'VYDANE')
    .maybeSingle()

  if (error) return { data: null, error }
  if (!row) return { data: [], error: null }

  if (row.sposob === 'HROMADNE' && row.hromadny_vydaj_id) {
    return loadIssuedRows({ kind: 'LEGACY_BULK', id: row.hromadny_vydaj_id })
  }

  if (row.sposob === 'HROMADNE' && row.registration_group_issue_id) {
    return loadIssuedRows({ kind: 'REGISTRATION_BULK', id: row.registration_group_issue_id })
  }

  return { data: [row], error: null }
}

async function loadIssueTitle(rows: any[], scope: PrintScope) {
  const first = rows[0] || {}

  if (scope.kind === 'REGISTRATION_BULK' || first.registration_group_issue_id) {
    const issueId = scope.kind === 'REGISTRATION_BULK' ? scope.id : first.registration_group_issue_id
    const { data } = await supabaseServer
      .from('registration_group_issues')
      .select(`
        id,
        title,
        registration_groups (
          name
        )
      `)
      .eq('id', issueId)
      .maybeSingle()

    const group = Array.isArray((data as any)?.registration_groups)
      ? (data as any).registration_groups[0]
      : (data as any)?.registration_groups

    return cleanText((data as any)?.title) || cleanText(group?.name) || 'Skupinovy vydaj'
  }

  if (scope.kind === 'LEGACY_BULK' || first.hromadny_vydaj_id) {
    const issueId = scope.kind === 'LEGACY_BULK' ? scope.id : first.hromadny_vydaj_id
    const { data } = await supabaseServer
      .from('hromadne_vydaje')
      .select(`
        id,
        groups (
          name
        )
      `)
      .eq('id', issueId)
      .maybeSingle()

    const group = Array.isArray((data as any)?.groups)
      ? (data as any).groups[0]
      : (data as any)?.groups

    return cleanText(group?.name) || 'Hromadny vydaj'
  }

  return 'Individualny vydaj'
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canAdminFoodIssue) {
      return NextResponse.json({ error: 'Tlacit vydaje moze iba ADMIN alebo ADMIN_VYDAJ.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const scope = parseScope(body.issuedId || body.issued_id)

    if (!scope?.id) {
      return NextResponse.json({ error: 'Chyba ID vydaja.' }, { status: 400 })
    }

    const printKind = normalizePrintKind(body.printKind || body.print_kind || body.type)
    const labelPrinterId = normalizePrinterId(
      body.labelPrinterId || body.label_printer_id || (printKind === 'LABELS' ? body.printer_id : ''),
      DEFAULT_LABEL_PRINTER_ID
    )
    const journalPrinterId = normalizePrinterId(
      body.journalPrinterId || body.journal_printer_id || body.reportPrinterId || body.report_printer_id || (printKind === 'JOURNAL' ? body.printer_id : ''),
      DEFAULT_JOURNAL_PRINTER_ID
    )
    const { data: rowsData, error: rowsError } = await loadIssuedRows(scope)

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    const issuedRows = (rowsData || []).filter((row: any) => row?.id)

    if (issuedRows.length === 0) {
      return NextResponse.json({ error: 'Vydaj sa nenasiel alebo uz nie je vydany.' }, { status: 404 })
    }

    const userIds = Array.from(new Set(issuedRows.map((row: any) => row.user_id).filter(Boolean)))
    const { data: usersData, error: usersError } = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, typ_stravy, registration_group_id')
        .in('id', userIds)
      : { data: [], error: null }

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const registrationGroupIds = Array.from(new Set((usersData || []).map((user: any) => user.registration_group_id).filter(Boolean)))
    const { data: groupsData, error: groupsError } = registrationGroupIds.length > 0
      ? await supabaseServer
        .from('registration_groups')
        .select('id, name')
        .in('id', registrationGroupIds)
      : { data: [], error: null }

    if (groupsError) {
      return NextResponse.json({ error: groupsError.message }, { status: 500 })
    }

    const userMap = new Map((usersData || []).map((user: any) => [user.id, user]))
    const registrationGroupMap = new Map((groupsData || []).map((group: any) => [group.id, group]))
    const issueTitle = await loadIssueTitle(issuedRows, scope)
    const firstIssuedAt = issuedRows[0]?.issued_at || new Date().toISOString()
    const meal = mealLabel(issuedRows[0]?.typ_jedla)
    const printableRows = issuedRows
      .map((row: any) => {
        const user: any = userMap.get(row.user_id)
        const registrationGroup: any = registrationGroupMap.get(user?.registration_group_id)
        const name = fullName(user) || 'Bez mena'
        const groupName = cleanText(registrationGroup?.name) || issueTitle
        const choice = normalizeChoice(row.volba || user?.typ_stravy)

        return {
          row,
          name,
          groupName,
          choice,
          issuedAt: row.issued_at || firstIssuedAt
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'sk'))

    const summary = summaryFromRows(issuedRows)
    const labelJobs = printableRows.map(item => ({
      printer_id: labelPrinterId,
      status: 'pending',
      created_by: actor.id,
      payload: {
        type: 'zpl',
        template: 'issued_meal_label',
        name: item.name,
        group: item.groupName,
        meal,
        food: item.choice,
        issuedId: item.row.id,
        zpl: buildMealLabelZpl({
          name: item.name,
          groupName: item.groupName,
          choice: item.choice,
          issuedAt: item.issuedAt
        })
      }
    }))

    const reportJob = {
      printer_id: journalPrinterId,
      status: 'pending',
      created_by: actor.id,
      payload: {
        type: 'zpl',
        template: 'issued_meal_journal',
        title: issueTitle,
        meal,
        count: printableRows.length,
        summary,
        zpl: buildReportZpl({
          title: issueTitle,
          meal,
          issuedAt: firstIssuedAt,
          rows: printableRows.map(row => ({
            name: row.name,
            choice: row.choice
          }))
        })
      }
    }

    const jobs = printKind === 'JOURNAL' ? [reportJob] : labelJobs

    const { error: insertError } = await supabaseServer
      .from('print_jobs')
      .insert(jobs)

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const message = printKind === 'JOURNAL'
      ? 'Žurnál bol odoslaný do tlače.'
      : `Etikety boli odoslané do tlače: ${labelJobs.length} ks.`

    return NextResponse.json({
      ok: true,
      type: printKind,
      labelCount: printKind === 'LABELS' ? labelJobs.length : 0,
      journalCount: printKind === 'JOURNAL' ? 1 : 0,
      message
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Vydaj sa nepodarilo odoslat do tlace.' },
      { status: 500 }
    )
  }
}
