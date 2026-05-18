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

    const { data: existingMemberships, error: existingError } = await supabaseServer
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .in('user_id', userIds)

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const existingUserIds = new Set((existingMemberships || []).map((item: any) => item.user_id))
    const missingUserIds = userIds.filter(userId => !existingUserIds.has(userId))

    if (missingUserIds.length > 0) {
      const { error: insertError } = await supabaseServer
        .from('group_members')
        .insert(missingUserIds.map(userId => ({
          group_id: groupId,
          user_id: userId,
          role: 'MEMBER'
        })))

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
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
      addedCount: missingUserIds.length,
      skippedCount: userIds.length - missingUserIds.length,
      message: `Do skupiny bolo pridaných ${missingUserIds.length} osôb.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}