import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function escapeHtml(value: any) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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

    const body = await req.json()
    const userId = String(body.userId || '').trim()
    const registrationGroupId = String(body.registrationGroupId || '').trim()
    const registrationGroupNote = String(body.registrationGroupNote || '').trim() || null

    if (!userId || !registrationGroupId) {
      return NextResponse.json({ error: 'Vyber osobu a registračnú skupinu.' }, { status: 400 })
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
    const today = new Date().toISOString().slice(0, 10)
    let registrationPeriodCreated = false
    let emailSent = false

    const { data: currentPeriod, error: currentPeriodError } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id')
      .eq('user_id', userId)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .maybeSingle()

    if (currentPeriodError) {
      return NextResponse.json({ error: currentPeriodError.message }, { status: 500 })
    }

    if (!currentPeriod) {
      const { error: periodError } = await supabaseServer
        .from('user_registration_group_periods')
        .insert({
          user_id: userId,
          registration_group_id: registrationGroupId,
          valid_from: today,
          valid_to: null,
          note: registrationGroupNote,
          created_by: actor.id
        })

      if (periodError) {
        const overlaps = periodError.code === '23P01'
          || periodError.message.toLowerCase().includes('no_overlap')

        if (!overlaps) {
          return NextResponse.json({ error: periodError.message }, { status: 500 })
        }
      } else {
        registrationPeriodCreated = true
      }
    }

    if (user.email && qrCode) {
      try {
        await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: user.email,
          subject: 'Registrácia schválená - POHODA 2026',
          html: `
            <h2>Registrácia bola schválená</h2>
            <p>Dobrý deň, ${escapeHtml(user.meno)} ${escapeHtml(user.priezvisko)},</p>
            <p>Vaša registrácia bola schválená. Môžete používať aplikáciu POHODA PASS.</p>
            <p>Váš QR kód: <b>${escapeHtml(qrCode)}</b></p>
          `
        })
        emailSent = true
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
          qr_assigned: !!qrCode,
          email_sent: emailSent,
          registration_period_created: registrationPeriodCreated
        }
      })

    return NextResponse.json({
      ok: true,
      emailSent,
      message: emailSent
        ? 'Registrácia bola schválená. QR kód bol pridelený a odoslaný e-mailom.'
        : 'Registrácia bola schválená a QR kód bol pridelený. E-mail sa nepodarilo odoslať.'
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznáma chyba servera.' }, { status: 500 })
  }
}
