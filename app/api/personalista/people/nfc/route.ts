import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
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

    const body = await req.json()
    const userId = cleanText(body.userId)
    const tokenUid = cleanText(body.tokenUid)
    const action = cleanText(body.action).toUpperCase()

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (action !== 'ASSIGN' && action !== 'INVALIDATE') {
      return NextResponse.json({ error: 'Neplatna NFC akcia.' }, { status: 400 })
    }

    if (action === 'ASSIGN' && !tokenUid) {
      return NextResponse.json({ error: 'Nacitaj alebo zadaj NFC kod.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const now = new Date().toISOString()

    const { data: activeBefore } = await supabaseServer
      .from('personnel_nfc_tokens')
      .select('id, token_uid, user_id, status, active')
      .eq('user_id', userId)
      .eq('active', true)

    if (action === 'INVALIDATE') {
      const { error: invalidateError } = await supabaseServer
        .from('personnel_nfc_tokens')
        .update({
          active: false,
          status: 'INVALIDATED',
          invalidated_at: now,
          invalidated_by: actor.id,
          updated_at: now,
          note: cleanText(body.note) || 'NFC zneplatnene v personalistike.'
        })
        .eq('user_id', userId)
        .eq('active', true)

      if (invalidateError) {
        return NextResponse.json({ error: invalidateError.message }, { status: 500 })
      }

      await supabaseServer
        .from('personnel_audit_log')
        .insert({
          actor_user_id: actor.id,
          target_user_id: userId,
          action: 'PERSON_NFC_INVALIDATED',
          entity_table: 'personnel_nfc_tokens',
          entity_id: null,
          before_data: { rows: activeBefore || [] },
          after_data: { active: false }
        })

      return NextResponse.json({ ok: true, message: 'NFC bolo zneplatnene.' })
    }

    const { data: existingToken, error: existingError } = await supabaseServer
      .from('personnel_nfc_tokens')
      .select('id, token_uid, user_id, active')
      .eq('token_uid', tokenUid)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    if (existingToken?.active && existingToken.user_id && existingToken.user_id !== userId) {
      return NextResponse.json(
        { error: 'Tento NFC kod je uz aktivne priradeny inej osobe.' },
        { status: 409 }
      )
    }

    const { error: deactivateError } = await supabaseServer
      .from('personnel_nfc_tokens')
      .update({
        active: false,
        status: 'REPLACED',
        invalidated_at: now,
        invalidated_by: actor.id,
        updated_at: now,
        note: 'Nahradene novym NFC kodom.'
      })
      .eq('user_id', userId)
      .eq('active', true)

    if (deactivateError) {
      return NextResponse.json({ error: deactivateError.message }, { status: 500 })
    }

    let tokenId = existingToken?.id || null

    if (existingToken) {
      const { error: updateError } = await supabaseServer
        .from('personnel_nfc_tokens')
        .update({
          user_id: userId,
          status: 'ASSIGNED',
          active: true,
          assigned_at: now,
          assigned_by: actor.id,
          invalidated_at: null,
          invalidated_by: null,
          updated_at: now,
          note: cleanText(body.note) || 'NFC priradene v personalistike.'
        })
        .eq('id', existingToken.id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    } else {
      const { data: insertedToken, error: insertError } = await supabaseServer
        .from('personnel_nfc_tokens')
        .insert({
          token_uid: tokenUid,
          user_id: userId,
          status: 'ASSIGNED',
          active: true,
          assigned_at: now,
          assigned_by: actor.id,
          note: cleanText(body.note) || 'NFC priradene v personalistike.'
        })
        .select('id')
        .single()

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      tokenId = insertedToken?.id || null
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_NFC_ASSIGNED',
        entity_table: 'personnel_nfc_tokens',
        entity_id: tokenId,
        before_data: { rows: activeBefore || [] },
        after_data: {
          token_uid: tokenUid,
          token_id: tokenId
        }
      })

    return NextResponse.json({ ok: true, message: 'NFC bolo priradene.' })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
