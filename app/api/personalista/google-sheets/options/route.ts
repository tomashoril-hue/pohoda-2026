import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

function authorized(req: NextRequest, body: any) {
  const expected = process.env.GOOGLE_SHEETS_IMPORT_TOKEN
  const provided = req.headers.get('x-pohoda-token') || body?.token || ''

  return Boolean(expected) && provided === expected
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    if (!authorized(req, body)) {
      return NextResponse.json({ error: 'Neplatny Google Sheets token.' }, { status: 401 })
    }

    const { data: groups, error } = await supabaseServer
      .from('groups')
      .select('id, name')
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      groups: (groups || []).map(group => ({
        id: group.id,
        name: group.name || 'Skupina bez nazvu'
      })),
      foodTypes: ['MASO', 'VEGE', 'DIETA'],
      yesNo: ['ANO', 'NIE'],
      statuses: ['READY', 'OK', 'ERROR', 'LOCKED']
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
