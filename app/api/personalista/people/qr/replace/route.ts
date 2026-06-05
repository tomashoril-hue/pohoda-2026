import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

async function validateWristbandQrRule(qrCode: string) {
  const { data: settings, error: settingsError } = await supabaseServer
    .from('personnel_qr_wristband_settings')
    .select('enabled')
    .eq('id', 'DEFAULT')
    .maybeSingle()

  if (settingsError) {
    return { ok: false, error: settingsError.message }
  }

  if (settings?.enabled === false) {
    return { ok: true, error: '' }
  }

  if (!/^[0-9]{14}$/.test(qrCode)) {
    return {
      ok: false,
      error: 'QR kod naramku musi mat 14 cislic.'
    }
  }

  const typeCode = qrCode.slice(0, 2)
  const series = Number(qrCode.slice(2, 5))

  const { data: range, error: rangeError } = await supabaseServer
    .from('personnel_qr_wristband_ranges')
    .select('series_from, series_to, active')
    .eq('type_code', typeCode)
    .eq('active', true)
    .maybeSingle()

  if (rangeError) {
    return { ok: false, error: rangeError.message }
  }

  if (!range || series < range.series_from || series > range.series_to) {
    return {
      ok: false,
      error: `QR kod naramku nie je povoleny pre typ ${typeCode} a seriu ${String(series).padStart(3, '0')}.`
    }
  }

  return { ok: true, error: '' }
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

    if (mode !== 'FREE' && mode !== 'SPECIFIC' && mode !== 'RESTORE') {
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

    if (mode === 'SPECIFIC' && qrCode) {
      const ruleValidation = await validateWristbandQrRule(qrCode)

      if (!ruleValidation.ok) {
        return NextResponse.json({ error: ruleValidation.error }, { status: 400 })
      }
    }

    const rpcName =
      mode === 'SPECIFIC'
        ? 'replace_user_qr_any_code'
        : mode === 'RESTORE'
          ? 'restore_last_user_pool_qr'
          : 'replace_user_qr_from_pool'

    const rpcParams =
      mode === 'SPECIFIC'
        ? {
            p_user_id: userId,
            p_qr_code: qrCode,
            p_assigned_by: actor.id,
            p_note: 'QR bol vymeneny za nacitany kod.'
          }
        : mode === 'RESTORE'
          ? {
              p_user_id: userId,
              p_assigned_by: actor.id,
              p_note: 'Obnoveny posledny rezervovany databazovy QR.'
            }
          : {
              p_user_id: userId,
              p_qr_code: null,
              p_assigned_by: actor.id,
              p_note: 'QR bol vymeneny za novy volny kod z qr_codes.'
            }

    const { data: assignedRows, error: assignError } = await supabaseServer
      .rpc(rpcName, rpcParams)

    if (assignError) {
      const alreadyAssigned = String(assignError.message || '').includes('QR_ALREADY_ASSIGNED')

      return NextResponse.json(
        {
          error: alreadyAssigned
            ? 'Tento QR kod uz bol pouzity pri inej osobe.'
            : assignError.message || 'QR kod sa nepodarilo priradit.'
        },
        { status: alreadyAssigned ? 409 : 500 }
      )
    }

    const assignedQr = Array.isArray(assignedRows)
      ? assignedRows[0]
      : assignedRows

    if (!assignedQr) {
      return NextResponse.json(
        {
          error: mode === 'SPECIFIC'
            ? 'Tento QR kod uz bol pouzity pri inej osobe.'
            : mode === 'RESTORE'
              ? 'Osoba nema rezervovany povodny databazovy QR kod na obnovenie.'
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
        action:
          mode === 'SPECIFIC'
            ? 'PERSON_QR_REPLACED_ANY'
            : mode === 'RESTORE'
              ? 'PERSON_QR_RESTORED_POOL'
              : 'PERSON_QR_REPLACED_FREE',
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
        : mode === 'RESTORE'
          ? 'Povodny databazovy QR bol obnoveny.'
          : 'QR bol vymeneny za novy volny kod z databazy.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
