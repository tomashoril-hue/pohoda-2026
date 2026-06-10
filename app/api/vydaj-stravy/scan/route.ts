import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function clean(value: any) {
  return String(value || '').trim()
}

function normalizeDate(value: any) {
  const text = clean(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeMeal(value: any) {
  const text = clean(value).toUpperCase()
  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA' || text === 'VEČERA') return 'VECERA'
  return ''
}

function normalizeChoice(value: any) {
  const text = clean(value).toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'
  return null
}

function normalizeSelectionChoice(value: any) {
  const text = clean(value).toUpperCase()
  if (text === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'
  return normalizeChoice(value)
}

function effectiveMealChoice(selectionValue: any, defaultValue: any) {
  const selectionChoice = normalizeSelectionChoice(selectionValue)

  if (selectionChoice === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'

  return selectionChoice || normalizeChoice(defaultValue)
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

function entitlementOk(row: any, meal: string) {
  if (!row) return false
  if (meal === 'OBED') return row.obed === true
  if (meal === 'VECERA') return row.vecera === true
  return false
}

function isActiveUser(row: any) {
  return row && String(row.aktivny || '').toUpperCase() === 'ANO'
}

function issueOf(item: any) {
  return Array.isArray(item?.hromadne_vydaje)
    ? item.hromadne_vydaje[0]
    : item?.hromadne_vydaje
}

function groupOf(issue: any) {
  return Array.isArray(issue?.groups)
    ? issue.groups[0]
    : issue?.groups
}

function registrationIssueOf(item: any) {
  return Array.isArray(item?.registration_group_issues)
    ? item.registration_group_issues[0]
    : item?.registration_group_issues
}

function registrationGroupOf(issue: any) {
  return Array.isArray(issue?.registration_groups)
    ? issue.registration_groups[0]
    : issue?.registration_groups
}

function isActiveIssue(issue: any, now: Date) {
  if (!issue) return false
  if (issue.status === 'READY') return true
  if (issue.status !== 'WAITING') return false
  if (!issue.valid_after) return true
  return new Date(issue.valid_after).getTime() <= now.getTime()
}

function choiceSummary(rows: any[]) {
  const counts = {
    MASO: 0,
    VEGE: 0,
    DIETA: 0,
    NEZADANE: 0
  }

  rows.forEach((row: any) => {
    const choice = normalizeChoice(row.volba) || 'NEZADANE'
    counts[choice] += 1
  })

  return counts
}

function formatChoiceSummary(summary: { MASO: number; VEGE: number; DIETA: number; NEZADANE?: number }) {
  return [
    summary.MASO ? `MASO ${summary.MASO}` : '',
    summary.VEGE ? `VEGE ${summary.VEGE}` : '',
    summary.DIETA ? `DIÉTA ${summary.DIETA}` : '',
    summary.NEZADANE ? `NEZADANÉ ${summary.NEZADANE}` : ''
  ].filter(Boolean).join(' · ')
}

function logFoodScanMetric(startedAt: number, metric: Record<string, string | number | boolean | null | undefined>) {
  if (process.env.FOOD_ISSUE_SCAN_METRICS !== 'true') return

  const entries = {
    ...metric,
    durationMs: Date.now() - startedAt
  }
  const text = Object.entries(entries as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ')

  console.log(`[food-scan] ${text}`)
}

function scanJson(
  startedAt: number,
  body: any,
  init: ResponseInit | undefined,
  metric: Record<string, string | number | boolean | null | undefined>
) {
  logFoodScanMetric(startedAt, {
    result: body?.status || body?.error || metric.result,
    httpStatus: init?.status || 200,
    ...metric
  })

  return NextResponse.json(body, init)
}

async function issuerAccess(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)

  return {
    global: globalAccess.canUseFoodIssue,
    groupIds: [] as string[],
    canUse: globalAccess.canUseFoodIssue
  }
}

async function findUserIdByQr(qrCode: string) {
  const [qrResult, userResult] = await Promise.all([
    supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', qrCode)
      .eq('active', true)
      .maybeSingle(),
    supabaseServer
      .from('users')
      .select('id')
      .eq('qr_code', qrCode)
      .maybeSingle()
  ])

  const { data: qrRow, error: qrError } = qrResult
  const { data: userRow, error: userError } = userResult

  if (qrError) throw new Error(qrError.message)
  if (qrRow?.user_id) return qrRow.user_id

  if (userError) throw new Error(userError.message)
  return userRow?.id || ''
}

function shouldFallbackAtomicRpc(error: any) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')

  return (
    code === 'PGRST202' ||
    code === '42883' ||
    message.includes('Could not find the function') ||
    message.includes('issue_bulk_meal_atomic') ||
    message.includes('issue_individual_meal_atomic')
  )
}

function atomicStateChangedMessage(error: any) {
  const message = String(error?.message || '')

  if (
    message.includes('PLANNED_ITEMS_CHANGED') ||
    message.includes('PLANNED_ITEMS_UPDATE_FAILED') ||
    message.includes('ISSUED_ROWS_MISMATCH')
  ) {
    return 'Príprava sa medzitým zmenila. Skontroluj stav a skús znova.'
  }

  return ''
}

async function issueBulkMealAtomicOrFallback({
  relatedIssue,
  datum,
  typJedla,
  actorId,
  targetUserId,
  qrCode,
  bulkRowsToIssue
}: {
  relatedIssue: any
  datum: string
  typJedla: string
  actorId: string
  targetUserId: string
  qrCode: string
  bulkRowsToIssue: any[]
}) {
  const atomicItems = bulkRowsToIssue.map((item: any) => ({
    planned_item_id: item.id,
    user_id: item.user_id,
    volba: normalizeChoice(item.volba) || null
  }))

  const atomicResult = await supabaseServer
    .rpc('issue_bulk_meal_atomic', {
      p_hromadny_vydaj_id: relatedIssue.id,
      p_group_id: relatedIssue.group_id,
      p_datum: datum,
      p_typ_jedla: typJedla,
      p_issued_by: actorId,
      p_qr_user_id: targetUserId,
      p_qr_code: qrCode,
      p_items: atomicItems
    })
    .single()

  if (!atomicResult.error) {
    const row: any = atomicResult.data || {}

    return {
      issuedBulkRows: [{
        id: row.first_issued_id || '',
        issued_at: row.first_issued_at || new Date().toISOString()
      }],
      issueBulkError: null,
      stateChangedMessage: ''
    }
  }

  const stateChangedMessage = atomicStateChangedMessage(atomicResult.error)

  if (stateChangedMessage) {
    return {
      issuedBulkRows: [],
      issueBulkError: null,
      stateChangedMessage
    }
  }

  if (!shouldFallbackAtomicRpc(atomicResult.error)) {
    return {
      issuedBulkRows: [],
      issueBulkError: atomicResult.error,
      stateChangedMessage: ''
    }
  }

  const bulkInsertRows = bulkRowsToIssue.map((item: any) => ({
    user_id: item.user_id,
    group_id: relatedIssue.group_id,
    hromadny_vydaj_id: relatedIssue.id,
    datum,
    typ_jedla: typJedla,
    volba: normalizeChoice(item.volba) || null,
    sposob: 'HROMADNE',
    status: 'VYDANE',
    issued_by: actorId,
    qr_code: item.user_id === targetUserId ? qrCode : null,
    source: 'QR',
    note: 'Hromadný výdaj cez QR oprávnenej osoby.'
  }))

  const { data: issuedBulkRows, error: issueBulkError } = await supabaseServer
    .from('vydaj_jedal')
    .insert(bulkInsertRows)
    .select('id, issued_at')

  if (issueBulkError) {
    return {
      issuedBulkRows: [],
      issueBulkError,
      stateChangedMessage: ''
    }
  }

  const { data: updatedBulkItems, error: updateBulkItemsError } = await supabaseServer
    .from('hromadny_vydaj_polozky')
    .update({
      status: 'BULK_ISSUED',
      updated_at: new Date().toISOString()
    })
    .eq('hromadny_vydaj_id', relatedIssue.id)
    .in('user_id', bulkRowsToIssue.map((item: any) => item.user_id))
    .eq('status', 'PLANNED')
    .select('id')

  if (updateBulkItemsError || (updatedBulkItems || []).length !== bulkRowsToIssue.length) {
    const insertedIds = (issuedBulkRows || []).map((row: any) => row.id).filter(Boolean)

    if (insertedIds.length > 0) {
      await supabaseServer
        .from('vydaj_jedal')
        .update({
          status: 'STORNOVANE',
          cancelled_by: actorId,
          cancelled_at: new Date().toISOString(),
          note: 'Výdaj bol automaticky stornovaný, lebo sa nepodarilo potvrdiť položky prípravy.'
        })
        .in('id', insertedIds)
        .eq('status', 'VYDANE')
    }

    return {
      issuedBulkRows: [],
      issueBulkError: null,
      stateChangedMessage: updateBulkItemsError?.message || 'Príprava sa medzitým zmenila. Skontroluj stav a skús znova.'
    }
  }

  return {
    issuedBulkRows: issuedBulkRows || [],
    issueBulkError: null,
    stateChangedMessage: ''
  }
}

async function issueIndividualMealAtomicOrFallback({
  targetUserId,
  groupId,
  relatedIssueId,
  plannedItemIds,
  datum,
  typJedla,
  choice,
  sposob,
  actorId,
  qrCode,
  note
}: {
  targetUserId: string
  groupId: string | null
  relatedIssueId: string | null
  plannedItemIds: string[]
  datum: string
  typJedla: string
  choice: string | null
  sposob: string
  actorId: string
  qrCode: string
  note: string
}) {
  const atomicResult = await supabaseServer
    .rpc('issue_individual_meal_atomic', {
      p_user_id: targetUserId,
      p_datum: datum,
      p_typ_jedla: typJedla,
      p_issued_by: actorId,
      p_group_id: groupId,
      p_hromadny_vydaj_id: relatedIssueId,
      p_planned_item_ids: plannedItemIds,
      p_volba: choice,
      p_sposob: sposob,
      p_qr_code: qrCode,
      p_source: 'QR',
      p_note: note
    })
    .single()

  if (!atomicResult.error) {
    const row: any = atomicResult.data || {}

    return {
      issued: {
        id: row.issued_id || '',
        issued_at: row.issued_at || new Date().toISOString()
      },
      issueError: null,
      stateChangedMessage: ''
    }
  }

  const stateChangedMessage = atomicStateChangedMessage(atomicResult.error)

  if (stateChangedMessage) {
    return {
      issued: null,
      issueError: null,
      stateChangedMessage
    }
  }

  if (!shouldFallbackAtomicRpc(atomicResult.error)) {
    return {
      issued: null,
      issueError: atomicResult.error,
      stateChangedMessage: ''
    }
  }

  const { data: issued, error: issueError } = await supabaseServer
    .from('vydaj_jedal')
    .insert({
      user_id: targetUserId,
      group_id: groupId,
      hromadny_vydaj_id: relatedIssueId,
      datum,
      typ_jedla: typJedla,
      volba: choice,
      sposob,
      status: 'VYDANE',
      issued_by: actorId,
      qr_code: qrCode,
      source: 'QR',
      note
    })
    .select('id, issued_at')
    .single()

  if (issueError) {
    return {
      issued: null,
      issueError,
      stateChangedMessage: ''
    }
  }

  if (plannedItemIds.length > 0) {
    const { data: updatedItems, error: updateItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .update({
        status: 'INDIVIDUAL_ISSUED',
        updated_at: new Date().toISOString()
      })
      .in('id', plannedItemIds)
      .eq('status', 'PLANNED')
      .select('id')

    if (updateItemsError || (updatedItems || []).length !== plannedItemIds.length) {
      await supabaseServer
        .from('vydaj_jedal')
        .update({
          status: 'STORNOVANE',
          cancelled_by: actorId,
          cancelled_at: new Date().toISOString(),
          note: 'Výdaj bol automaticky stornovaný, lebo sa nepodarilo potvrdiť položky prípravy.'
        })
        .eq('id', issued.id)
        .eq('status', 'VYDANE')

      return {
        issued: null,
        issueError: null,
        stateChangedMessage: updateItemsError?.message || 'Príprava sa medzitým zmenila. Skontroluj stav a skús znova.'
      }
    }
  }

  return {
    issued,
    issueError: null,
    stateChangedMessage: ''
  }
}

async function issueRegistrationGroupBulkMeal({
  relatedIssue,
  datum,
  typJedla,
  actorId,
  targetUserId,
  qrCode,
  bulkRowsToIssue
}: {
  relatedIssue: any
  datum: string
  typJedla: string
  actorId: string
  targetUserId: string
  qrCode: string
  bulkRowsToIssue: any[]
}) {
  const now = new Date().toISOString()
  const groupId = relatedIssue.registration_group_id || null

  const { data: issuedBulkRows, error: issueBulkError } = await supabaseServer
    .from('vydaj_jedal')
    .insert(bulkRowsToIssue.map((item: any) => ({
      user_id: item.user_id,
      group_id: null,
      registration_group_issue_id: relatedIssue.id,
      datum,
      typ_jedla: typJedla,
      volba: normalizeChoice(item.volba) || null,
      sposob: 'HROMADNE',
      status: 'VYDANE',
      issued_by: actorId,
      qr_code: item.user_id === targetUserId ? qrCode : null,
      source: 'QR',
      note: 'Skupinovy vydaj cez QR opravnenej osoby.'
    })))
    .select('id, issued_at')

  if (issueBulkError) {
    return {
      issuedBulkRows: [],
      issueBulkError,
      stateChangedMessage: ''
    }
  }

  const { data: updatedItems, error: updateItemsError } = await supabaseServer
    .from('registration_group_issue_items')
    .update({
      status: 'BULK_ISSUED',
      updated_at: now
    })
    .eq('issue_id', relatedIssue.id)
    .in('user_id', bulkRowsToIssue.map((item: any) => item.user_id))
    .eq('status', 'PLANNED')
    .select('id')

  if (updateItemsError || (updatedItems || []).length !== bulkRowsToIssue.length) {
    const insertedIds = (issuedBulkRows || []).map((row: any) => row.id).filter(Boolean)

    if (insertedIds.length > 0) {
      await supabaseServer
        .from('vydaj_jedal')
        .update({
          status: 'STORNOVANE',
          cancelled_by: actorId,
          cancelled_at: now,
          note: 'Vydaj bol automaticky stornovany, lebo sa nepodarilo potvrdit polozky skupinoveho vydaja.'
        })
        .in('id', insertedIds)
        .eq('status', 'VYDANE')
    }

    return {
      issuedBulkRows: [],
      issueBulkError: null,
      stateChangedMessage: updateItemsError?.message || 'Priprava sa medzitym zmenila. Skontroluj stav a skus znova.'
    }
  }

  return {
    issuedBulkRows: issuedBulkRows || [],
    issueBulkError: null,
    stateChangedMessage: '',
    groupId
  }
}

async function attachRegistrationGroupIssueToIndividualMeal({
  issuedId,
  issueId,
  itemIds,
  actorId
}: {
  issuedId: string
  issueId: string
  itemIds: string[]
  actorId: string
}) {
  if (!issuedId || !issueId || itemIds.length === 0) {
    return { ok: true, stateChangedMessage: '' }
  }

  const now = new Date().toISOString()

  const { error: issuedUpdateError } = await supabaseServer
    .from('vydaj_jedal')
    .update({ registration_group_issue_id: issueId })
    .eq('id', issuedId)
    .eq('status', 'VYDANE')

  if (issuedUpdateError) {
    return { ok: false, stateChangedMessage: issuedUpdateError.message }
  }

  const { data: updatedItems, error: updateItemsError } = await supabaseServer
    .from('registration_group_issue_items')
    .update({
      status: 'INDIVIDUAL_ISSUED',
      updated_at: now
    })
    .in('id', itemIds)
    .eq('status', 'PLANNED')
    .select('id')

  if (updateItemsError || (updatedItems || []).length !== itemIds.length) {
    await supabaseServer
      .from('vydaj_jedal')
      .update({
        status: 'STORNOVANE',
        cancelled_by: actorId,
        cancelled_at: now,
        note: 'Vydaj bol automaticky stornovany, lebo sa nepodarilo potvrdit polozky skupinoveho vydaja.'
      })
      .eq('id', issuedId)
      .eq('status', 'VYDANE')

    return {
      ok: false,
      stateChangedMessage: updateItemsError?.message || 'Priprava sa medzitym zmenila. Skontroluj stav a skus znova.'
    }
  }

  return { ok: true, stateChangedMessage: '' }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const qrCode = clean(body.qrCode)
    const datum = normalizeDate(body.datum)
    const typJedla = normalizeMeal(body.typJedla)
    const issueAction = clean(body.issueAction).toUpperCase()
    const bulkIssueId = clean(body.bulkIssueId)

    if (!qrCode || !datum || !typJedla) {
      return NextResponse.json(
        { error: 'Chýba QR kód, dátum alebo typ jedla.' },
        { status: 400 }
      )
    }

    if (issueAction && issueAction !== 'INDIVIDUAL' && issueAction !== 'BULK') {
      return NextResponse.json(
        { error: 'Neplatná voľba spôsobu výdaja.' },
        { status: 400 }
      )
    }

    if (issueAction === 'BULK' && !bulkIssueId) {
      return NextResponse.json(
        { error: 'Chýba vybraná hromadná príprava.' },
        { status: 400 }
      )
    }

    const access = await issuerAccess(actor.id)

    if (!access.canUse) {
      return NextResponse.json(
        { error: 'Nemáš oprávnenie vydávať stravu.' },
        { status: 403 }
      )
    }

    const targetUserId = await findUserIdByQr(qrCode)

    if (!targetUserId) {
      return scanJson(startedAt, {
        ok: false,
        status: 'UNKNOWN_QR',
        tone: 'error',
        message: 'QR kód nebol nájdený alebo nie je aktívny.'
      }, { status: 404 }, { mode: 'LOOKUP', result: 'UNKNOWN_QR' })
    }

    const selectedRegistrationIssueId = bulkIssueId.startsWith('registration:')
      ? bulkIssueId.replace(/^registration:/, '')
      : ''
    const needsLegacyPlannedItems = !issueAction || issueAction === 'INDIVIDUAL'
    const needsRegistrationPlannedItems = !issueAction || issueAction === 'INDIVIDUAL' || Boolean(selectedRegistrationIssueId)
    const needsRegistrationPickupIssues = !issueAction || Boolean(selectedRegistrationIssueId)
    const emptyRowsResult = Promise.resolve({ data: [], error: null })

    const [
      profileResult,
      targetMembershipsResult,
      alreadyIssuedResult,
      entitlementResult,
      selectionResult,
      plannedItemsResult,
      registrationPlannedItemsResult,
      registrationPickupIssuesResult
    ] = await Promise.all([
      supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny')
        .eq('id', targetUserId)
        .maybeSingle(),
      supabaseServer
        .from('group_members')
        .select(`
          group_id,
          role,
          groups (
            name
          )
        `)
        .eq('user_id', targetUserId),
      supabaseServer
        .from('vydaj_jedal')
        .select('id, sposob, issued_at, volba, group_id, hromadny_vydaj_id')
        .eq('user_id', targetUserId)
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .eq('status', 'VYDANE')
        .order('issued_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseServer
        .from('user_food_entitlements')
        .select('obed, vecera')
        .eq('user_id', targetUserId)
        .eq('datum', datum)
        .maybeSingle(),
      supabaseServer
        .from('vyber_jedal')
        .select('volba')
        .eq('user_id', targetUserId)
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .maybeSingle(),
      needsLegacyPlannedItems
        ? supabaseServer
          .from('hromadny_vydaj_polozky')
          .select(`
            id,
            hromadny_vydaj_id,
            user_id,
            status,
            volba,
            hromadne_vydaje (
              id,
              group_id,
              datum,
              typ_jedla,
              status,
              valid_after,
              groups (
                name
              )
            )
          `)
          .eq('user_id', targetUserId)
          .eq('status', 'PLANNED')
        : emptyRowsResult,
      needsRegistrationPlannedItems
        ? supabaseServer
          .from('registration_group_issue_items')
          .select(`
            id,
            issue_id,
            user_id,
            status,
            volba,
            registration_group_issues:registration_group_issues!registration_group_issue_items_issue_id_fkey (
              id,
              registration_group_id,
              title,
              datum,
              typ_jedla,
              status,
              valid_after,
              registration_groups (
                name
              )
            )
          `)
          .eq('user_id', targetUserId)
          .eq('status', 'PLANNED')
        : emptyRowsResult,
      needsRegistrationPickupIssues
        ? supabaseServer
          .from('registration_group_issue_pickup_users')
          .select(`
            issue_id,
            registration_group_issues (
              id,
              registration_group_id,
              title,
              datum,
              typ_jedla,
              status,
              valid_after,
              registration_groups (
                name
              )
            )
          `)
          .eq('user_id', targetUserId)
        : emptyRowsResult
    ])

    const { data: profile, error: profileError } = profileResult

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json({
        ok: false,
        status: 'UNKNOWN_USER',
        tone: 'error',
        message: 'Osoba k QR kódu sa nenašla.'
      }, { status: 404 })
    }

    const { data: targetMemberships, error: targetMembershipsError } = targetMembershipsResult

    if (targetMembershipsError) {
      return NextResponse.json({ error: targetMembershipsError.message }, { status: 500 })
    }

    const allowedTargetGroups = (targetMemberships || []).filter((membership: any) => {
      return access.global || access.groupIds.includes(membership.group_id)
    })

    if (!access.global && allowedTargetGroups.length === 0) {
      return NextResponse.json({
        ok: false,
        status: 'NO_ACCESS',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile),
          email: profile.email || ''
        },
        message: 'Táto osoba nepatrí do skupiny, pre ktorú môžeš vydávať stravu.'
      }, { status: 403 })
    }

    if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json({
        ok: false,
        status: 'BLOCKED',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: 'Blokovaný'
      }, { status: 403 })
    }

    const { data: alreadyIssued, error: alreadyIssuedError } = alreadyIssuedResult

    if (alreadyIssuedError) {
      return NextResponse.json({ error: alreadyIssuedError.message }, { status: 500 })
    }

    const { data: entitlement, error: entitlementError } = entitlementResult

    if (entitlementError) {
      return NextResponse.json({ error: entitlementError.message }, { status: 500 })
    }

    const { data: selection, error: selectionError } = selectionResult

    if (selectionError) {
      return NextResponse.json({ error: selectionError.message }, { status: 500 })
    }

    const choice = effectiveMealChoice(selection?.volba, profile.typ_stravy)

    const { data: plannedItems, error: plannedItemsError } = plannedItemsResult

    if (plannedItemsError) {
      return NextResponse.json({ error: plannedItemsError.message }, { status: 500 })
    }

    const { data: registrationPlannedItems, error: registrationPlannedItemsError } = registrationPlannedItemsResult

    if (registrationPlannedItemsError) {
      return NextResponse.json({ error: registrationPlannedItemsError.message }, { status: 500 })
    }

    const { data: registrationPickupIssues, error: registrationPickupIssuesError } = registrationPickupIssuesResult

    if (registrationPickupIssuesError) {
      return NextResponse.json({ error: registrationPickupIssuesError.message }, { status: 500 })
    }

    const matchingPlannedItems = (plannedItems || []).filter((item: any) => {
      const issue = issueOf(item)

      if (!issue) return false
      if (issue.datum !== datum || issue.typ_jedla !== typJedla) return false
      if (issue.status !== 'READY' && issue.status !== 'WAITING') return false
      if (!access.global && !access.groupIds.includes(issue.group_id)) return false

      return true
    })

    const matchingRegistrationPlannedItems = (registrationPlannedItems || []).filter((item: any) => {
      const issue = registrationIssueOf(item)

      if (!issue) return false
      if (issue.datum !== datum || issue.typ_jedla !== typJedla) return false
      if (issue.status !== 'READY' && issue.status !== 'WAITING') return false

      return true
    })

    const now = new Date()
    const authorizedGroupIds = Array.from(new Set(
      (targetMemberships || [])
        .filter((membership: any) => {
          return canIssueForGroupByRole(String(membership.role || '').toUpperCase(), { isAdmin: false })
        })
        .map((membership: any) => membership.group_id)
        .filter(Boolean)
    ))
    let bulkIssueOptions: any[] = []

    if (!issueAction && authorizedGroupIds.length > 0) {
      const { data: candidateIssues, error: candidateIssuesError } = await supabaseServer
        .from('hromadne_vydaje')
        .select(`
          id,
          group_id,
          datum,
          typ_jedla,
          status,
          valid_after,
          groups (
            name
          )
        `)
        .in('group_id', authorizedGroupIds)
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .in('status', ['READY', 'WAITING'])

      if (candidateIssuesError) {
        return NextResponse.json({ error: candidateIssuesError.message }, { status: 500 })
      }

      const activeCandidateIssues = (candidateIssues || []).filter((issue: any) => {
        return isActiveIssue(issue, now)
      })
      const activeCandidateIds = activeCandidateIssues.map((issue: any) => issue.id)

      if (activeCandidateIds.length > 0) {
        const { data: candidateItems, error: candidateItemsError } = await supabaseServer
          .from('hromadny_vydaj_polozky')
          .select('id, hromadny_vydaj_id, user_id, volba')
          .in('hromadny_vydaj_id', activeCandidateIds)
          .eq('status', 'PLANNED')

        if (candidateItemsError) {
          return NextResponse.json({ error: candidateItemsError.message }, { status: 500 })
        }

        const candidateUserIds = Array.from(new Set(
          (candidateItems || []).map((item: any) => item.user_id).filter(Boolean)
        ))
        if (candidateUserIds.length > 0) {
          const [
            candidateIssuedResult,
            candidateProfilesResult,
            candidateEntitlementsResult,
            candidateSelectionsResult
          ] = await Promise.all([
            supabaseServer
              .from('vydaj_jedal')
              .select('user_id')
              .eq('datum', datum)
              .eq('typ_jedla', typJedla)
              .eq('status', 'VYDANE')
              .in('user_id', candidateUserIds),
            supabaseServer
              .from('users')
              .select('id, aktivny, typ_stravy')
              .in('id', candidateUserIds),
            supabaseServer
              .from('user_food_entitlements')
              .select('user_id, obed, vecera')
              .eq('datum', datum)
              .in('user_id', candidateUserIds),
            supabaseServer
              .from('vyber_jedal')
              .select('user_id, volba')
              .eq('datum', datum)
              .eq('typ_jedla', typJedla)
              .in('user_id', candidateUserIds)
          ])

          if (candidateIssuedResult.error) {
            return NextResponse.json({ error: candidateIssuedResult.error.message }, { status: 500 })
          }

          if (candidateProfilesResult.error) {
            return NextResponse.json({ error: candidateProfilesResult.error.message }, { status: 500 })
          }

          if (candidateEntitlementsResult.error) {
            return NextResponse.json({ error: candidateEntitlementsResult.error.message }, { status: 500 })
          }

          if (candidateSelectionsResult.error) {
            return NextResponse.json({ error: candidateSelectionsResult.error.message }, { status: 500 })
          }

          const candidateIssuedIds = new Set(
            (candidateIssuedResult.data || []).map((row: any) => row.user_id)
          )
          const candidateProfileMap = new Map(
            (candidateProfilesResult.data || []).map((row: any) => [row.id, row])
          )
          const candidateEntitlementMap = new Map(
            (candidateEntitlementsResult.data || []).map((row: any) => [row.user_id, row])
          )
          const candidateSelectionMap = new Map(
            (candidateSelectionsResult.data || []).map((row: any) => [row.user_id, normalizeSelectionChoice(row.volba)])
          )
          const itemsByIssue = new Map<string, any[]>()

          for (const item of candidateItems || []) {
            const profileRow = candidateProfileMap.get(item.user_id)

            if (!isActiveUser(profileRow)) continue
            if (!entitlementOk(candidateEntitlementMap.get(item.user_id), typJedla)) continue
            if (candidateIssuedIds.has(item.user_id)) continue

            const itemChoice = candidateSelectionMap.get(item.user_id) || normalizeChoice(profileRow?.typ_stravy) || null

            if (itemChoice === 'BEZ_ZAUJMU') continue

            const items = itemsByIssue.get(item.hromadny_vydaj_id) || []
            items.push({
              ...item,
              volba: itemChoice
            })
            itemsByIssue.set(item.hromadny_vydaj_id, items)
          }

          bulkIssueOptions = activeCandidateIssues.flatMap((issue: any) => {
            const items = itemsByIssue.get(issue.id) || []
            if (items.length === 0) return []

            return [{
              kind: 'LEGACY',
              issue,
              id: issue.id,
              groupId: issue.group_id,
              groupName: groupOf(issue)?.name || '',
              count: items.length,
              summary: choiceSummary(items),
              includesScannedPerson: items.some((item: any) => item.user_id === targetUserId)
            }]
          })
        }
      }
    }

    if (!issueAction) {
      const registrationIssueMap = new Map<string, any>()

      ;(registrationPickupIssues || []).forEach((row: any) => {
        const issue = registrationIssueOf(row)
        if (!issue?.id) return
        registrationIssueMap.set(issue.id, issue)
      })
      matchingRegistrationPlannedItems.forEach((item: any) => {
        const issue = registrationIssueOf(item)
        if (!issue?.id) return
        registrationIssueMap.set(issue.id, issue)
      })

      const activeRegistrationIssues = Array.from(registrationIssueMap.values()).filter((issue: any) => {
        if (issue.datum !== datum || issue.typ_jedla !== typJedla) return false
        if (!isActiveIssue(issue, now)) return false
        return true
      })
      const activeRegistrationIssueIds = activeRegistrationIssues.map((issue: any) => issue.id)

      if (activeRegistrationIssueIds.length > 0) {
        const { data: candidateRegistrationItems, error: candidateRegistrationItemsError } = await supabaseServer
          .from('registration_group_issue_items')
          .select('id, issue_id, user_id, volba')
          .in('issue_id', activeRegistrationIssueIds)
          .eq('status', 'PLANNED')

        if (candidateRegistrationItemsError) {
          return NextResponse.json({ error: candidateRegistrationItemsError.message }, { status: 500 })
        }

        const candidateUserIds = Array.from(new Set(
          (candidateRegistrationItems || []).map((item: any) => item.user_id).filter(Boolean)
        ))

        if (candidateUserIds.length > 0) {
          const [
            candidateIssuedResult,
            candidateProfilesResult,
            candidateEntitlementsResult,
            candidateSelectionsResult
          ] = await Promise.all([
            supabaseServer
              .from('vydaj_jedal')
              .select('user_id')
              .eq('datum', datum)
              .eq('typ_jedla', typJedla)
              .eq('status', 'VYDANE')
              .in('user_id', candidateUserIds),
            supabaseServer
              .from('users')
              .select('id, aktivny, typ_stravy')
              .in('id', candidateUserIds),
            supabaseServer
              .from('user_food_entitlements')
              .select('user_id, obed, vecera')
              .eq('datum', datum)
              .in('user_id', candidateUserIds),
            supabaseServer
              .from('vyber_jedal')
              .select('user_id, volba')
              .eq('datum', datum)
              .eq('typ_jedla', typJedla)
              .in('user_id', candidateUserIds)
          ])

          if (candidateIssuedResult.error) {
            return NextResponse.json({ error: candidateIssuedResult.error.message }, { status: 500 })
          }

          if (candidateProfilesResult.error) {
            return NextResponse.json({ error: candidateProfilesResult.error.message }, { status: 500 })
          }

          if (candidateEntitlementsResult.error) {
            return NextResponse.json({ error: candidateEntitlementsResult.error.message }, { status: 500 })
          }

          if (candidateSelectionsResult.error) {
            return NextResponse.json({ error: candidateSelectionsResult.error.message }, { status: 500 })
          }

          const candidateIssuedIds = new Set(
            (candidateIssuedResult.data || []).map((row: any) => row.user_id)
          )
          const candidateProfileMap = new Map(
            (candidateProfilesResult.data || []).map((row: any) => [row.id, row])
          )
          const candidateEntitlementMap = new Map(
            (candidateEntitlementsResult.data || []).map((row: any) => [row.user_id, row])
          )
          const candidateSelectionMap = new Map(
            (candidateSelectionsResult.data || []).map((row: any) => [row.user_id, normalizeSelectionChoice(row.volba)])
          )
          const itemsByIssue = new Map<string, any[]>()

          for (const item of candidateRegistrationItems || []) {
            const profileRow = candidateProfileMap.get(item.user_id)

            if (!isActiveUser(profileRow)) continue
            if (!entitlementOk(candidateEntitlementMap.get(item.user_id), typJedla)) continue
            if (candidateIssuedIds.has(item.user_id)) continue

            const itemChoice = candidateSelectionMap.get(item.user_id) || normalizeChoice(profileRow?.typ_stravy) || null

            if (itemChoice === 'BEZ_ZAUJMU') continue

            const items = itemsByIssue.get(item.issue_id) || []
            items.push({
              ...item,
              volba: itemChoice
            })
            itemsByIssue.set(item.issue_id, items)
          }

          bulkIssueOptions = [
            ...bulkIssueOptions,
            ...activeRegistrationIssues.flatMap((issue: any) => {
              const items = itemsByIssue.get(issue.id) || []
              if (items.length === 0) return []

              return [{
                kind: 'REGISTRATION_GROUP',
                issue,
                id: `registration:${issue.id}`,
                groupId: issue.registration_group_id,
                groupName: issue.title || registrationGroupOf(issue)?.name || '',
                count: items.length,
                summary: choiceSummary(items),
                includesScannedPerson: items.some((item: any) => item.user_id === targetUserId)
              }]
            })
          ]
        }
      }
    }

    if (!issueAction && bulkIssueOptions.length > 0) {
      return scanJson(startedAt, {
        ok: false,
        status: 'ISSUE_DECISION_REQUIRED',
        tone: 'warning',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        choice: normalizeChoice(alreadyIssued?.volba) || choice,
        individual: {
          available: !alreadyIssued && entitlementOk(entitlement, typJedla) && choice !== 'BEZ_ZAUJMU',
          alreadyIssued: Boolean(alreadyIssued),
          hasEntitlement: entitlementOk(entitlement, typJedla)
        },
        bulkIssues: bulkIssueOptions.map(option => ({
          id: option.id,
          groupId: option.groupId,
          groupName: option.groupName,
          count: option.count,
          summary: option.summary,
          includesScannedPerson: option.includesScannedPerson
        })),
        message: 'Vyber spôsob výdaja.'
      }, undefined, {
        mode: 'MODAL',
        result: 'ISSUE_DECISION_REQUIRED',
        options: bulkIssueOptions.length
      })
    }

    let selectedBulkOption = issueAction === 'BULK'
      ? bulkIssueOptions.find(option => option.id === bulkIssueId) || null
      : null

    if (issueAction === 'BULK' && !selectedBulkOption && selectedRegistrationIssueId) {
      const selectedRegistrationIssue = [
        ...(registrationPickupIssues || []).map((row: any) => registrationIssueOf(row)),
        ...matchingRegistrationPlannedItems.map((item: any) => registrationIssueOf(item))
      ].find((issue: any) => {
        return issue?.id === selectedRegistrationIssueId &&
          issue.datum === datum &&
          issue.typ_jedla === typJedla &&
          isActiveIssue(issue, now)
      })

      if (selectedRegistrationIssue?.id) {
        selectedBulkOption = {
          kind: 'REGISTRATION_GROUP',
          issue: selectedRegistrationIssue,
          id: `registration:${selectedRegistrationIssue.id}`,
          groupId: selectedRegistrationIssue.registration_group_id,
          groupName: selectedRegistrationIssue.title || registrationGroupOf(selectedRegistrationIssue)?.name || '',
          count: 0,
          summary: { MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 },
          includesScannedPerson: matchingRegistrationPlannedItems.some((item: any) => item.issue_id === selectedRegistrationIssueId)
        }
      }
    }

    if (issueAction === 'BULK' && !selectedBulkOption && bulkIssueId && !bulkIssueId.startsWith('registration:')) {
      const { data: selectedLegacyIssue, error: selectedLegacyIssueError } = await supabaseServer
        .from('hromadne_vydaje')
        .select(`
          id,
          group_id,
          datum,
          typ_jedla,
          status,
          valid_after,
          groups (
            name
          )
        `)
        .eq('id', bulkIssueId)
        .maybeSingle()

      if (selectedLegacyIssueError) {
        return NextResponse.json({ error: selectedLegacyIssueError.message }, { status: 500 })
      }

      if (
        selectedLegacyIssue?.id &&
        selectedLegacyIssue.datum === datum &&
        selectedLegacyIssue.typ_jedla === typJedla &&
        isActiveIssue(selectedLegacyIssue, now) &&
        authorizedGroupIds.includes(selectedLegacyIssue.group_id)
      ) {
        selectedBulkOption = {
          kind: 'LEGACY',
          issue: selectedLegacyIssue,
          id: selectedLegacyIssue.id,
          groupId: selectedLegacyIssue.group_id,
          groupName: groupOf(selectedLegacyIssue)?.name || '',
          count: 0,
          summary: { MASO: 0, VEGE: 0, DIETA: 0, NEZADANE: 0 },
          includesScannedPerson: matchingPlannedItems.some((item: any) => item.hromadny_vydaj_id === selectedLegacyIssue.id)
        }
      }
    }

    if (issueAction === 'BULK' && !selectedBulkOption) {
      return scanJson(startedAt, {
        ok: false,
        status: 'BULK_NOT_AVAILABLE',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: 'Vybraná hromadná príprava už nie je dostupná.'
      }, { status: 409 }, { mode: 'BULK', result: 'BULK_NOT_AVAILABLE' })
    }

    if (!selectedBulkOption && alreadyIssued) {
      return scanJson(startedAt, {
        ok: false,
        status: 'ALREADY_ISSUED',
        tone: 'error',
        issuedId: alreadyIssued.id,
        issuedAt: alreadyIssued.issued_at,
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        choice: normalizeChoice(alreadyIssued.volba) || choice,
        message: 'Už vydané'
      }, { status: 409 }, { mode: 'INDIVIDUAL', result: 'ALREADY_ISSUED' })
    }

    if (!selectedBulkOption && choice === 'BEZ_ZAUJMU') {
      return scanJson(startedAt, {
        ok: false,
        status: 'NO_INTEREST',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: typJedla === 'OBED'
          ? 'Osoba sa odhlásila z obeda na tento deň.'
          : 'Osoba sa odhlásila z večere na tento deň.'
      }, { status: 403 }, { mode: 'INDIVIDUAL', result: 'NO_INTEREST' })
    }

    if (!selectedBulkOption && !entitlementOk(entitlement, typJedla)) {
      return scanJson(startedAt, {
        ok: false,
        status: 'NO_ENTITLEMENT',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: 'Bez nároku'
      }, { status: 403 }, { mode: 'INDIVIDUAL', result: 'NO_ENTITLEMENT' })
    }

    if (selectedBulkOption?.kind === 'REGISTRATION_GROUP') {
      const relatedIssue = selectedBulkOption.issue
      const relatedGroup = registrationGroupOf(relatedIssue)

      const { data: bulkItems, error: bulkItemsError } = await supabaseServer
        .from('registration_group_issue_items')
        .select('id, user_id, volba')
        .eq('issue_id', relatedIssue.id)
        .eq('status', 'PLANNED')

      if (bulkItemsError) {
        return NextResponse.json({ error: bulkItemsError.message }, { status: 500 })
      }

      const bulkUserIds = Array.from(
        new Set((bulkItems || []).map((item: any) => item.user_id).filter(Boolean))
      )

      if (bulkUserIds.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'EMPTY_BULK',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Skupinovy vydaj nema ziadne nevydane polozky.'
        }, { status: 409 }, { mode: 'REGISTRATION_GROUP_BULK', result: 'EMPTY_BULK' })
      }

      const [alreadyBulkIssuedResult, bulkProfilesResult, bulkEntitlementsResult, bulkSelectionsResult] = await Promise.all([
        supabaseServer
          .from('vydaj_jedal')
          .select('user_id')
          .eq('datum', datum)
          .eq('typ_jedla', typJedla)
          .eq('status', 'VYDANE')
          .in('user_id', bulkUserIds),
        supabaseServer
          .from('users')
          .select('id, aktivny, typ_stravy')
          .in('id', bulkUserIds),
        supabaseServer
          .from('user_food_entitlements')
          .select('user_id, obed, vecera')
          .eq('datum', datum)
          .in('user_id', bulkUserIds),
        supabaseServer
          .from('vyber_jedal')
          .select('user_id, volba')
          .eq('datum', datum)
          .eq('typ_jedla', typJedla)
          .in('user_id', bulkUserIds)
      ])

      if (alreadyBulkIssuedResult.error) {
        return NextResponse.json({ error: alreadyBulkIssuedResult.error.message }, { status: 500 })
      }

      if (bulkProfilesResult.error) {
        return NextResponse.json({ error: bulkProfilesResult.error.message }, { status: 500 })
      }

      if (bulkEntitlementsResult.error) {
        return NextResponse.json({ error: bulkEntitlementsResult.error.message }, { status: 500 })
      }

      if (bulkSelectionsResult.error) {
        return NextResponse.json({ error: bulkSelectionsResult.error.message }, { status: 500 })
      }

      const bulkProfileMap = new Map((bulkProfilesResult.data || []).map((row: any) => [row.id, row]))
      const bulkEntitlementMap = new Map((bulkEntitlementsResult.data || []).map((row: any) => [row.user_id, row]))
      const bulkSelectionMap = new Map((bulkSelectionsResult.data || []).map((row: any) => [row.user_id, normalizeSelectionChoice(row.volba)]))
      const invalidBulkItems: Array<{ id: string; reason: string }> = []
      const eligibleBulkItems = (bulkItems || []).flatMap((item: any) => {
        const profileRow = bulkProfileMap.get(item.user_id)

        if (!isActiveUser(profileRow)) {
          invalidBulkItems.push({ id: item.id, reason: 'USER_BLOCKED' })
          return []
        }

        if (!entitlementOk(bulkEntitlementMap.get(item.user_id), typJedla)) {
          invalidBulkItems.push({ id: item.id, reason: 'MANUAL' })
          return []
        }

        const itemChoice = bulkSelectionMap.get(item.user_id) || normalizeChoice(profileRow?.typ_stravy) || null

        if (itemChoice === 'BEZ_ZAUJMU') {
          invalidBulkItems.push({ id: item.id, reason: 'NO_INTEREST' })
          return []
        }

        return [{
          ...item,
          volba: itemChoice
        }]
      })

      if (invalidBulkItems.length > 0) {
        const invalidUpdateTime = new Date().toISOString()

        for (const reason of ['USER_BLOCKED', 'MANUAL', 'NO_INTEREST']) {
          const ids = invalidBulkItems
            .filter(item => item.reason === reason)
            .map(item => item.id)

          if (ids.length === 0) continue

          const { error: invalidUpdateError } = await supabaseServer
            .from('registration_group_issue_items')
            .update({
              status: 'REMOVED',
              remove_reason: reason,
              removed_at: invalidUpdateTime,
              removed_by: actor.id,
              updated_at: invalidUpdateTime
            })
            .in('id', ids)
            .eq('status', 'PLANNED')

          if (invalidUpdateError) {
            return NextResponse.json({ error: invalidUpdateError.message }, { status: 500 })
          }
        }
      }

      if (eligibleBulkItems.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'EMPTY_BULK',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Skupinovy vydaj nema ziadne vydatelne polozky.'
        }, { status: 409 }, {
          mode: 'REGISTRATION_GROUP_BULK',
          result: 'EMPTY_BULK',
          skippedCount: invalidBulkItems.length
        })
      }

      const alreadyBulkIssuedIds = new Set((alreadyBulkIssuedResult.data || []).map((row: any) => row.user_id))
      const bulkRowsToIssue = eligibleBulkItems.filter((item: any) => !alreadyBulkIssuedIds.has(item.user_id))

      if (bulkRowsToIssue.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'ALREADY_ISSUED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Uz vydane'
        }, { status: 409 }, {
          mode: 'REGISTRATION_GROUP_BULK',
          result: 'ALREADY_ISSUED',
          totalCount: bulkItems?.length || 0
        })
      }

      const { issuedBulkRows, issueBulkError, stateChangedMessage } = await issueRegistrationGroupBulkMeal({
        relatedIssue,
        datum,
        typJedla,
        actorId: actor.id,
        targetUserId,
        qrCode,
        bulkRowsToIssue
      })

      if (issueBulkError) {
        if (issueBulkError.code === '23505') {
          return scanJson(startedAt, {
            ok: false,
            status: 'ALREADY_ISSUED',
            tone: 'error',
            person: {
              id: profile.id,
              fullName: fullName(profile) || profile.email || '',
              email: profile.email || ''
            },
            message: 'Niektore jedlo uz bolo vydane. Obnov stranku a skontroluj stav.'
          }, { status: 409 }, { mode: 'REGISTRATION_GROUP_BULK', result: 'ALREADY_ISSUED' })
        }

        return NextResponse.json({ error: issueBulkError.message }, { status: 500 })
      }

      if (stateChangedMessage) {
        return scanJson(startedAt, {
          ok: false,
          status: 'BULK_STATE_CHANGED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: stateChangedMessage
        }, { status: 409 }, { mode: 'REGISTRATION_GROUP_BULK', result: 'BULK_STATE_CHANGED' })
      }

      const firstIssuedRow = issuedBulkRows?.[0]
      const summary = choiceSummary(bulkRowsToIssue)
      const summaryText = formatChoiceSummary(summary)

      return scanJson(startedAt, {
        ok: true,
        status: 'ISSUED',
        tone: 'success',
        issuedId: firstIssuedRow?.id || '',
        issuedAt: firstIssuedRow?.issued_at || new Date().toISOString(),
        issuedCount: bulkRowsToIssue.length,
        totalCount: bulkItems?.length || bulkRowsToIssue.length,
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || '',
          phone: profile.telefon || ''
        },
        choice,
        bulkSummary: summary,
        method: 'HROMADNE',
        groupName: relatedIssue.title || relatedGroup?.name || '',
        message: summaryText
          ? `Vydane hromadne: ${summaryText}${invalidBulkItems.length ? ` · preskocene ${invalidBulkItems.length}` : ''}`
          : `Vydane hromadne (${bulkRowsToIssue.length})`
      }, undefined, {
        mode: 'REGISTRATION_GROUP_BULK',
        result: 'ISSUED',
        issuedCount: bulkRowsToIssue.length,
        totalCount: bulkItems?.length || bulkRowsToIssue.length,
        skippedCount: invalidBulkItems.length
      })
    }

    const relatedPlannedItem = matchingPlannedItems[0] || null
    const relatedRegistrationPlannedItem = matchingRegistrationPlannedItems[0] || null
    const relatedRegistrationIssue = registrationIssueOf(relatedRegistrationPlannedItem)
    const relatedIssue = selectedBulkOption?.issue || issueOf(relatedPlannedItem)
    const relatedGroup = groupOf(relatedIssue)
    const relatedRegistrationGroup = registrationGroupOf(relatedRegistrationIssue)
    const fallbackGroupId =
      relatedIssue?.group_id ||
      allowedTargetGroups[0]?.group_id ||
      null

    const sposob = selectedBulkOption ? 'HROMADNE' : 'INDIVIDUALNE'

    if (selectedBulkOption && relatedIssue?.id) {
      const { data: bulkItems, error: bulkItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .select('id, user_id, volba')
        .eq('hromadny_vydaj_id', relatedIssue.id)
        .eq('status', 'PLANNED')

      if (bulkItemsError) {
        return NextResponse.json({ error: bulkItemsError.message }, { status: 500 })
      }

      const bulkUserIds = Array.from(
        new Set((bulkItems || []).map((item: any) => item.user_id).filter(Boolean))
      )

      if (bulkUserIds.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'EMPTY_BULK',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Hromadná príprava nemá žiadne nevydané položky.'
        }, { status: 409 }, { mode: 'LEGACY_BULK', result: 'EMPTY_BULK' })
      }

      const [alreadyBulkIssuedResult, bulkProfilesResult, bulkEntitlementsResult, bulkSelectionsResult] = await Promise.all([
        supabaseServer
          .from('vydaj_jedal')
          .select('user_id')
          .eq('datum', datum)
          .eq('typ_jedla', typJedla)
          .eq('status', 'VYDANE')
          .in('user_id', bulkUserIds),
        supabaseServer
          .from('users')
          .select('id, aktivny, typ_stravy')
          .in('id', bulkUserIds),
        supabaseServer
          .from('user_food_entitlements')
          .select('user_id, obed, vecera')
          .eq('datum', datum)
          .in('user_id', bulkUserIds),
        supabaseServer
          .from('vyber_jedal')
          .select('user_id, volba')
          .eq('datum', datum)
          .eq('typ_jedla', typJedla)
          .in('user_id', bulkUserIds)
      ])

      if (alreadyBulkIssuedResult.error) {
        return NextResponse.json({ error: alreadyBulkIssuedResult.error.message }, { status: 500 })
      }

      if (bulkProfilesResult.error) {
        return NextResponse.json({ error: bulkProfilesResult.error.message }, { status: 500 })
      }

      if (bulkEntitlementsResult.error) {
        return NextResponse.json({ error: bulkEntitlementsResult.error.message }, { status: 500 })
      }

      if (bulkSelectionsResult.error) {
        return NextResponse.json({ error: bulkSelectionsResult.error.message }, { status: 500 })
      }

      const bulkProfileMap = new Map((bulkProfilesResult.data || []).map((row: any) => [row.id, row]))
      const bulkEntitlementMap = new Map((bulkEntitlementsResult.data || []).map((row: any) => [row.user_id, row]))
      const bulkSelectionMap = new Map((bulkSelectionsResult.data || []).map((row: any) => [row.user_id, normalizeSelectionChoice(row.volba)]))
      const invalidBulkItems: Array<{ id: string; reason: string }> = []
      const eligibleBulkItems = (bulkItems || []).flatMap((item: any) => {
        const profileRow = bulkProfileMap.get(item.user_id)

        if (!isActiveUser(profileRow)) {
          invalidBulkItems.push({ id: item.id, reason: 'USER_BLOCKED' })
          return []
        }

        if (!entitlementOk(bulkEntitlementMap.get(item.user_id), typJedla)) {
          invalidBulkItems.push({ id: item.id, reason: 'MANUAL' })
          return []
        }

        const itemChoice = bulkSelectionMap.get(item.user_id) || normalizeChoice(profileRow?.typ_stravy) || null

        if (itemChoice === 'BEZ_ZAUJMU') {
          invalidBulkItems.push({ id: item.id, reason: 'NO_INTEREST' })
          return []
        }

        return [{
          ...item,
          volba: itemChoice
        }]
      })

      if (invalidBulkItems.length > 0) {
        const invalidBlockedIds = invalidBulkItems
          .filter(item => item.reason === 'USER_BLOCKED')
          .map(item => item.id)
        const invalidNoEntitlementIds = invalidBulkItems
          .filter(item => item.reason !== 'USER_BLOCKED')
          .map(item => item.id)
        const invalidUpdateTime = new Date().toISOString()

        if (invalidBlockedIds.length > 0) {
          const { error: invalidBlockedError } = await supabaseServer
            .from('hromadny_vydaj_polozky')
            .update({
              status: 'REMOVED',
              remove_reason: 'USER_BLOCKED',
              removed_at: invalidUpdateTime,
              removed_by: actor.id,
              updated_at: invalidUpdateTime
            })
            .in('id', invalidBlockedIds)
            .eq('status', 'PLANNED')

          if (invalidBlockedError) {
            return NextResponse.json({ error: invalidBlockedError.message }, { status: 500 })
          }
        }

        if (invalidNoEntitlementIds.length > 0) {
          const { error: invalidEntitlementError } = await supabaseServer
            .from('hromadny_vydaj_polozky')
            .update({
              status: 'REMOVED',
              remove_reason: 'MANUAL',
              removed_at: invalidUpdateTime,
              removed_by: actor.id,
              updated_at: invalidUpdateTime
            })
            .in('id', invalidNoEntitlementIds)
            .eq('status', 'PLANNED')

          if (invalidEntitlementError) {
            return NextResponse.json({ error: invalidEntitlementError.message }, { status: 500 })
          }
        }
      }

      if (eligibleBulkItems.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'EMPTY_BULK',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Hromadná príprava nemá žiadne vydateľné položky.'
        }, { status: 409 }, {
          mode: 'LEGACY_BULK',
          result: 'EMPTY_BULK',
          skippedCount: invalidBulkItems.length
        })
      }

      const alreadyBulkIssuedIds = new Set((alreadyBulkIssuedResult.data || []).map((row: any) => row.user_id))
      const bulkRowsToIssue = eligibleBulkItems.filter((item: any) => !alreadyBulkIssuedIds.has(item.user_id))

      if (bulkRowsToIssue.length === 0) {
        return scanJson(startedAt, {
          ok: false,
          status: 'ALREADY_ISSUED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Už vydané'
        }, { status: 409 }, {
          mode: 'LEGACY_BULK',
          result: 'ALREADY_ISSUED',
          totalCount: bulkItems?.length || 0
        })
      }

      const { issuedBulkRows, issueBulkError, stateChangedMessage } = await issueBulkMealAtomicOrFallback({
        relatedIssue,
        datum,
        typJedla,
        actorId: actor.id,
        targetUserId,
        qrCode,
        bulkRowsToIssue
      })

      if (issueBulkError) {
        if (issueBulkError.code === '23505') {
          return scanJson(startedAt, {
            ok: false,
            status: 'ALREADY_ISSUED',
            tone: 'error',
            person: {
              id: profile.id,
              fullName: fullName(profile) || profile.email || '',
              email: profile.email || ''
            },
            message: 'Niektoré jedlo už bolo vydané. Obnov stránku a skontroluj stav.'
          }, { status: 409 }, { mode: 'LEGACY_BULK', result: 'ALREADY_ISSUED' })
        }

        return NextResponse.json({ error: issueBulkError.message }, { status: 500 })
      }

      if (stateChangedMessage) {
        return scanJson(startedAt, {
          ok: false,
          status: 'BULK_STATE_CHANGED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: stateChangedMessage
        }, { status: 409 }, { mode: 'LEGACY_BULK', result: 'BULK_STATE_CHANGED' })
      }

      const firstIssuedRow = issuedBulkRows?.[0]
      const summary = choiceSummary(bulkRowsToIssue)
      const summaryText = formatChoiceSummary(summary)

      return scanJson(startedAt, {
        ok: true,
        status: 'ISSUED',
        tone: 'success',
        issuedId: firstIssuedRow?.id || '',
        issuedAt: firstIssuedRow?.issued_at || new Date().toISOString(),
        issuedCount: bulkRowsToIssue.length,
        totalCount: bulkItems?.length || bulkRowsToIssue.length,
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || '',
          phone: profile.telefon || ''
        },
        choice,
        bulkSummary: summary,
        method: 'HROMADNE',
        groupName: relatedGroup?.name || '',
        message: summaryText
          ? `Vydané hromadne: ${summaryText}${invalidBulkItems.length ? ` · preskočené ${invalidBulkItems.length}` : ''}`
          : `Vydané hromadne (${bulkRowsToIssue.length})`
      }, undefined, {
        mode: 'LEGACY_BULK',
        result: 'ISSUED',
        issuedCount: bulkRowsToIssue.length,
        totalCount: bulkItems?.length || bulkRowsToIssue.length,
        skippedCount: invalidBulkItems.length
      })
    }

    const individualNote = relatedPlannedItem
      ? 'Individuálny výdaj cez QR z hromadnej prípravy.'
      : 'Individuálny výdaj cez QR.'
    const plannedItemIds = matchingPlannedItems.map((item: any) => item.id)
    const registrationPlannedItemIds = matchingRegistrationPlannedItems.map((item: any) => item.id)
    const { issued, issueError, stateChangedMessage } = await issueIndividualMealAtomicOrFallback({
      targetUserId,
      groupId: fallbackGroupId,
      relatedIssueId: relatedIssue?.id || null,
      plannedItemIds,
      datum,
      typJedla,
      choice,
      sposob,
      actorId: actor.id,
      qrCode,
      note: individualNote
    })

    if (issueError) {
      if (issueError.code === '23505') {
        return scanJson(startedAt, {
          ok: false,
          status: 'ALREADY_ISSUED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          choice,
          message: 'Už vydané'
        }, { status: 409 }, { mode: 'INDIVIDUAL', result: 'ALREADY_ISSUED' })
      }

      return NextResponse.json({ error: issueError.message }, { status: 500 })
    }

    if (stateChangedMessage || !issued) {
      return scanJson(startedAt, {
        ok: false,
        status: 'ISSUE_STATE_CHANGED',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: stateChangedMessage || 'Výdaj sa nepodarilo uložiť. Skontroluj stav a skús znova.'
      }, { status: 409 }, { mode: 'INDIVIDUAL', result: 'ISSUE_STATE_CHANGED' })
    }

    if (relatedRegistrationIssue?.id && registrationPlannedItemIds.length > 0) {
      const attachResult = await attachRegistrationGroupIssueToIndividualMeal({
        issuedId: issued.id,
        issueId: relatedRegistrationIssue.id,
        itemIds: registrationPlannedItemIds,
        actorId: actor.id
      })

      if (!attachResult.ok) {
        return scanJson(startedAt, {
          ok: false,
          status: 'ISSUE_STATE_CHANGED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: attachResult.stateChangedMessage || 'Priprava sa medzitym zmenila. Skontroluj stav a skus znova.'
        }, { status: 409 }, { mode: 'REGISTRATION_GROUP_INDIVIDUAL', result: 'ISSUE_STATE_CHANGED' })
      }
    }

    return scanJson(startedAt, {
      ok: true,
      status: 'ISSUED',
      tone: 'success',
      issuedId: issued.id,
      issuedAt: issued.issued_at,
      person: {
        id: profile.id,
        fullName: fullName(profile) || profile.email || '',
        email: profile.email || '',
        phone: profile.telefon || ''
      },
      choice,
      method: sposob,
      groupName: relatedGroup?.name || relatedRegistrationIssue?.title || relatedRegistrationGroup?.name || '',
      message: relatedPlannedItem ? 'Vydané individuálne' : 'Vydané'
    }, undefined, {
      mode: relatedRegistrationIssue?.id
        ? 'REGISTRATION_GROUP_INDIVIDUAL'
        : relatedIssue?.id
          ? 'LEGACY_INDIVIDUAL'
          : 'INDIVIDUAL',
      result: 'ISSUED',
      issuedCount: 1
    })
  } catch (err: any) {
    return scanJson(
      startedAt,
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 },
      { mode: 'ERROR', result: 'UNHANDLED_ERROR' }
    )
  }
}
