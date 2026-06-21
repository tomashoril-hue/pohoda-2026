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

async function loadQrCodesByUserId(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  const map = new Map<string, string[]>()

  ids.forEach(id => map.set(id, []))
  if (ids.length === 0) return map

  const [usersResult, activeQrResult] = await Promise.all([
    supabaseServer
      .from('users')
      .select('id, qr_code')
      .in('id', ids),
    supabaseServer
      .from('user_qr_codes')
      .select('user_id, qr_code, active')
      .in('user_id', ids)
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

  return map
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

    if (issueIds.length === 0) {
      return NextResponse.json({
        ok: true,
        snapshot: {
          snapshotId,
          preparedByUserId: actor.id,
          preparedByName: fullName(actor),
          preparedByRole,
          preparedAt,
          deviceId,
          mealDate: date,
          mealType: meal,
          issueLocation,
          entitlementCount: 0,
          validUntil: validUntilIso(),
          schemaVersion: 1,
          syncStatus: 'READY'
        },
        issues: [],
        entitlements: [],
        qrCodes: [],
        pickupUsers: [],
        warnings: []
      })
    }

    const [itemsResult, pickupResult] = await Promise.all([
      supabaseServer
        .from('registration_group_issue_items')
        .select('id, issue_id, user_id, volba, status, updated_at')
        .in('issue_id', issueIds)
        .eq('status', 'PLANNED'),
      supabaseServer
        .from('registration_group_issue_pickup_users')
        .select('id, issue_id, user_id')
        .in('issue_id', issueIds)
    ])

    if (itemsResult.error) throw itemsResult.error
    if (pickupResult.error) throw pickupResult.error

    const itemRows = itemsResult.data || []
    const pickupRows = pickupResult.data || []
    const userIds = uniqueClean([
      ...itemRows.map((row: any) => row.user_id),
      ...pickupRows.map((row: any) => row.user_id)
    ])

    const usersResult = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, aktivny, typ_stravy')
        .in('id', userIds)
      : { data: [], error: null }
    const qrCodesByUserId = await loadQrCodesByUserId(userIds)

    if (usersResult.error) throw usersResult.error

    const usersById = new Map(((usersResult.data || []) as any[]).map((user: any) => [user.id, user]))
    const issuesById = new Map(issues.map((issue: any) => [issue.id, issue]))
    const qrRows: any[] = []
    const warnings: string[] = []

    const entitlements = itemRows
      .map((item: any) => {
        const issue = issuesById.get(item.issue_id)
        const group = relationOne(issue?.registration_groups)
        const user = usersById.get(item.user_id)
        const choice = normalizeChoice(item.volba || user?.typ_stravy) as FoodChoice | null
        const qrCodes = qrCodesByUserId.get(item.user_id) || []

        if (!issue || !user || String(user.aktivny || '').toUpperCase() !== 'ANO' || !choice) return null
        if (qrCodes.length === 0) warnings.push(`Osoba ${fullName(user)} nema aktivny QR kod pre offline skenovanie.`)

        const entitlement = {
          entitlementId: item.id,
          snapshotId,
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
            issueId: issue.id,
            active: true,
            updatedAt: preparedAt
          })
        })

        return entitlement
      })
      .filter(Boolean)

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
      warnings
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Offline snapshot sa nepodarilo pripravit.' },
      { status: 500 }
    )
  }
}
