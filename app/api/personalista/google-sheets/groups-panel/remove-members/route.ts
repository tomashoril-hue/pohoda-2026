import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

const MAX_ROWS = 300

function text(value: any) {
  return String(value || '').trim()
}

function authorized(req: NextRequest, body: any) {
  const expected = process.env.GOOGLE_SHEETS_IMPORT_TOKEN
  const provided = req.headers.get('x-pohoda-token') || body?.token || ''

  return Boolean(expected) && provided === expected
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!authorized(req, body)) {
      return NextResponse.json({ error: 'Neplatny Google Sheets token.' }, { status: 401 })
    }

    const groupId = text(body.groupId || body.group_id)
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : []

    if (!groupId) {
      return NextResponse.json({ error: 'Chyba groupId.' }, { status: 400 })
    }

    const userIds = Array.from(new Set(
      rows.map((row: any) => text(row.userId || row.user_id)).filter(Boolean)
    ))

    if (userIds.length === 0) {
      return NextResponse.json({ error: 'Nie su vybrani ziadni existujuci ludia s user_id.' }, { status: 400 })
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    if (!group) {
      return NextResponse.json({ error: 'Skupina sa nenasla.' }, { status: 404 })
    }

    /**
     * Bezpečnostné pravidlo:
     * Cez Google Sheets odoberáme iba bežných MEMBER členov.
     * OWNER/MANAGER členstvá nechávame nedotknuté.
     */
    const { data: membershipsBefore, error: countError } = await supabaseServer
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .in('user_id', userIds)
      .eq('role', 'MEMBER')

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }

    const removableCount = membershipsBefore?.length || 0

    if (removableCount > 0) {
      const { error: deleteError } = await supabaseServer
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .in('user_id', userIds)
        .eq('role', 'MEMBER')

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }
    }

    const now = new Date().toISOString()

    await supabaseServer
      .from('users')
      .update({ updated_at: now })
      .in('id', userIds)

    return NextResponse.json({
      ok: true,
      group,
      removedCount: removableCount,
      message: `Zo skupiny bolo odobraných ${removableCount} osôb.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}