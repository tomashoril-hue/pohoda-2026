import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  getIssueAccess,
  loadUsersByIds,
  normalizeChoice,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

function normalizeUserIds(value: any) {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

async function loadIssue(issueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id, registration_group_id, datum, typ_jedla, status')
    .eq('id', issueId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const fromIssueId = cleanText(body.fromIssueId)
    const toIssueId = cleanText(body.toIssueId)
    const userIds = normalizeUserIds(body.userIds)

    if (!fromIssueId || !toIssueId || fromIssueId === toIssueId) {
      return NextResponse.json({ error: 'Vyber cielovy skupinovy vydaj.' }, { status: 400 })
    }

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jednu osobu na presun.' }, { status: 400 })
    }

    const [fromIssue, toIssue] = await Promise.all([
      loadIssue(fromIssueId),
      loadIssue(toIssueId)
    ])

    if (!fromIssue || !toIssue) {
      return NextResponse.json({ error: 'Skupinovy vydaj neexistuje.' }, { status: 404 })
    }

    const date = normalizeDate(fromIssue.datum)
    const meal = normalizeMeal(fromIssue.typ_jedla)

    if (!date || !meal) {
      return NextResponse.json({ error: 'Neplatny skupinovy vydaj.' }, { status: 400 })
    }

    const sameContext =
      fromIssue.registration_group_id === toIssue.registration_group_id &&
      normalizeDate(toIssue.datum) === date &&
      normalizeMeal(toIssue.typ_jedla) === meal

    if (!sameContext) {
      return NextResponse.json(
        { error: 'Presun je mozny iba medzi vydajmi rovnakej registracnej skupiny, datumu a jedla.' },
        { status: 400 }
      )
    }

    if (fromIssue.status === 'CANCELLED' || toIssue.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Zruseny vydaj nie je mozne pouzit na presun.' }, { status: 400 })
    }

    const access = await getIssueAccess(actor.id, fromIssue.registration_group_id)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const [{ data: sourceItems, error: sourceError }, issuedResult, targetResult] = await Promise.all([
      supabaseServer
        .from('registration_group_issue_items')
        .select('user_id, source, volba, status')
        .eq('issue_id', fromIssue.id)
        .in('user_id', userIds),
      supabaseServer
        .from('vydaj_jedal')
        .select('user_id')
        .eq('datum', date)
        .eq('typ_jedla', meal)
        .eq('status', 'VYDANE')
        .in('user_id', userIds),
      supabaseServer
        .from('registration_group_issue_items')
        .select('user_id, status')
        .eq('issue_id', toIssue.id)
        .in('user_id', userIds)
    ])

    if (sourceError) throw sourceError
    if (issuedResult.error) throw issuedResult.error
    if (targetResult.error) throw targetResult.error

    const sourceByUserId = new Map((sourceItems || []).map((item: any) => [item.user_id, item]))
    const issuedUserIds = new Set((issuedResult.data || []).map((row: any) => row.user_id))
    const targetIssuedUserIds = new Set(
      (targetResult.data || [])
        .filter((row: any) => row.status === 'BULK_ISSUED' || row.status === 'INDIVIDUAL_ISSUED')
        .map((row: any) => row.user_id)
    )

    const blockedUserIds = userIds.filter(userId => {
      const item: any = sourceByUserId.get(userId)
      return (
        !item ||
        item.status !== 'PLANNED' ||
        issuedUserIds.has(userId) ||
        targetIssuedUserIds.has(userId)
      )
    })

    if (blockedUserIds.length > 0) {
      const users = await loadUsersByIds(blockedUserIds)
      const names = users.map((user: any) => `${user.priezvisko || ''} ${user.meno || ''}`.trim() || user.email).filter(Boolean)

      return NextResponse.json(
        { error: `Niektore osoby nie je mozne presunut: ${names.join(', ') || blockedUserIds.length}.` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const { error: removeError } = await supabaseServer
      .from('registration_group_issue_items')
      .update({
        status: 'REMOVED',
        remove_reason: 'MOVED_TO_OTHER_ISSUE',
        moved_to_issue_id: toIssue.id,
        removed_at: now,
        removed_by: actor.id,
        updated_at: now
      })
      .eq('issue_id', fromIssue.id)
      .in('user_id', userIds)
      .eq('status', 'PLANNED')

    if (removeError) throw removeError

    const { error: upsertError } = await supabaseServer
      .from('registration_group_issue_items')
      .upsert(
        userIds.map(userId => {
          const item: any = sourceByUserId.get(userId)
          return {
            issue_id: toIssue.id,
            user_id: userId,
            source: item?.source || 'SEARCH',
            volba: normalizeChoice(item?.volba) || 'MASO',
            status: 'PLANNED',
            remove_reason: null,
            moved_to_issue_id: null,
            removed_at: null,
            removed_by: null,
            added_by: actor.id,
            updated_at: now
          }
        }),
        { onConflict: 'issue_id,user_id' }
      )

    if (upsertError) {
      await supabaseServer
        .from('registration_group_issue_items')
        .update({
          status: 'PLANNED',
          remove_reason: null,
          moved_to_issue_id: null,
          removed_at: null,
          removed_by: null,
          updated_at: now
        })
        .eq('issue_id', fromIssue.id)
        .in('user_id', userIds)

      throw upsertError
    }

    return NextResponse.json({
      ok: true,
      movedCount: userIds.length,
      message: `Presunutych osob: ${userIds.length}.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}
