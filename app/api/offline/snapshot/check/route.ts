import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

export const dynamic = 'force-dynamic'

const MAX_DELTA_AGE_MS = 30 * 60 * 1000

async function changedCount(label: string, createQuery: () => any) {
  try {
    const { count, error } = await createQuery()
    if (error) {
      return { label, count: 1, uncertain: true }
    }

    return { label, count: Number(count || 0), uncertain: false }
  } catch {
    return { label, count: 1, uncertain: true }
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)
    if (!access.canPrepareOfflineIssue) {
      return NextResponse.json({ error: 'Nemáš oprávnenie kontrolovať offline dáta.' }, { status: 403 })
    }

    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))
    const since = cleanText(req.nextUrl.searchParams.get('since'))
    const sinceDate = since ? new Date(since) : null

    if (!date || !meal || !sinceDate || Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({
        ok: true,
        changed: true,
        reason: 'missing_or_invalid_since',
        checks: []
      })
    }

    if (Date.now() - sinceDate.getTime() > MAX_DELTA_AGE_MS) {
      return NextResponse.json({
        ok: true,
        changed: true,
        reason: 'snapshot_too_old',
        maxDeltaAgeMinutes: Math.round(MAX_DELTA_AGE_MS / 60000),
        checks: []
      })
    }

    const { data: issueRows, error: issueError } = await supabaseServer
      .from('registration_group_issues')
      .select('id')
      .eq('datum', date)
      .eq('typ_jedla', meal)

    if (issueError) throw issueError

    const issueIds = (issueRows || []).map((row: any) => row.id).filter(Boolean)

    const checks = await Promise.all([
      changedCount('food_issue_rows', () => {
        return supabaseServer
          .from('vydaj_jedal')
          .select('id', { count: 'exact', head: true })
          .eq('datum', date)
          .eq('typ_jedla', meal)
          .or(`issued_at.gt.${since},cancelled_at.gt.${since}`)
      }),
      changedCount('individual_entitlements', () => {
        return supabaseServer
          .from('user_food_entitlements')
          .select('user_id', { count: 'exact', head: true })
          .eq('datum', date)
          .gt('updated_at', since)
      }),
      changedCount('meal_selections', () => {
        return supabaseServer
          .from('vyber_jedal')
          .select('user_id', { count: 'exact', head: true })
          .eq('datum', date)
          .eq('typ_jedla', meal)
          .gt('updated_at', since)
      }),
      changedCount('registration_group_issues', () => {
        return supabaseServer
          .from('registration_group_issues')
          .select('id', { count: 'exact', head: true })
          .eq('datum', date)
          .eq('typ_jedla', meal)
          .gt('updated_at', since)
      }),
      changedCount('registration_group_issue_items', () => {
        if (issueIds.length === 0) {
          return Promise.resolve({ count: 0, error: null })
        }

        return supabaseServer
          .from('registration_group_issue_items')
          .select('id', { count: 'exact', head: true })
          .in('issue_id', issueIds)
          .gt('updated_at', since)
      }),
      changedCount('registration_group_issue_pickup_users', () => {
        if (issueIds.length === 0) {
          return Promise.resolve({ count: 0, error: null })
        }

        return supabaseServer
          .from('registration_group_issue_pickup_users')
          .select('id', { count: 'exact', head: true })
          .in('issue_id', issueIds)
          .gt('created_at', since)
      }),
      changedCount('user_profiles', () => {
        return supabaseServer
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gt('updated_at', since)
      }),
      changedCount('user_qr_codes', () => {
        return supabaseServer
          .from('user_qr_codes')
          .select('id', { count: 'exact', head: true })
          .gt('updated_at', since)
      })
    ])

    const changed = checks.some(check => check.count > 0)
    const reasons = checks
      .filter(check => check.count > 0)
      .map(check => check.label)

    return NextResponse.json({
      ok: true,
      changed,
      reason: changed ? reasons.join(',') : 'not_modified',
      checks
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Kontrola offline zmien zlyhala.' },
      { status: 500 }
    )
  }
}
