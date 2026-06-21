import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  fullName,
  normalizeChoice,
  normalizeDate,
  normalizeMeal,
  normalizeSelectionChoice,
  type FoodChoice
} from '@/lib/registrationGroupIssue'

export const dynamic = 'force-dynamic'

function relationOne(value: any) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeLocation(value: any) {
  return cleanText(value).slice(0, 80) || 'Offline zariadenie'
}

function validUntilIso() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
}

function isIssueActive(issue: any, now: Date) {
  if (issue?.status === 'READY') return true
  if (issue?.status !== 'WAITING') return false
  if (!issue?.valid_after) return true
  return new Date(issue.valid_after).getTime() <= now.getTime()
}

function uniqueClean(values: any[]) {
  return Array.from(new Set(values.map(value => cleanText(value)).filter(Boolean)))
}

function chunk<T>(values: T[], size = 500) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
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

async function loadQrCodesByUserId(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
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
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const rows: any[] = []

  for (const idChunk of chunk(ids)) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, aktivny, typ_stravy, registration_group_id')
      .in('id', idChunk)

    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}

async function loadSelectionsByUserId(userIds: string[], date: string, meal: string) {
  const map = new Map<string, any>()

  for (const idChunk of chunk(userIds)) {
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

async function loadIssuedUserIds(date: string, meal: string) {
  const rows = await fetchAllRows((from, to) => {
    return supabaseServer
      .from('vydaj_jedal')
      .select('user_id')
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .eq('status', 'VYDANE')
      .range(from, to)
  })

  return new Set(rows.map((row: any) => row.user_id).filter(Boolean))
}

async function loadIndividualEntitlementUserIds(date: string, meal: string) {
  const mealColumn = meal === 'OBED' ? 'obed' : 'vecera'
  const rows = await fetchAllRows((from, to) => {
    return supabaseServer
      .from('user_food_entitlements')
      .select('user_id')
      .eq('datum', date)
      .eq(mealColumn, true)
      .range(from, to)
  })

  return uniqueClean(rows.map((row: any) => row.user_id))
}

async function loadRegistrationGroupNamesByUserId(userIds: string[], date: string, usersById: Map<string, any>) {
  const periods: any[] = []

  for (const idChunk of chunk(userIds)) {
    const { data, error } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to')
      .in('user_id', idChunk)
      .lte('valid_from', date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)

    if (error) throw error
    periods.push(...(data || []))
  }

  const groupIdByUserId = new Map<string, string>()
  const periodsByUserId = new Map<string, any[]>()

  periods.forEach(period => {
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

  for (const groupChunk of chunk(groupIds)) {
    const { data, error } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .in('id', groupChunk)

    if (error) throw error
    ;(data || []).forEach((group: any) => groupNameById.set(group.id, group.name || ''))
  }

  const result = new Map<string, string>()
  userIds.forEach(userId => {
    const groupId = groupIdByUserId.get(userId)
    result.set(userId, groupId ? groupNameById.get(groupId) || '' : '')
  })

  return result
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canPrepareOfflineIssue) {
      return NextResponse.json({ error: 'Nemas opravnenie stiahnut offline data.' }, { status: 403 })
    }

    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))
    const issueLocation = normalizeLocation(req.nextUrl.searchParams.get('issueLocation'))
    const deviceId = cleanText(req.nextUrl.searchParams.get('deviceId')).slice(0, 120)

    if (!date || !meal) {
      return NextResponse.json({ error: 'Chyba datum alebo jedlo.' }, { status: 400 })
    }

    const { data: rawIssues, error: issuesError } = await supabaseServer
      .from('registration_group_issues')
      .select(`
        id,
        registration_group_id,
        title,
        datum,
        typ_jedla,
        status,
        valid_after,
        updated_at,
        registration_groups:registration_groups!registration_group_issues_registration_group_id_fkey (
          id,
          name
        )
      `)
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .in('status', ['READY', 'WAITING'])
      .order('title', { ascending: true })

    if (issuesError) throw issuesError

    const now = new Date()
    const issues = (rawIssues || []).filter((issue: any) => isIssueActive(issue, now))
    const issueIds = issues.map((issue: any) => issue.id).filter(Boolean)

    const snapshotId = randomUUID()
    const preparedAt = now.toISOString()
    const preparedByRole = access.isAdmin ? 'ADMIN' : 'OFFLINE_OBSLUHA'

    const [itemRows, pickupRows, individualEntitlementUserIds, issuedUserIds] = await Promise.all([
      issueIds.length > 0
        ? fetchAllRows((from, to) => {
          return supabaseServer
            .from('registration_group_issue_items')
            .select('id, issue_id, user_id, volba, status, updated_at')
            .in('issue_id', issueIds)
            .eq('status', 'PLANNED')
            .range(from, to)
        })
        : Promise.resolve([]),
      issueIds.length > 0
        ? fetchAllRows((from, to) => {
          return supabaseServer
            .from('registration_group_issue_pickup_users')
            .select('id, issue_id, user_id')
            .in('issue_id', issueIds)
            .range(from, to)
        })
        : Promise.resolve([]),
      loadIndividualEntitlementUserIds(date, meal),
      loadIssuedUserIds(date, meal)
    ])

    const plannedGroupUserIds = new Set(itemRows.map((row: any) => row.user_id).filter(Boolean))
    const individualUserIds = individualEntitlementUserIds.filter(userId => {
      return !plannedGroupUserIds.has(userId) && !issuedUserIds.has(userId)
    })
    const userIds = uniqueClean([
      ...itemRows.map((row: any) => row.user_id),
      ...pickupRows.map((row: any) => row.user_id),
      ...individualUserIds
    ])

    const [users, qrCodesByUserId, selectionByUserId] = await Promise.all([
      loadUsersById(userIds),
      loadQrCodesByUserId(userIds),
      loadSelectionsByUserId(individualUserIds, date, meal)
    ])

    const usersById = new Map(users.map((user: any) => [user.id, user]))
    const registrationGroupNameByUserId = await loadRegistrationGroupNamesByUserId(individualUserIds, date, usersById)
    const issuesById = new Map(issues.map((issue: any) => [issue.id, issue]))
    const qrRows: any[] = []
    const warnings: string[] = []

    const groupEntitlements = itemRows
      .map((item: any) => {
        const issue = issuesById.get(item.issue_id)
        const group = relationOne(issue?.registration_groups)
        const user = usersById.get(item.user_id)
        const choice = normalizeChoice(item.volba || user?.typ_stravy) as FoodChoice | null
        const qrCodes = qrCodesByUserId.get(item.user_id) || []

        if (issuedUserIds.has(item.user_id)) return null
        if (!issue || !user || String(user.aktivny || '').toUpperCase() !== 'ANO' || !choice) return null
        if (qrCodes.length === 0) warnings.push(`Osoba ${fullName(user)} nema aktivny QR kod pre offline skenovanie.`)

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
          issueLocation,
          entitlementStatus: qrCodes.length > 0 ? 'VALID' : 'BLOCKED',
          issuedStatus: 'NOT_ISSUED',
          localIssuedEventId: '',
          updatedAt: item.updated_at || preparedAt
        }

        qrCodes.forEach(qrCode => {
          qrRows.push({
            qrCode,
            snapshotId,
            entitlementId: item.id,
            personId: user.id,
            mode: 'GROUP_ISSUE',
            issueId: issue.id,
            active: true,
            updatedAt: preparedAt
          })
        })

        return entitlement
      })
      .filter(Boolean)

    const individualEntitlements = individualUserIds
      .map((userId: string) => {
        const user = usersById.get(userId)
        const selectionChoice = normalizeSelectionChoice(selectionByUserId.get(userId)?.volba)
        const choice = selectionChoice === 'BEZ_ZAUJMU'
          ? null
          : normalizeChoice(selectionChoice || user?.typ_stravy)
        const qrCodes = qrCodesByUserId.get(userId) || []
        const entitlementId = `individual:${date}:${meal}:${userId}`

        if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO' || !choice) return null
        if (qrCodes.length === 0) warnings.push(`Osoba ${fullName(user)} nema aktivny QR kod pre offline skenovanie.`)

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
          issueLocation,
          entitlementStatus: qrCodes.length > 0 ? 'VALID' : 'BLOCKED',
          issuedStatus: 'NOT_ISSUED',
          localIssuedEventId: '',
          updatedAt: preparedAt
        }

        qrCodes.forEach(qrCode => {
          qrRows.push({
            qrCode,
            snapshotId,
            entitlementId,
            personId: user.id,
            mode: 'INDIVIDUAL',
            issueId: '',
            active: true,
            updatedAt: preparedAt
          })
        })

        return entitlement
      })
      .filter(Boolean)

    const entitlements = [...groupEntitlements, ...individualEntitlements]

    const pickupUsers = pickupRows
      .map((row: any) => {
        const user = usersById.get(row.user_id)
        if (!user) return null

        return {
          issueId: row.issue_id,
          personId: user.id,
          fullName: fullName(user),
          qrCodes: qrCodesByUserId.get(user.id) || []
        }
      })
      .filter(Boolean)

    const snapshot = {
      snapshotId,
      preparedByUserId: actor.id,
      preparedByName: fullName(actor),
      preparedByRole,
      preparedAt,
      deviceId,
      mealDate: date,
      mealType: meal,
      issueLocation,
      entitlementCount: entitlements.length,
      validUntil: validUntilIso(),
      schemaVersion: 1,
      syncStatus: 'READY'
    }

    return NextResponse.json({
      ok: true,
      snapshot,
      issues: issues.map((issue: any) => {
        const group = relationOne(issue.registration_groups)
        return {
          id: issue.id,
          title: issue.title || '',
          registrationGroupId: issue.registration_group_id,
          registrationGroupName: group?.name || '',
          date,
          meal,
          status: issue.status,
          validAfter: issue.valid_after || null
        }
      }),
      entitlements,
      qrCodes: qrRows,
      pickupUsers,
      counts: {
        groupIssueEntitlements: groupEntitlements.length,
        individualEntitlements: individualEntitlements.length,
        qrCodes: qrRows.length
      },
      warnings
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Offline snapshot sa nepodarilo pripravit.' },
      { status: 500 }
    )
  }
}
