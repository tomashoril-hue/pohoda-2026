import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { checkActorRateLimit, checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  entitlementOk,
  fullName,
  normalizeChoice,
  normalizeDate,
  normalizeMeal,
  normalizeSelectionChoice,
  type FoodChoice
} from '@/lib/registrationGroupIssue'

export const dynamic = 'force-dynamic'

const MAX_DELTA_AGE_MS = 30 * 60 * 1000

function relationOne(value: any) {
  return Array.isArray(value) ? value[0] : value
}

function validUntilIso() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
}

function uniqueClean(values: any[]) {
  return Array.from(new Set(values.map(value => cleanText(value)).filter(Boolean)))
}

function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function chunk<T>(values: T[], size = 500) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function isIssueActive(issue: any, now: Date) {
  if (issue?.status === 'READY') return true
  if (issue?.status !== 'WAITING') return false
  if (!issue?.valid_after) return true
  return new Date(issue.valid_after).getTime() <= now.getTime()
}

async function fetchAllRows(createQuery: (from: number, to: number) => any, pageSize = 1000) {
  const rows: any[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery(from, from + pageSize - 1)
    if (error) throw error

    const page = data || []
    rows.push(...page)

    if (page.length < pageSize) break
  }

  return rows
}

async function fetchRowsByChunks<T = any>(ids: string[], createQuery: (idChunk: string[]) => any) {
  const rows: T[] = []
  const cleanIds = uniqueClean(ids)

  for (const idChunk of chunk(cleanIds)) {
    if (idChunk.length === 0) continue
    const { data, error } = await createQuery(idChunk)
    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}

async function loadQrCodesByUserId(userIds: string[]) {
  const ids = uniqueClean(userIds)
  const map = new Map<string, string[]>()

  ids.forEach(id => map.set(id, []))
  if (ids.length === 0) return map

  for (const idChunk of chunk(ids)) {
    const [usersResult, activeQrResult] = await Promise.all([
      supabaseServer
        .from('users')
        .select('id, qr_code')
        .in('id', idChunk),
      supabaseServer
        .from('user_qr_codes')
        .select('user_id, qr_code, active')
        .in('user_id', idChunk)
        .eq('active', true)
    ])

    if (usersResult.error) throw usersResult.error
    if (activeQrResult.error) throw activeQrResult.error

    ;(usersResult.data || []).forEach((row: any) => {
      map.set(row.id, uniqueClean([...(map.get(row.id) || []), row.qr_code]))
    })

    ;(activeQrResult.data || []).forEach((row: any) => {
      map.set(row.user_id, uniqueClean([...(map.get(row.user_id) || []), row.qr_code]))
    })
  }

  return map
}

async function loadUsersById(userIds: string[]) {
  return fetchRowsByChunks(userIds, idChunk => {
    return supabaseServer
      .from('users')
      .select('id, meno, priezvisko, aktivny, typ_stravy, registration_group_id')
      .in('id', idChunk)
  })
}

async function loadSelectionsByUserId(userIds: string[], date: string, meal: string) {
  const map = new Map<string, any>()

  for (const idChunk of chunk(userIds)) {
    if (idChunk.length === 0) continue
    const { data, error } = await supabaseServer
      .from('vyber_jedal')
      .select('user_id, volba')
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .in('user_id', idChunk)

    if (error) throw error
    ;(data || []).forEach((row: any) => map.set(row.user_id, row))
  }

  return map
}

async function loadEntitlementsByUserId(userIds: string[], date: string) {
  const map = new Map<string, any>()

  for (const idChunk of chunk(userIds)) {
    if (idChunk.length === 0) continue
    const { data, error } = await supabaseServer
      .from('user_food_entitlements')
      .select('user_id, obed, vecera')
      .eq('datum', date)
      .in('user_id', idChunk)

    if (error) throw error
    ;(data || []).forEach((row: any) => map.set(row.user_id, row))
  }

  return map
}

async function loadIssuedUserIds(userIds: string[], date: string, meal: string) {
  const rows = await fetchRowsByChunks(userIds, idChunk => {
    return supabaseServer
      .from('vydaj_jedal')
      .select('user_id')
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .eq('status', 'VYDANE')
      .in('user_id', idChunk)
  })

  return new Set(rows.map((row: any) => row.user_id).filter(Boolean))
}

async function loadRegistrationGroupNamesByUserId(userIds: string[], date: string, usersById: Map<string, any>) {
  const periods = await fetchRowsByChunks(userIds, idChunk => {
    return supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to')
      .in('user_id', idChunk)
      .lte('valid_from', date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
  })

  const groupIdByUserId = new Map<string, string>()
  const periodsByUserId = new Map<string, any[]>()

  periods.forEach((period: any) => {
    const list = periodsByUserId.get(period.user_id) || []
    list.push(period)
    periodsByUserId.set(period.user_id, list)
  })

  userIds.forEach(userId => {
    const period = (periodsByUserId.get(userId) || [])
      .sort((a, b) => cleanText(b.valid_from).localeCompare(cleanText(a.valid_from)))[0]
    const fallbackGroupId = cleanText(usersById.get(userId)?.registration_group_id)
    const groupId = cleanText(period?.registration_group_id) || fallbackGroupId
    if (groupId) groupIdByUserId.set(userId, groupId)
  })

  const groupIds = uniqueClean(Array.from(groupIdByUserId.values()))
  const groupNameById = new Map<string, string>()

  const groups = await fetchRowsByChunks(groupIds, idChunk => {
    return supabaseServer
      .from('registration_groups')
      .select('id, name')
      .in('id', idChunk)
  })

  groups.forEach((group: any) => groupNameById.set(group.id, group.name || ''))

  const result = new Map<string, string>()
  userIds.forEach(userId => {
    const groupId = groupIdByUserId.get(userId)
    result.set(userId, groupId ? groupNameById.get(groupId) || '' : '')
  })

  return result
}

type QrIndexMode = 'GROUP_ISSUE' | 'INDIVIDUAL' | 'PICKUP_USER'

function addQrIndexRows({
  qrRowsByCode,
  qrCodes,
  snapshotId,
  entitlementId,
  personId,
  mode,
  issueId,
  updatedAt
}: {
  qrRowsByCode: Map<string, any>
  qrCodes: string[]
  snapshotId: string
  entitlementId?: string
  personId: string
  mode: QrIndexMode
  issueId?: string
  updatedAt: string
}) {
  qrCodes.forEach(qrCode => {
    const existing = qrRowsByCode.get(qrCode)
    const entitlementIds = uniqueValues([
      ...(existing?.entitlementIds || []),
      entitlementId || ''
    ])
    const issueIds = uniqueValues([
      ...(existing?.issueIds || []),
      issueId || ''
    ])
    const pickupIssueIds = mode === 'PICKUP_USER'
      ? uniqueValues([...(existing?.pickupIssueIds || []), issueId || ''])
      : existing?.pickupIssueIds || []
    const modes = uniqueValues([...(existing?.modes || []), mode])

    qrRowsByCode.set(qrCode, {
      qrCode,
      snapshotId,
      entitlementId: existing?.entitlementId || entitlementId || '',
      entitlementIds,
      personId,
      mode: existing?.mode || mode,
      modes,
      issueId: existing?.issueId || issueId || '',
      issueIds,
      pickupIssueIds,
      active: true,
      updatedAt
    })
  })
}

function mergeRows(rows: any[]) {
  const map = new Map<string, any>()
  rows.forEach(row => {
    const key = cleanText(row.id) || `${row.issue_id}:${row.user_id}:${Math.random()}`
    map.set(key, row)
  })
  return Array.from(map.values())
}

export async function GET(req: NextRequest) {
  try {
    const ipLimit = checkRateLimit(req, 'offline-snapshot-delta', 120, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit)

    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)
    if (!access.canPrepareOfflineIssue) {
      return NextResponse.json({ error: 'Nemáš oprávnenie obnovovať offline dáta.' }, { status: 403 })
    }

    const actorLimit = checkActorRateLimit(actor.id, 'offline-snapshot-delta', 90, 10 * 60 * 1000)
    if (!actorLimit.ok) return rateLimitResponse(actorLimit)

    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))
    const since = cleanText(req.nextUrl.searchParams.get('since'))
    const snapshotId = cleanText(req.nextUrl.searchParams.get('snapshotId'))
    const sinceDate = since ? new Date(since) : null

    if (!date || !meal || !snapshotId || !sinceDate || Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ ok: true, mode: 'full_refresh_required', reason: 'missing_delta_context' })
    }

    if (Date.now() - sinceDate.getTime() > MAX_DELTA_AGE_MS) {
      return NextResponse.json({ ok: true, mode: 'full_refresh_required', reason: 'snapshot_too_old' })
    }

    const { data: allIssues, error: allIssuesError } = await supabaseServer
      .from('registration_group_issues')
      .select('id, registration_group_id, title, datum, typ_jedla, status, valid_after, updated_at, registration_groups:registration_groups!registration_group_issues_registration_group_id_fkey (id, name)')
      .eq('datum', date)
      .eq('typ_jedla', meal)

    if (allIssuesError) throw allIssuesError

    const allIssueIds = (allIssues || []).map((issue: any) => issue.id).filter(Boolean)
    const [
      changedIssuedRows,
      changedEntitlementRows,
      changedSelectionRows,
      changedIssueRows,
      changedItemRows,
      changedPickupRows,
      changedDeleteEvents
    ] = await Promise.all([
      fetchAllRows((from, to) => supabaseServer
        .from('vydaj_jedal')
        .select('user_id, registration_group_issue_id')
        .eq('datum', date)
        .eq('typ_jedla', meal)
        .or(`issued_at.gt.${since},cancelled_at.gt.${since}`)
        .range(from, to)),
      fetchAllRows((from, to) => supabaseServer
        .from('user_food_entitlements')
        .select('user_id')
        .eq('datum', date)
        .gt('updated_at', since)
        .range(from, to)),
      fetchAllRows((from, to) => supabaseServer
        .from('vyber_jedal')
        .select('user_id')
        .eq('datum', date)
        .eq('typ_jedla', meal)
        .gt('updated_at', since)
        .range(from, to)),
      fetchAllRows((from, to) => supabaseServer
        .from('registration_group_issues')
        .select('id')
        .eq('datum', date)
        .eq('typ_jedla', meal)
        .gt('updated_at', since)
        .range(from, to)),
      allIssueIds.length
        ? fetchAllRows((from, to) => supabaseServer
          .from('registration_group_issue_items')
          .select('id, issue_id, user_id')
          .in('issue_id', allIssueIds)
          .gt('updated_at', since)
          .range(from, to))
        : Promise.resolve([]),
      allIssueIds.length
        ? fetchAllRows((from, to) => supabaseServer
          .from('registration_group_issue_pickup_users')
          .select('id, issue_id, user_id, active, updated_at')
          .in('issue_id', allIssueIds)
          .gt('updated_at', since)
          .range(from, to))
        : Promise.resolve([]),
      fetchAllRows((from, to) => supabaseServer
        .from('offline_delta_events')
        .select('user_id, issue_id')
        .eq('datum', date)
        .or(`typ_jedla.is.null,typ_jedla.eq.${meal}`)
        .gt('created_at', since)
        .range(from, to))
    ])

    let affectedIssueIds = uniqueClean([
      ...changedIssuedRows.map((row: any) => row.registration_group_issue_id),
      ...changedIssueRows.map((row: any) => row.id),
      ...changedItemRows.map((row: any) => row.issue_id),
      ...changedPickupRows.map((row: any) => row.issue_id),
      ...changedDeleteEvents.map((row: any) => row.issue_id)
    ])
    let affectedPersonIds = uniqueClean([
      ...changedIssuedRows.map((row: any) => row.user_id),
      ...changedEntitlementRows.map((row: any) => row.user_id),
      ...changedSelectionRows.map((row: any) => row.user_id),
      ...changedItemRows.map((row: any) => row.user_id),
      ...changedPickupRows.map((row: any) => row.user_id),
      ...changedDeleteEvents.map((row: any) => row.user_id)
    ])

    const userOrQrChanged = await Promise.all([
      fetchAllRows((from, to) => supabaseServer
        .from('users')
        .select('id')
        .gt('updated_at', since)
        .range(from, to)),
      fetchAllRows((from, to) => supabaseServer
        .from('user_qr_codes')
        .select('user_id')
        .gt('updated_at', since)
        .range(from, to))
    ])

    const profileOrQrUserIds = uniqueClean([
      ...userOrQrChanged[0].map((row: any) => row.id),
      ...userOrQrChanged[1].map((row: any) => row.user_id)
    ])

    if (profileOrQrUserIds.length > 0) {
      const relevantIndividualRows = await fetchRowsByChunks(profileOrQrUserIds, idChunk => supabaseServer
        .from('user_food_entitlements')
        .select('user_id')
        .eq('datum', date)
        .eq(meal === 'OBED' ? 'obed' : 'vecera', true)
        .in('user_id', idChunk))
      const relevantGroupRows = allIssueIds.length
        ? await fetchRowsByChunks(profileOrQrUserIds, idChunk => supabaseServer
          .from('registration_group_issue_items')
          .select('user_id, issue_id')
          .in('issue_id', allIssueIds)
          .in('user_id', idChunk))
        : []
      const relevantPickupRows = allIssueIds.length
        ? await fetchRowsByChunks(profileOrQrUserIds, idChunk => supabaseServer
          .from('registration_group_issue_pickup_users')
          .select('user_id, issue_id')
          .in('issue_id', allIssueIds)
          .eq('active', true)
          .in('user_id', idChunk))
        : []

      affectedPersonIds = uniqueClean([
        ...affectedPersonIds,
        ...relevantIndividualRows.map((row: any) => row.user_id),
        ...relevantGroupRows.map((row: any) => row.user_id),
        ...relevantPickupRows.map((row: any) => row.user_id)
      ])
      affectedIssueIds = uniqueClean([
        ...affectedIssueIds,
        ...relevantGroupRows.map((row: any) => row.issue_id),
        ...relevantPickupRows.map((row: any) => row.issue_id)
      ])
    }

    if (affectedPersonIds.length === 0 && affectedIssueIds.length === 0) {
      return NextResponse.json({ ok: true, mode: 'no_changes' })
    }

    const itemRowsByIssue = affectedIssueIds.length
      ? await fetchRowsByChunks(affectedIssueIds, idChunk => supabaseServer
        .from('registration_group_issue_items')
        .select('id, issue_id, user_id, volba, status, updated_at')
        .in('issue_id', idChunk))
      : []
    const itemRowsByUser = affectedPersonIds.length && allIssueIds.length
      ? await fetchRowsByChunks(affectedPersonIds, idChunk => supabaseServer
        .from('registration_group_issue_items')
        .select('id, issue_id, user_id, volba, status, updated_at')
        .in('issue_id', allIssueIds)
        .in('user_id', idChunk))
      : []
    const pickupRowsByIssue = affectedIssueIds.length
      ? await fetchRowsByChunks(affectedIssueIds, idChunk => supabaseServer
        .from('registration_group_issue_pickup_users')
        .select('id, issue_id, user_id, active, updated_at')
        .in('issue_id', idChunk))
      : []
    const pickupRowsByUser = affectedPersonIds.length && allIssueIds.length
      ? await fetchRowsByChunks(affectedPersonIds, idChunk => supabaseServer
        .from('registration_group_issue_pickup_users')
        .select('id, issue_id, user_id, active, updated_at')
        .in('issue_id', allIssueIds)
        .in('user_id', idChunk))
      : []

    const itemRows = mergeRows([...itemRowsByIssue, ...itemRowsByUser])
    const pickupRows = mergeRows([...pickupRowsByIssue, ...pickupRowsByUser])
    affectedIssueIds = uniqueClean([
      ...affectedIssueIds,
      ...itemRows.map((row: any) => row.issue_id),
      ...pickupRows.map((row: any) => row.issue_id)
    ])
    affectedPersonIds = uniqueClean([
      ...affectedPersonIds,
      ...itemRows.map((row: any) => row.user_id),
      ...pickupRows.map((row: any) => row.user_id)
    ])

    const issueMap = new Map((allIssues || []).map((issue: any) => [issue.id, issue]))
    const now = new Date()
    const preparedAt = now.toISOString()
    const activeIssueIds = new Set(
      affectedIssueIds.filter(issueId => isIssueActive(issueMap.get(issueId), now))
    )
    const activeItemRows = itemRows.filter((row: any) => activeIssueIds.has(row.issue_id))
    const activePickupRows = pickupRows.filter((row: any) => activeIssueIds.has(row.issue_id) && row.active !== false)
    const userIds = uniqueClean([
      ...affectedPersonIds,
      ...activeItemRows.map((row: any) => row.user_id),
      ...activePickupRows.map((row: any) => row.user_id)
    ])

    const [users, qrCodesByUserId, selectionByUserId, entitlementByUserId, issuedUserIds] = await Promise.all([
      loadUsersById(userIds),
      loadQrCodesByUserId(userIds),
      loadSelectionsByUserId(userIds, date, meal),
      loadEntitlementsByUserId(userIds, date),
      loadIssuedUserIds(userIds, date, meal)
    ])

    const usersById = new Map(users.map((user: any) => [user.id, user]))
    const registrationGroupNameByUserId = await loadRegistrationGroupNamesByUserId(userIds, date, usersById)
    const qrRowsByCode = new Map<string, any>()

    const groupEntitlements = activeItemRows
      .map((item: any) => {
        const issue = issueMap.get(item.issue_id)
        const group = relationOne(issue?.registration_groups)
        const user = usersById.get(item.user_id)
        const selectionChoice = normalizeSelectionChoice(selectionByUserId.get(item.user_id)?.volba)
        const choice = selectionChoice === 'BEZ_ZAUJMU'
          ? null
          : normalizeChoice(selectionChoice || item.volba || user?.typ_stravy) as FoodChoice | null
        const qrCodes = qrCodesByUserId.get(item.user_id) || []

        if (item.status !== 'PLANNED') return null
        if (!entitlementOk(entitlementByUserId.get(item.user_id), meal)) return null
        if (!issue || !user || String(user.aktivny || '').toUpperCase() !== 'ANO' || !choice) return null

        const entitlement = {
          entitlementId: item.id,
          snapshotId,
          mode: 'GROUP_ISSUE',
          issueId: issue.id,
          issueTitle: issue.title || '',
          personId: user.id,
          qrCode: qrCodes[0] || '',
          qrCodes,
          fullName: fullName(user),
          registrationGroupName: group?.name || '',
          choice,
          mealDate: date,
          mealType: meal,
          issueLocation: 'Hlavné výdajné miesto',
          entitlementStatus: qrCodes.length > 0 ? 'VALID' : 'BLOCKED',
          issuedStatus: issuedUserIds.has(user.id) ? 'ISSUED' : 'NOT_ISSUED',
          localIssuedEventId: issuedUserIds.has(user.id) ? 'server-issued' : '',
          updatedAt: item.updated_at || preparedAt
        }

        addQrIndexRows({
          qrRowsByCode,
          qrCodes,
          snapshotId,
          entitlementId: item.id,
          personId: user.id,
          mode: 'GROUP_ISSUE',
          issueId: issue.id,
          updatedAt: preparedAt
        })

        return entitlement
      })
      .filter(Boolean)

    const individualEntitlements = affectedPersonIds
      .map((userId: string) => {
        const user = usersById.get(userId)
        const selectionChoice = normalizeSelectionChoice(selectionByUserId.get(userId)?.volba)
        const choice = selectionChoice === 'BEZ_ZAUJMU'
          ? null
          : normalizeChoice(selectionChoice || user?.typ_stravy)
        const qrCodes = qrCodesByUserId.get(userId) || []
        const entitlementId = `individual:${date}:${meal}:${userId}`

        if (!entitlementOk(entitlementByUserId.get(userId), meal)) return null
        if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO' || !choice) return null

        const entitlement = {
          entitlementId,
          snapshotId,
          mode: 'INDIVIDUAL',
          issueId: '',
          issueTitle: 'Individuálny výdaj',
          personId: user.id,
          qrCode: qrCodes[0] || '',
          qrCodes,
          fullName: fullName(user),
          registrationGroupName: registrationGroupNameByUserId.get(user.id) || '',
          choice,
          mealDate: date,
          mealType: meal,
          issueLocation: 'Hlavné výdajné miesto',
          entitlementStatus: qrCodes.length > 0 ? 'VALID' : 'BLOCKED',
          issuedStatus: issuedUserIds.has(user.id) ? 'ISSUED' : 'NOT_ISSUED',
          localIssuedEventId: issuedUserIds.has(user.id) ? 'server-issued' : '',
          updatedAt: preparedAt
        }

        addQrIndexRows({
          qrRowsByCode,
          qrCodes,
          snapshotId,
          entitlementId,
          personId: user.id,
          mode: 'INDIVIDUAL',
          issueId: '',
          updatedAt: preparedAt
        })

        return entitlement
      })
      .filter(Boolean)

    const pickupUsers = activePickupRows
      .map((row: any) => {
        const user = usersById.get(row.user_id)
        if (!user) return null
        const qrCodes = qrCodesByUserId.get(user.id) || []

        addQrIndexRows({
          qrRowsByCode,
          qrCodes,
          snapshotId,
          personId: user.id,
          mode: 'PICKUP_USER',
          issueId: row.issue_id,
          updatedAt: preparedAt
        })

        return {
          id: `${row.issue_id}:${user.id}`,
          snapshotId,
          issueId: row.issue_id,
          personId: user.id,
          fullName: fullName(user),
          qrCodes,
          updatedAt: preparedAt
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      ok: true,
      mode: 'patch',
      snapshotId,
      preparedAt,
      validUntil: validUntilIso(),
      affectedPersonIds,
      affectedIssueIds,
      entitlements: [...groupEntitlements, ...individualEntitlements],
      qrCodes: Array.from(qrRowsByCode.values()),
      pickupUsers,
      counts: {
        affectedPeople: affectedPersonIds.length,
        affectedIssues: affectedIssueIds.length,
        entitlementRows: groupEntitlements.length + individualEntitlements.length,
        qrCodes: qrRowsByCode.size,
        pickupUsers: pickupUsers.length
      }
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Delta obnova offline dát zlyhala.' },
      { status: 500 }
    )
  }
}
