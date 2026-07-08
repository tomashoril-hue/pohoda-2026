import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess, type GlobalAccess } from '@/lib/globalRoles'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import {
  cleanText,
  entitlementOk,
  normalizeChoice,
  normalizeDate,
  normalizeMeal,
  normalizeSelectionChoice,
  type FoodChoice,
  type MealType
} from '@/lib/registrationGroupIssue'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

type OfflineSyncEvent = {
  offlineEventId: string
  deviceId: string
  snapshotId: string
  operation: 'ISSUE' | 'CANCEL_ISSUE'
  issueAction?: 'INDIVIDUAL' | 'REGISTRATION_GROUP_BULK'
  qrCode: string
  entitlementId: string
  personId: string
  registrationGroupIssueId?: string
  issuedPersonIds?: string[]
  issuedCount?: number
  choiceSummary?: { MASO?: number; VEGE?: number; DIETA?: number }
  mealDate: string
  mealType: 'OBED' | 'VECERA'
  issueLocation?: string
  createdAt: string
  preparedByUserId: string
  targetOfflineEventId?: string
}

type EventResult = {
  offlineEventId: string
  resultStatus: 'SYNCED' | 'CONFLICT' | 'FAILED_RETRY' | 'IGNORED_DUPLICATE'
  conflictType?: string
  message?: string
  createdIssueIds?: string[]
}

function uniqueClean(values: any[]) {
  return Array.from(new Set(values.map(value => cleanText(value)).filter(Boolean)))
}

function choiceFromSummary(summary: OfflineSyncEvent['choiceSummary']): FoodChoice | null {
  const choices: FoodChoice[] = ['MASO', 'VEGE', 'DIETA']
  return choices.find(choice => Number(summary?.[choice] || 0) > 0) || null
}

function normalizeEvent(raw: any): OfflineSyncEvent | null {
  const operation = cleanText(raw?.operation).toUpperCase()
  const issueAction = cleanText(raw?.issueAction).toUpperCase()
  const mealType = normalizeMeal(raw?.mealType)
  const mealDate = normalizeDate(raw?.mealDate)
  const offlineEventId = cleanText(raw?.offlineEventId)
  const personId = cleanText(raw?.personId)

  if (!offlineEventId || !mealDate || !mealType) return null
  if (operation !== 'ISSUE' && operation !== 'CANCEL_ISSUE') return null

  return {
    offlineEventId,
    deviceId: cleanText(raw?.deviceId).slice(0, 160),
    snapshotId: cleanText(raw?.snapshotId).slice(0, 160),
    operation,
    issueAction: issueAction === 'REGISTRATION_GROUP_BULK' ? 'REGISTRATION_GROUP_BULK' : 'INDIVIDUAL',
    qrCode: cleanText(raw?.qrCode),
    entitlementId: cleanText(raw?.entitlementId),
    personId,
    registrationGroupIssueId: cleanText(raw?.registrationGroupIssueId) || undefined,
    issuedPersonIds: uniqueClean(Array.isArray(raw?.issuedPersonIds) ? raw.issuedPersonIds : []),
    issuedCount: Number(raw?.issuedCount || 0),
    choiceSummary: raw?.choiceSummary || {},
    mealDate,
    mealType,
    issueLocation: cleanText(raw?.issueLocation).slice(0, 160),
    createdAt: cleanText(raw?.createdAt) || new Date().toISOString(),
    preparedByUserId: cleanText(raw?.preparedByUserId),
    targetOfflineEventId: cleanText(raw?.targetOfflineEventId) || undefined
  }
}

async function existingResult(eventId: string): Promise<EventResult | null> {
  const { data, error } = await supabaseServer
    .from('offline_issue_events_server')
    .select('offline_event_id, result_status, conflict_type, conflict_payload, created_issue_ids')
    .eq('offline_event_id', eventId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    offlineEventId: data.offline_event_id,
    resultStatus: data.result_status === 'SYNCED' ? 'IGNORED_DUPLICATE' : data.result_status,
    conflictType: data.conflict_type || undefined,
    message: data.conflict_payload?.message || 'Udalosť už bola spracovaná.',
    createdIssueIds: data.created_issue_ids || []
  }
}

