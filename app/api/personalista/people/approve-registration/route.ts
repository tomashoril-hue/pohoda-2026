import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { createQrPngAttachment } from '@/lib/qrEmailAttachment'
import { checkActorRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function escapeHtml(value: any) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function groupIsActive(period: any) {
  const group = Array.isArray(period.registration_groups)
    ? period.registration_groups[0]
    : period.registration_groups

  return group?.active !== false
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemáš oprávnenie.' }, { status: 403 })
    }

    const approveLimit = checkActorRateLimit(actor.id, 'approve-registration-email', 60, 10 * 60 * 1000)
    if (!approveLimit.ok) return rateLimitResponse(approveLimit, 'Príliš veľa schválení. Skúste znova neskôr.')

    const body = await req.json()
    const userId = String(body.userId || '').trim()

    if (!userId) {
      return NextResponse.json({ error: 'Vyber osobu.' }, { status: 400 })
    }

    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, email, meno, priezvisko, review_status')
      .eq('id', userId)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    if (!user) {
      return NextResponse.json({ error: 'Osoba sa nenašla.' }, { status: 404 })
    }

    if (String(user.review_status || '').toUpperCase() !== 'PENDING_REVIEW') {
      return NextResponse.json({ error: 'Osoba už nečaká na schválenie.' }, { status: 409 })
    }

    const { data: periods, error: periodsError } = await supabaseServer
      .from('user_registration_group_periods')
      .select(`
        id,
        registration_group_id,
        valid_from,
        valid_to,
        note,
        registration_groups (
          id,
          name,
          active
        )
      `)
      .eq('user_id', userId)
      .order('valid_from', { ascending: true })

    if (periodsError) {
      return NextResponse.json({ error: periodsError.message }, { status: 500 })
    }

    const boundedPeriods = (periods || []).filter((period: any) => (
      period.registration_group_id &&
      period.valid_from &&
      period.valid_to &&
      period.valid_to >= period.valid_from &&
      groupIsActive(period)
    ))

    if (boundedPeriods.length === 0) {
      return NextResponse.json(
        { error: 'Najprv ulož zaradenie do registračnej skupiny s dátumom od aj do.' },
        { status: 409 }
      )
    }

    const { data: entitlementRows, error: entitlementError } = await supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', userId)

    if (entitlementError) {
      return NextResponse.json({ error: entitlementError.message }, { status: 500 })
    }

    const periodWithEntitlements = boundedPeriods.find((period: any) => (
      (entitlementRows || []).some((entitlement: any) => (
        entitlement.datum >= period.valid_from &&
        entitlement.datum <= period.valid_to &&
        (entitlement.obed || entitlement.vecera)
      ))
    ))

    if (!periodWithEntitlements) {
      return NextResponse.json(
        { error: 'Najprv ulož nároky na stravu pre zadané zaradenie.' },
        { status: 409 }
      )
    }

    const registrationGroupId = periodWithEntitlements.registration_group_id
    const registrationGroupNote = String(periodWithEntitlements.note || '').trim() || null

    const { data: qrRows, error: approveError } = await supabaseServer
      .rpc('approve_registration_user', {
        p_user_id: userId,
        p_actor_id: actor.id,
        p_registration_group_id: registrationGroupId,
        p_registration_group_note: registrationGroupNote
      })

    if (approveError) {
      const message = approveError.message.includes('NO_FREE_QR_AVAILABLE')
        ? 'Nie je dostupný žiadny voľný QR kód.'
        : approveError.message

      return NextResponse.json({ error: message }, { status: 409 })
    }

    const assigned = Array.isArray(qrRows) ? qrRows[0] : qrRows
    const qrCode = assigned?.qr_code || ''
    let emailSent = false

    if (user.email && qrCode) {
      try {
        const qrAttachment = await createQrPngAttachment(qrCode, 'pohodapass-qr')

        const result = await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: user.email,
          subject: 'Registrácia schválená - POHODA 2026',
          html: `
            <h2>Registrácia bola schválená</h2>
            <p>Dobrý deň, ${escapeHtml(user.meno)} ${escapeHtml(user.priezvisko)},</p>
            <p>Vaša registrácia bola schválená. Môžete používať aplikáciu POHODA PASS.</p>
            <p>Váš QR kód: <b>${escapeHtml(qrCode)}</b></p>
          `,
          attachments: qrAttachment ? [qrAttachment] : undefined
        })
        emailSent = true

        const { error: emailLogError } = await supabaseServer.from('personnel_email_log').insert({
          user_id: userId,
          email: user.email,
          type: 'WELCOME_IMPORTED_USER',
          status: 'SENT',
          provider: result.provider,
          provider_message_id: result.messageId || null,
          sent_by: actor.id
        })

        if (emailLogError) {
          console.warn('Failed to store approved registration welcome email log.', emailLogError)
        }
      } catch {
        emailSent = false
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'REGISTRATION_APPROVED',
        entity_table: 'users',
        entity_id: userId,
        after_data: {
          registration_group_id: registrationGroupId,
          registration_period_id: periodWithEntitlements.id,
          registration_period_valid_from: periodWithEntitlements.valid_from,
          registration_period_valid_to: periodWithEntitlements.valid_to,
          qr_assigned: !!qrCode,
          email_sent: emailSent
        }
      })

    return NextResponse.json({
      ok: true,
      emailSent,
      message: emailSent
        ? 'Registrácia bola dokončená. QR kód bol pridelený a odoslaný e-mailom.'
        : 'Registrácia bola dokončená a QR kód bol pridelený. E-mail sa nepodarilo odoslať.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznáma chyba servera.' }, { status: 500 })
  }
}
