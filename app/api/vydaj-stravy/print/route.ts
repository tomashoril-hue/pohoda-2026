import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const DEFAULT_LABEL_PRINTER_ID = 'vydaj-1'
const DEFAULT_JOURNAL_PRINTER_ID = 'vydaj-zurnal'
const PRINT_TIME_ZONE = 'Europe/Bratislava'
const BABETKA_TINY_GFA = '^GFA,968,968,11,0000000001FF80000000000000000007FFF000000000000000000FFFFC00000000000000003F007E00000000000000007C001F003F800000000000F0000780FFF00000000000E0000383FFFC0000000001E00003CFE0FF0000000003C00001DF001F8000000003800001FC0007C000000007800003F80003E000000007000003F00001E00000000F000007E00000F00000001E00000FC00000700000001E00000F800000700000003C00001F000000700000007800003E00000070000000F000003C00000070000000F000007C00000070000001E00000F800000070000001C30000F0000000F0000003C18001F0000000F000001F8CC001E0000000F000007F8FE001E0000001E00000FF83E001E0000001E00001F301C783C0000003C00003C301CFE3C000000380000F83018E43C000000F80003F83831F83C000001F8000FF03831BC3E000007F8001F801CC7007FC6000630003E000FCE007FCE000C7000790007E0007CCC00007000F38003FC00FD8F00006000E3C1C1DC01FB8F8000C000E0FF80FFC3FF810001C000E07F1FFFFFFDC0001F8000E03F7FE07FFE80003F0000E01FF07001FF06007F8000F007C1D800FFFC00FFE000780000F000EDF803FFF0007C0003B001F4C00FC070003E0003F803F0FFFF0078001F000E7003C07FFC0038000FE00FF003C03BC000380007FFFDE003003803003C0003FFFF8003803803003C0003C0CF8003C01C07003C000380000003E00E0701BC000380000003F0078E03BC000380000003F803FE03BC000380000003FC00FC07BC000780000003FE0078073C000700000007FF00000F3800070003FC07CF80000E380007000FFF0F03C0000E380007003F0FFE03E0001C78000700F803FC07F0003C78000701E000F01FFC0038780007078000E03C3E00707000070F000070700F00F07000071E000070E007E1E0F0000738000031C003FFC0F0000730000039C001FF80E000078000C03B8001CE00E000078001C01B8000E001E000078001C01F00007001C000078001801F03007801C00003C003801F03003803C00003C003C01F03801C03800003C007C00F01801C03800001E00FE00F01C00E07000001F01FF00F01C00E07000000F83CF80F0380060E0000007FF9BC070380071E0000003FF1BC070380021C0000000FE1FE038780003C00000001E1FF039FE000780000000078FF81FFF00070000000003FFF80FCF000F0000000001FFFC001F001E00000000007FFC000F003C00000000000FFE001E00F8000000000001FE001E01F0000000000000FF007C07E00000000000007FFFFFFF800000000000001FFFFFFE0000000000000007FFFFF8000000'

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

function choiceSortRank(value: unknown) {
  const choice = normalizeChoice(value)
  if (choice === 'MASO') return 0
  if (choice === 'VEGE') return 1
  if (choice === 'DIETA') return 2
  return 3
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
    '^MNY',
    '^POI',
    '~TA000',
    '^LT0',
    '^FO16,226^A0B,16,16^FDPOHODA 2026^FS',
    '^FO0,34^FB384,1,0,C,0^A0N,25,25^FD' + name + '^FS',
    '^FO22,74^FB340,2,0,C,0^A0N,18,18^FD' + groupName + '^FS',
    '^FO112,128^GB160,32,2,15^FS',
    '^FO112,136^FB160,1,0,C,0^A0N,18,18^FD' + choice + '^FS',
    '^FO292,108' + BABETKA_TINY_GFA + '^FS',
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
      .sort((a, b) => {
        const choiceDiff = choiceSortRank(a.choice) - choiceSortRank(b.choice)
        if (choiceDiff !== 0) return choiceDiff

        const groupDiff = a.groupName.localeCompare(b.groupName, 'sk')
        if (groupDiff !== 0) return groupDiff

        return a.name.localeCompare(b.name, 'sk')
      })

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