async function storeEventResult({
  event,
  actorId,
  result,
  conflictPayload,
  createdIssueIds = []
}: {
  event: OfflineSyncEvent
  actorId: string
  result: EventResult
  conflictPayload?: any
  createdIssueIds?: string[]
}) {
  const { error } = await supabaseServer
    .from('offline_issue_events_server')
    .insert({
      offline_event_id: event.offlineEventId,
      device_id: event.deviceId,
      snapshot_id: event.snapshotId,
      operation: event.operation,
      issue_action: event.issueAction || null,
      qr_code: event.qrCode || null,
      entitlement_id: event.entitlementId || null,
      person_id: event.personId || null,
      registration_group_issue_id: event.registrationGroupIssueId || null,
      issued_person_ids: event.issuedPersonIds || [],
      issued_count: event.issuedCount || 0,
      choice_summary: event.choiceSummary || {},
      meal_date: event.mealDate,
      meal_type: event.mealType,
      issue_location: event.issueLocation || null,
      created_at_offline: event.createdAt,
      prepared_by_user_id: event.preparedByUserId || null,
      synced_by: actorId,
      result_status: result.resultStatus === 'IGNORED_DUPLICATE' ? 'SYNCED' : result.resultStatus,
      conflict_type: result.conflictType || null,
      conflict_payload: conflictPayload || { message: result.message || '' },
      created_issue_ids: createdIssueIds,
      target_offline_event_id: event.targetOfflineEventId || null
    })

  if (error && error.code !== '23505') throw error
}

async function storeConflict(event: OfflineSyncEvent, result: EventResult) {
  const { error } = await supabaseServer
    .from('offline_sync_conflicts')
    .insert({
      offline_event_id: event.offlineEventId,
      device_id: event.deviceId,
      snapshot_id: event.snapshotId,
      qr_code: event.qrCode || null,
      person_id: event.personId || null,
      meal_date: event.mealDate,
      meal_type: event.mealType,
      issue_location: event.issueLocation || null,
      conflict_type: result.conflictType || 'CONFLICT',
      conflict_payload: {
        message: result.message || '',
        event
      }
    })

  if (error) throw error
}

async function conflict(event: OfflineSyncEvent, actorId: string, conflictType: string, message: string): Promise<EventResult> {
  const result: EventResult = {
    offlineEventId: event.offlineEventId,
    resultStatus: 'CONFLICT',
    conflictType,
    message
  }

  await storeEventResult({
    event,
    actorId,
    result,
    conflictPayload: { message, event }
  })
  await storeConflict(event, result)

  return result
}

async function loadActiveIssuedRows(userIds: string[], date: string, meal: MealType) {
  if (userIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('vydaj_jedal')
    .select('id, user_id, status, registration_group_issue_id')
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .eq('status', 'VYDANE')
    .in('user_id', userIds)

  if (error) throw error
  return data || []
}

async function assertIndividualEntitlement(event: OfflineSyncEvent, meal: MealType) {
  const [{ data: user, error: userError }, { data: entitlement, error: entitlementError }, { data: selection, error: selectionError }] = await Promise.all([
    supabaseServer
      .from('users')
      .select('id, aktivny, typ_stravy')
      .eq('id', event.personId)
      .maybeSingle(),
    supabaseServer
      .from('user_food_entitlements')
      .select('user_id, obed, vecera')
      .eq('user_id', event.personId)
      .eq('datum', event.mealDate)
      .maybeSingle(),
    supabaseServer
      .from('vyber_jedal')
      .select('user_id, volba')
      .eq('user_id', event.personId)
      .eq('datum', event.mealDate)
      .eq('typ_jedla', meal)
      .maybeSingle()
  ])

  if (userError) throw userError
  if (entitlementError) throw entitlementError
  if (selectionError) throw selectionError

  if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
    return { ok: false, conflictType: 'CONFLICT_INVALID_ENTITLEMENT', message: 'Osoba už nie je aktívna.', choice: null }
  }

  if (!entitlementOk(entitlement, meal)) {
    return { ok: false, conflictType: 'CONFLICT_INVALID_ENTITLEMENT', message: 'Nárok už neplatí pre tento výdaj.', choice: null }
  }

  if (normalizeSelectionChoice(selection?.volba) === 'BEZ_ZAUJMU') {
    return { ok: false, conflictType: 'CONFLICT_INVALID_ENTITLEMENT', message: 'Osoba sa medzičasom odhlásila zo stravy.', choice: null }
  }

  return {
    ok: true,
    conflictType: '',
    message: '',
    choice: choiceFromSummary(event.choiceSummary) || normalizeChoice(selection?.volba) || normalizeChoice(user.typ_stravy)
  }
}

