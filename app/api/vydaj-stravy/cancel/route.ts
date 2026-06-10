import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

async function canCancelIssuedMeal(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)
  return globalAccess.canAdminFoodIssue
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const issuedId = String(body.issuedId || '').trim()
    const issuedIds = Array.isArray(body.issuedIds)
      ? body.issuedIds.map((id: any) => String(id || '').trim()).filter(Boolean)
      : []
    const idsToCancel = Array.from(new Set(issuedIds.length > 0 ? issuedIds : issuedId ? [issuedId] : []))

    if (idsToCancel.length === 0) {
      return NextResponse.json({ error: 'Chýba ID výdaja.' }, { status: 400 })
    }

    const { data: issuedMeals, error: issuedMealError } = await supabaseServer
      .from('vydaj_jedal')
      .select('id, user_id, group_id, hromadny_vydaj_id, registration_group_issue_id, issued_by, status')
      .in('id', idsToCancel)

    if (issuedMealError) {
      return NextResponse.json({ error: issuedMealError.message }, { status: 500 })
    }

    if (!issuedMeals || issuedMeals.length !== idsToCancel.length) {
      return NextResponse.json({ error: 'Výdaj sa nenašiel.' }, { status: 404 })
    }

    if (issuedMeals.some((issuedMeal: any) => issuedMeal.status !== 'VYDANE')) {
      return NextResponse.json({ error: 'Tento výdaj už nie je aktívny.' }, { status: 400 })
    }

    const allowedChecks = await Promise.all(
      issuedMeals.map(() => canCancelIssuedMeal(actor.id))
    )

    if (allowedChecks.some(allowed => !allowed)) {
      return NextResponse.json({ error: 'Nemáš oprávnenie stornovať tento výdaj.' }, { status: 403 })
    }

    const now = new Date().toISOString()

    const { error: updateError } = await supabaseServer
      .from('vydaj_jedal')
      .update({
        status: 'STORNOVANE',
        cancelled_by: actor.id,
        cancelled_at: now
      })
      .in('id', idsToCancel)
      .eq('status', 'VYDANE')

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const issuedMealsByIssue = new Map<string, string[]>()
    const issuedMealsByRegistrationIssue = new Map<string, string[]>()

    issuedMeals.forEach((issuedMeal: any) => {
      if (issuedMeal.hromadny_vydaj_id) {
        issuedMealsByIssue.set(
          issuedMeal.hromadny_vydaj_id,
          [...(issuedMealsByIssue.get(issuedMeal.hromadny_vydaj_id) || []), issuedMeal.user_id]
        )
      }

      if (issuedMeal.registration_group_issue_id) {
        issuedMealsByRegistrationIssue.set(
          issuedMeal.registration_group_issue_id,
          [...(issuedMealsByRegistrationIssue.get(issuedMeal.registration_group_issue_id) || []), issuedMeal.user_id]
        )
      }
    })

    for (const [issueId, userIds] of issuedMealsByIssue.entries()) {
      await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'PLANNED',
          updated_at: now
        })
        .eq('hromadny_vydaj_id', issueId)
        .in('user_id', userIds)
        .in('status', ['BULK_ISSUED', 'INDIVIDUAL_ISSUED'])
    }

    for (const [issueId, userIds] of issuedMealsByRegistrationIssue.entries()) {
      await supabaseServer
        .from('registration_group_issue_items')
        .update({
          status: 'PLANNED',
          updated_at: now
        })
        .eq('issue_id', issueId)
        .in('user_id', userIds)
        .in('status', ['BULK_ISSUED', 'INDIVIDUAL_ISSUED'])
    }

    return NextResponse.json({
      ok: true,
      cancelledCount: idsToCancel.length,
      message: idsToCancel.length > 1 ? 'Výdaje boli stornované.' : 'Výdaj bol stornovaný.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
