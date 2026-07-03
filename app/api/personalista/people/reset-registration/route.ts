import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { cancelFutureFoodEntitlements } from '@/lib/cancelFutureEntitlements'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

async function resetUserWithoutEmail({
  userId,
  actorId,
  reason,
  target
}: {
  userId: string
  actorId: string
  reason: string
  target: any
}) {
  const now = new Date().toISOString()

  const { data: activeQrRows, error: activeQrError } = await supabaseServer
    .from('user_qr_codes')
    .select('qr_code')
    .eq('user_id', userId)
    .eq('active', true)

  if (activeQrError) throw activeQrError

  const activeQrCodes = (activeQrRows || [])
    .map((row: any) => cleanText(row.qr_code))
    .filter(Boolean)

  const { error: roleError } = await supabaseServer
    .from('app_user_roles')
    .update({
      active: false,
      updated_at: now
    })
    .eq('user_id', userId)
    .eq('active', true)

  if (roleError) throw roleError

  const { error: qrHistoryError } = await supabaseServer
    .from('user_qr_codes')
    .update({
      active: false,
      invalidated_by: actorId,
      invalidated_at: now,
      note: 'Zneplatnene pri odregistrovani pouzivatela bez emailu.'
    })
    .eq('user_id', userId)
    .eq('active', true)

  if (qrHistoryError) throw qrHistoryError

  const { count: invalidatedQrCount, error: qrPoolError } = await supabaseServer
    .from('qr_codes')
    .update({
      status: 'NEPLATNY',
      assigned_user_id: userId,
      assigned_at: now
    }, { count: 'exact' })
    .or([
      `assigned_user_id.eq.${userId}`,
      ...activeQrCodes.map(code => `code.eq.${code}`)
    ].join(','))

  if (qrPoolError) throw qrPoolError

  const { error: personnelQrError } = await supabaseServer
    .from('personnel_qr_tokens')
    .update({
      active: false,
      status: 'INVALIDATED',
      invalidated_by: actorId,
      invalidated_at: now,
      updated_at: now,
      note: 'Zneplatnene pri odregistrovani pouzivatela bez emailu.'
    })
    .eq('user_id', userId)
    .eq('active', true)

  if (personnelQrError) throw personnelQrError

  const { error: personnelNfcError } = await supabaseServer
    .from('personnel_nfc_tokens')
    .update({
      active: false,
      status: 'INVALIDATED',
      invalidated_by: actorId,
      invalidated_at: now,
      updated_at: now,
      note: 'Zneplatnene pri odregistrovani pouzivatela bez emailu.'
    })
    .eq('user_id', userId)
    .eq('active', true)

  if (personnelNfcError) throw personnelNfcError

  const { error: workPeriodsError } = await supabaseServer
    .from('personnel_work_periods')
    .update({
      active: false,
      updated_by: actorId,
      updated_at: now
    })
    .eq('user_id', userId)
    .eq('active', true)

  if (workPeriodsError) throw workPeriodsError

  const { count: removedGroupMembershipsCount, error: groupMembersError } = await supabaseServer
    .from('group_members')
    .delete({ count: 'exact' })
    .eq('user_id', userId)

  if (groupMembersError) throw groupMembersError

  const { error: userError } = await supabaseServer
    .from('users')
    .update({
      meno: 'Odregistrovany',
      priezvisko: 'Pouzivatel',
      telefon: null,
      qr_code: null,
      aktivny: 'NIE',
      review_status: 'REJECTED',
      reviewed_by: actorId,
      reviewed_at: now,
      registration_group_id: null,
      registration_group_note: null,
      personal_note: `Odregistrovany bez emailu. ${reason}`,
      updated_at: now
    })
    .eq('id', userId)

  if (userError) throw userError

  return {
    user_id: userId,
    original_email: target.email || null,
    reset_email: null,
    invalidated_qr_count: invalidatedQrCount || activeQrCodes.length,
    removed_group_memberships_count: removedGroupMembershipsCount || 0,
    cancelled_pending_registrations_count: 0
  }
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
      .select('id, email, meno, priezvisko, telefon, qr_code, aktivny, review_status, registration_group_id, registration_group_note')
      .eq('id', userId)
      .maybeSingle()

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 })
    }

    if (!target?.id) {
      return NextResponse.json({ error: 'Osoba sa nenasla.' }, { status: 404 })
    }

    let result: any = null

    if (target.email) {
      const { data, error } = await supabaseServer.rpc('reset_user_for_registration', {
        p_email: target.email,
        p_actor_id: actor.id,
        p_reason: reason
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      result = Array.isArray(data) ? data[0] : data
    } else {
      result = await resetUserWithoutEmail({
        userId,
        actorId: actor.id,
        reason,
        target
      })
    }

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
      message: target.email
        ? `Email ${target.email} bol uvolneny pre novu registraciu. Buduce naroky boli zrusene: ${cancelledEntitlements.cancelledCount}.`
        : `Osoba bez emailu bola odregistrovana. Buduce naroky boli zrusene: ${cancelledEntitlements.cancelledCount}.`,
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