async function issueGroupRequiresProductionVillageDinner(issueId: string) {
  if (!issueId) return false

  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select(`
      id,
      registration_groups (
        production_village_dinner
      )
    `)
    .eq('id', issueId)
    .maybeSingle()

  if (error) throw error
  const group = Array.isArray(data?.registration_groups)
    ? data?.registration_groups[0]
    : data?.registration_groups

  return Boolean(group?.production_village_dinner)
}

async function userRequiresProductionVillageDinner(userId: string, date: string) {
  if (!userId) return false

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, registration_group_id')
    .eq('id', userId)
    .maybeSingle()

  if (userError) throw userError

  const [{ data: period, error: periodError }, fallbackResult] = await Promise.all([
    supabaseServer
      .from('user_registration_group_periods')
      .select(`
        registration_group_id,
        registration_groups (
          production_village_dinner
        )
      `)
      .eq('user_id', userId)
      .lte('valid_from', date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
      .order('valid_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    user?.registration_group_id
      ? supabaseServer
        .from('registration_groups')
        .select('id, production_village_dinner')
        .eq('id', user.registration_group_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ])

  if (periodError) throw periodError
  if (fallbackResult.error) throw fallbackResult.error

  const periodGroup = Array.isArray(period?.registration_groups)
    ? period?.registration_groups[0]
    : period?.registration_groups
  const group = periodGroup || fallbackResult.data

  return Boolean(group?.production_village_dinner)
}

async function processIssue(event: OfflineSyncEvent, actorId: string, access: GlobalAccess): Promise<EventResult> {
  const meal = normalizeMeal(event.mealType)
  if (!meal || !event.personId) {
    return conflict(event, actorId, 'CONFLICT_INVALID_EVENT', 'Offline udalosť nemá povinné údaje.')
  }

  const issuedPersonIds = event.issueAction === 'REGISTRATION_GROUP_BULK'
    ? uniqueClean(event.issuedPersonIds || [])
    : [event.personId]

  if (meal === 'VECERA' && !access.isProductionVillageDinnerIssue) {
    const productionVillageDinnerRequired = event.registrationGroupIssueId
      ? await issueGroupRequiresProductionVillageDinner(event.registrationGroupIssueId)
      : await userRequiresProductionVillageDinner(event.personId, event.mealDate)

    if (productionVillageDinnerRequired) {
      return conflict(
        event,
        actorId,
        'CONFLICT_PRODUCTION_VILLAGE_DEVICE_REQUIRED',
        'Tato vecera sa vydava v Production Village. Synchronizovat ju moze iba zariadenie s opravnenim PRODUCTION_VILLAGE_VECER.'
      )
    }
  }

  if (meal === 'VECERA' && access.isProductionVillageDinnerIssue) {
    const productionVillageDinnerRequired = event.registrationGroupIssueId
      ? await issueGroupRequiresProductionVillageDinner(event.registrationGroupIssueId)
      : await userRequiresProductionVillageDinner(event.personId, event.mealDate)

    if (!productionVillageDinnerRequired) {
      return conflict(
        event,
        actorId,
        'CONFLICT_CLASSIC_DINNER_DEVICE_REQUIRED',
        'Toto je klasicka vecera. Synchronizovat ju moze iba zariadenie pre bezny vydaj vecere.'
      )
    }
  }

  const activeIssuedRows = await loadActiveIssuedRows(issuedPersonIds, event.mealDate, meal)
  if (activeIssuedRows.length > 0) {
    return conflict(event, actorId, 'CONFLICT_DUPLICATE_ISSUE', 'Niektorá osoba už má jedlo vydané na serveri.')
  }

  if (event.issueAction === 'REGISTRATION_GROUP_BULK') {
    if (!event.registrationGroupIssueId || issuedPersonIds.length === 0) {
      return conflict(event, actorId, 'CONFLICT_INVALID_EVENT', 'Skupinový offline výdaj nemá pripravenú skupinu alebo osoby.')
    }

    const [{ data: issue, error: issueError }, { data: items, error: itemsError }] = await Promise.all([
      supabaseServer
        .from('registration_group_issues')
        .select('id, datum, typ_jedla, status')
        .eq('id', event.registrationGroupIssueId)
        .maybeSingle(),
      supabaseServer
        .from('registration_group_issue_items')
        .select('id, user_id, volba, status')
        .eq('issue_id', event.registrationGroupIssueId)
        .in('user_id', issuedPersonIds)
    ])

    if (issueError) throw issueError
    if (itemsError) throw itemsError

    if (!issue || issue.status === 'CANCELLED' || issue.datum !== event.mealDate || issue.typ_jedla !== meal) {
      return conflict(event, actorId, 'CONFLICT_INVALID_ENTITLEMENT', 'Skupinový výdaj už nie je platný.')
    }

    const plannedItems = (items || []).filter((item: any) => item.status === 'PLANNED')
    if (plannedItems.length !== issuedPersonIds.length) {
      return conflict(event, actorId, 'CONFLICT_DUPLICATE_ISSUE', 'Niektoré položky skupinového výdaja už nie sú vydateľné.')
    }

    const { data: inserted, error: insertError } = await supabaseServer
      .from('vydaj_jedal')
      .insert(plannedItems.map((item: any) => ({
        user_id: item.user_id,
        group_id: null,
        registration_group_issue_id: event.registrationGroupIssueId,
        datum: event.mealDate,
        typ_jedla: meal,
        volba: normalizeChoice(item.volba),
        sposob: 'HROMADNE',
        status: 'VYDANE',
        issued_by: actorId,
        qr_code: item.user_id === event.personId ? event.qrCode : null,
        source: 'OFFLINE',
        note: `Offline sync zo zariadenia ${event.deviceId}.`
      })))
      .select('id')

    if (insertError) {
      if (insertError.code === '23505') {
        return conflict(event, actorId, 'CONFLICT_DUPLICATE_ISSUE', 'Niektoré jedlo už bolo vydané.')
      }
      throw insertError
    }

    const createdIssueIds = (inserted || []).map((row: any) => row.id).filter(Boolean)
    const { data: updatedItems, error: updateError } = await supabaseServer
      .from('registration_group_issue_items')
      .update({
        status: 'BULK_ISSUED',
        updated_at: new Date().toISOString()
      })
      .eq('issue_id', event.registrationGroupIssueId)
      .in('user_id', issuedPersonIds)
      .eq('status', 'PLANNED')
      .select('id')

    if (updateError || (updatedItems || []).length !== issuedPersonIds.length) {
      await supabaseServer
        .from('vydaj_jedal')
        .update({
          status: 'STORNOVANE',
          cancelled_by: actorId,
          cancelled_at: new Date().toISOString(),
          note: 'Offline sync bol automaticky stornovaný, lebo sa nepodarilo potvrdiť položky.'
        })
        .in('id', createdIssueIds)
        .eq('status', 'VYDANE')

      return conflict(event, actorId, 'CONFLICT_INVALID_ENTITLEMENT', updateError?.message || 'Skupinová príprava sa medzičasom zmenila.')
    }

    const result: EventResult = {
      offlineEventId: event.offlineEventId,
      resultStatus: 'SYNCED',
      createdIssueIds
    }
    await storeEventResult({ event, actorId, result, createdIssueIds })
    return result
  }

  const entitlement = await assertIndividualEntitlement(event, meal)
  if (!entitlement.ok || !entitlement.choice) {
    return conflict(event, actorId, entitlement.conflictType, entitlement.message)
  }

  let itemId = ''
  if (event.registrationGroupIssueId) {
    const { data: item, error: itemError } = await supabaseServer
      .from('registration_group_issue_items')
      .select('id, status')
      .eq('issue_id', event.registrationGroupIssueId)
      .eq('user_id', event.personId)
      .maybeSingle()

    if (itemError) throw itemError
    if (!item || item.status !== 'PLANNED') {
      return conflict(event, actorId, 'CONFLICT_DUPLICATE_ISSUE', 'Položka skupinového výdaja už nie je vydateľná.')
    }
    itemId = item.id
  }

  const { data: issued, error: insertError } = await supabaseServer
    .from('vydaj_jedal')
    .insert({
      user_id: event.personId,
      group_id: null,
      registration_group_issue_id: event.registrationGroupIssueId || null,
      datum: event.mealDate,
      typ_jedla: meal,
      volba: entitlement.choice,
      sposob: 'INDIVIDUALNE',
      status: 'VYDANE',
      issued_by: actorId,
      qr_code: event.qrCode || null,
      source: 'OFFLINE',
      note: `Offline individuálny výdaj zo zariadenia ${event.deviceId}.`
    })
    .select('id')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return conflict(event, actorId, 'CONFLICT_DUPLICATE_ISSUE', 'Jedlo už bolo vydané.')
    }
    throw insertError
  }

  if (itemId) {
    const { data: updatedItems, error: updateError } = await supabaseServer
      .from('registration_group_issue_items')
      .update({
        status: 'INDIVIDUAL_ISSUED',
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('status', 'PLANNED')
      .select('id')

    if (updateError || (updatedItems || []).length !== 1) {
      await supabaseServer
        .from('vydaj_jedal')
        .update({
          status: 'STORNOVANE',
          cancelled_by: actorId,
          cancelled_at: new Date().toISOString(),
          note: 'Offline sync bol automaticky stornovaný, lebo sa nepodarilo potvrdiť položku skupinového výdaja.'
        })
        .eq('id', issued.id)
        .eq('status', 'VYDANE')

      return conflict(event, actorId, 'CONFLICT_INVALID_ENTITLEMENT', updateError?.message || 'Položka skupinového výdaja sa medzičasom zmenila.')
    }
  }

  const result: EventResult = {
    offlineEventId: event.offlineEventId,
    resultStatus: 'SYNCED',
    createdIssueIds: [issued.id]
  }
  await storeEventResult({ event, actorId, result, createdIssueIds: [issued.id] })
  return result
}

async function processCancel(event: OfflineSyncEvent, actorId: string): Promise<EventResult> {
  if (!event.targetOfflineEventId) {
    return conflict(event, actorId, 'CONFLICT_CANCEL_WITHOUT_ACTIVE_ISSUE', 'Storno nemá cieľový offline výdaj.')
  }

  const { data: target, error: targetError } = await supabaseServer
    .from('offline_issue_events_server')
    .select('offline_event_id, result_status, created_issue_ids, registration_group_issue_id, issued_person_ids')
    .eq('offline_event_id', event.targetOfflineEventId)
    .maybeSingle()

  if (targetError) throw targetError

  const targetIssueIds = (target?.created_issue_ids || []).filter(Boolean)
  if (!target || target.result_status !== 'SYNCED' || targetIssueIds.length === 0) {
    return conflict(event, actorId, 'CONFLICT_CANCEL_WITHOUT_ACTIVE_ISSUE', 'Server nepozná aktívny výdaj, ktorý by sa dal stornovať.')
  }

  const { data: activeRows, error: activeError } = await supabaseServer
    .from('vydaj_jedal')
    .select('id, user_id')
    .in('id', targetIssueIds)
    .eq('status', 'VYDANE')

  if (activeError) throw activeError
  if ((activeRows || []).length === 0) {
    return conflict(event, actorId, 'CONFLICT_ALREADY_CANCELLED', 'Výdaj už bol medzičasom stornovaný.')
  }

  const now = new Date().toISOString()
  const idsToCancel = (activeRows || []).map((row: any) => row.id)
  const userIds = (activeRows || []).map((row: any) => row.user_id).filter(Boolean)
  const { error: cancelError } = await supabaseServer
    .from('vydaj_jedal')
    .update({
      status: 'STORNOVANE',
      cancelled_by: actorId,
      cancelled_at: now,
      note: `Offline storno zo zariadenia ${event.deviceId}.`
    })
    .in('id', idsToCancel)
    .eq('status', 'VYDANE')

  if (cancelError) throw cancelError

  if (target.registration_group_issue_id && userIds.length > 0) {
    await supabaseServer
      .from('registration_group_issue_items')
      .update({
        status: 'PLANNED',
        updated_at: now
      })
      .eq('issue_id', target.registration_group_issue_id)
      .in('user_id', userIds)
      .in('status', ['BULK_ISSUED', 'INDIVIDUAL_ISSUED'])
  }

  const result: EventResult = {
    offlineEventId: event.offlineEventId,
    resultStatus: 'SYNCED',
    createdIssueIds: []
  }
  await storeEventResult({ event, actorId, result })
  return result
}

async function processEvent(event: OfflineSyncEvent, actorId: string, access: GlobalAccess): Promise<EventResult> {
  const existing = await existingResult(event.offlineEventId)
  if (existing) return existing

  try {
    return event.operation === 'CANCEL_ISSUE'
      ? await processCancel(event, actorId)
      : await processIssue(event, actorId, access)
  } catch (err: any) {
    return {
      offlineEventId: event.offlineEventId,
      resultStatus: 'FAILED_RETRY',
      message: err?.message || 'Technická chyba synchronizácie.'
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const ipLimit = checkRateLimit(req, 'offline-sync', 60, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela synchronizacii. Skuste znova neskor.')

    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)
    if (!access.canPrepareOfflineIssue) {
      return NextResponse.json({ error: 'Nemáš oprávnenie synchronizovať offline výdaj.' }, { status: 403 })
    }

    const actorLimit = checkActorRateLimit(actor.id, 'offline-sync', 30, 10 * 60 * 1000)
    if (!actorLimit.ok) return rateLimitResponse(actorLimit, 'Prilis vela synchronizacii. Skuste znova neskor.')

    const body = await req.json().catch(() => null)
    const rawEvents = Array.isArray(body?.events) ? body.events : []
    const events = rawEvents.map(normalizeEvent).filter(Boolean) as OfflineSyncEvent[]

    if (events.length === 0) {
      return NextResponse.json({ error: 'Chýbajú offline udalosti.' }, { status: 400 })
    }

    const limitedEvents = events.slice(0, 500)
    const results: EventResult[] = []

    for (const event of limitedEvents) {
      results.push(await processEvent(event, actor.id, access))
    }

    return NextResponse.json({
      ok: true,
      processedCount: results.length,
      syncedCount: results.filter(result => result.resultStatus === 'SYNCED' || result.resultStatus === 'IGNORED_DUPLICATE').length,
      conflictCount: results.filter(result => result.resultStatus === 'CONFLICT').length,
      retryCount: results.filter(result => result.resultStatus === 'FAILED_RETRY').length,
      results
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Synchronizácia offline výdaja zlyhala.' },
      { status: 500 }
    )
  }
}
