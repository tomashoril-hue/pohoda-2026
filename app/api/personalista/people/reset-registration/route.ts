import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { cancelFutureFoodEntitlements } from '@/lib/cancelFutureEntitlements'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.isAdmin) {
      return NextResponse.json(
        { error: 'Odregistrovanie pre novu registraciu moze robit iba ADMIN.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const reason = cleanText(body.reason) || 'Odregistrovanie pre novu registraciu.'

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (userId === actor.id) {
      return NextResponse.json(
        { error: 'Nemozes odregistrovat vlastny ucet.' },
        { status: 400 }
      )
    }

    const { data: target, error: targetError } = await supabaseServer
      .from('users')
      .select('id, email, meno, priezvisko')
      .eq('id', userId)
      .maybeSingle()

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 })
    }

    if (!target?.email) {
      return NextResponse.json({ error: 'Osoba alebo email sa nenasli.' }, { status: 404 })
    }

    const { data, error } = await supabaseServer.rpc('reset_user_for_registration', {
      p_email: target.email,
      p_actor_id: actor.id,
      p_reason: reason
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const result = Array.isArray(data) ? data[0] : data
    const cancelledEntitlements = await cancelFutureFoodEntitlements({
      userId,
      actorId: actor.id,
      reason: 'DEREGISTERED'
    })

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_DEREGISTERED_FOR_NEW_REGISTRATION',
        entity_table: 'users',
        entity_id: userId,
        before_data: target,
        after_data: {
          ...(result || {}),
          cancelledFutureEntitlements: {
            fromDate: cancelledEntitlements.fromDate,
            count: cancelledEntitlements.cancelledCount
          }
        },
        note: reason
      })

    return NextResponse.json({
      ok: true,
      message: `Email ${target.email} bol uvolneny pre novu registraciu. Buduce naroky boli zrusene: ${cancelledEntitlements.cancelledCount}.`,
      cancelledFutureEntitlements: cancelledEntitlements.cancelledCount,
      result
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
