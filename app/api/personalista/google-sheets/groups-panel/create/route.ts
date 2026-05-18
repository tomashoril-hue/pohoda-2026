import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function normalizeKey(value: any) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
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

    const name = text(body.name)

    if (!name) {
      return NextResponse.json({ error: 'Chyba nazov skupiny.' }, { status: 400 })
    }

    const { data: existingGroups, error: loadError } = await supabaseServer
      .from('groups')
      .select('id, name')

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 })
    }

    const existingGroup = (existingGroups || []).find((group: any) => {
      return normalizeKey(group.name) === normalizeKey(name)
    })

    if (existingGroup) {
      return NextResponse.json({
        ok: true,
        created: false,
        group: existingGroup,
        message: 'Skupina uz existuje.'
      })
    }

    const { data: group, error: insertError } = await supabaseServer
      .from('groups')
      .insert({
        name
      })
      .select('id, name')
      .single()

    if (insertError || !group) {
      return NextResponse.json(
        { error: insertError?.message || 'Skupinu sa nepodarilo vytvorit.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      created: true,
      group,
      message: 'Skupina bola vytvorena.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}