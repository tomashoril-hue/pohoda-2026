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
    const qrCode = cleanText(body.qrCode) || null
    const mode = cleanText(body.mode).toUpperCase()

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (mode !== 'FREE' && mode !== 'SPECIFIC') {
      return NextResponse.json({ error: 'Neplatny sposob priradenia QR.' }, { status: 400 })
    }

    if (mode === 'SPECIFIC' && !qrCode) {
      return NextResponse.json({ error: 'Nacitaj alebo zadaj novy QR kod.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const { data: assignedRows, error: assignError } = await supabaseServer
      .rpc('replace_user_qr_from_pool', {
        p_user_id: userId,
        p_qr_code: mode === 'SPECIFIC' ? qrCode : null,
        p_assigned_by: actor.id,
        p_note: mode === 'SPECIFIC'
          ? 'QR bol vymeneny za konkretny kod z qr_codes.'
          : 'QR bol vymeneny za prvy volny kod z qr_codes.'
      })

    if (assignError) {
      return NextResponse.json(
        { error: assignError.message || 'QR kod sa nepodarilo priradit.' },
        { status: 500 }
      )
    }

    const assignedQr = Array.isArray(assignedRows)
      ? assignedRows[0]
      : assignedRows

    if (!assignedQr) {
      return NextResponse.json(
        {
          error: mode === 'SPECIFIC'
            ? 'Tento QR kod nie je volny v tabulke qr_codes alebo uz bol pouzity.'
            : 'Nie je dostupny ziadny volny QR kod v tabulke qr_codes.'
        },
        { status: 409 }
      )
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: mode === 'SPECIFIC' ? 'PERSON_QR_REPLACED_SPECIFIC' : 'PERSON_QR_REPLACED_FREE',
        entity_table: 'user_qr_codes',
        entity_id: null,
        after_data: {
          mode,
          qr_code_id: assignedQr.qr_code_id
        }
      })

    return NextResponse.json({
      ok: true,
      message: mode === 'SPECIFIC'
        ? 'QR bol vymeneny za nacitany kod.'
        : 'QR bol vymeneny za volny kod zo zoznamu.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
