import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(user.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json(
        { error: 'Prazdne QR moze rezervovat iba ADMIN alebo PERSONALISTA.' },
        { status: 403 }
      )
    }

    const body = await req.json()
    const count = Number(body.count || 0)

    if (!Number.isInteger(count) || count < 1 || count > 200) {
      return NextResponse.json(
        { error: 'Zadaj pocet od 1 do 200.' },
        { status: 400 }
      )
    }

    const { data: rows, error } = await supabaseServer
      .rpc('reserve_blank_qr_codes', {
        p_count: count,
        p_reserved_by: user.id,
        p_note: 'Rezervovane pre tlac prazdnych QR v personalistike.'
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const reservedRows = Array.isArray(rows) ? rows : []

    if (reservedRows.length === 0) {
      return NextResponse.json(
        { error: 'Nie je dostupny ziadny volny QR kod.' },
        { status: 409 }
      )
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: user.id,
        action: 'BLANK_QR_RESERVED',
        entity_table: 'qr_codes',
        after_data: {
          requested_count: count,
          reserved_count: reservedRows.length
        }
      })

    return NextResponse.json({
      ok: true,
      count: reservedRows.length,
      items: reservedRows.map((row: any) => ({
        id: row.qr_code_id,
        qrCode: row.qr_code
      })),
      message: `Rezervovane QR: ${reservedRows.length}.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
