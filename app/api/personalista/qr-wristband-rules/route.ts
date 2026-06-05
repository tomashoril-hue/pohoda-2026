import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

type QrRuleRangePayload = {
  type_code: string
  series_from: number | null
  series_to: number | null
  active: boolean
  updated_by: string
}

function cleanTypeCode(value: any) {
  const typeCode = String(value || '').trim()
  return /^[0-9]{2}$/.test(typeCode) ? typeCode : ''
}

function cleanSeries(value: any) {
  const text = String(value || '').trim()
  if (!/^[0-9]{1,3}$/.test(text)) return null

  const number = Number(text)
  return Number.isInteger(number) && number >= 1 && number <= 999 ? number : null
}

async function requireAdmin() {
  const actor = await getCurrentUser()

  if (!actor) {
    return {
      error: NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 }),
      actor: null
    }
  }

  const access = await getGlobalAccess(actor.id)

  if (!access.isAdmin) {
    return {
      error: NextResponse.json({ error: 'Tieto pravidla moze upravit iba ADMIN.' }, { status: 403 }),
      actor: null
    }
  }

  return { error: null, actor }
}

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (guard.error) return guard.error

    const [settingsResult, rangesResult] = await Promise.all([
      supabaseServer
        .from('personnel_qr_wristband_settings')
        .select('enabled, updated_at')
        .eq('id', 'DEFAULT')
        .maybeSingle(),
      supabaseServer
        .from('personnel_qr_wristband_ranges')
        .select('id, type_code, series_from, series_to, active')
        .order('type_code', { ascending: true })
    ])

    if (settingsResult.error) {
      return NextResponse.json({ error: settingsResult.error.message }, { status: 500 })
    }

    if (rangesResult.error) {
      return NextResponse.json({ error: rangesResult.error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      enabled: settingsResult.data?.enabled !== false,
      ranges: rangesResult.data || []
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (guard.error) return guard.error
    if (!guard.actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const enabled = body.enabled !== false
    const rawRanges = Array.isArray(body.ranges) ? body.ranges : []
    const ranges: QrRuleRangePayload[] = rawRanges.map((row: any) => {
      return {
        type_code: cleanTypeCode(row.typeCode ?? row.type_code),
        series_from: cleanSeries(row.seriesFrom ?? row.series_from),
        series_to: cleanSeries(row.seriesTo ?? row.series_to),
        active: row.active !== false,
        updated_by: guard.actor!.id
      }
    })

    if (ranges.length === 0) {
      return NextResponse.json({ error: 'Zadaj aspon jedno pravidlo QR.' }, { status: 400 })
    }

    for (const range of ranges) {
      if (!range.type_code || range.series_from === null || range.series_to === null) {
        return NextResponse.json({ error: 'Typ musi mat 2 cislice a seria musi byt 001-999.' }, { status: 400 })
      }

      if (range.series_to < range.series_from) {
        return NextResponse.json({ error: `Typ ${range.type_code}: seria do nemoze byt mensia ako seria od.` }, { status: 400 })
      }
    }

    const duplicateType = ranges.find((range, index) => {
      return ranges.findIndex(item => item.type_code === range.type_code) !== index
    })

    if (duplicateType) {
      return NextResponse.json({ error: `Typ ${duplicateType.type_code} je zadany viackrat.` }, { status: 400 })
    }

    const { data: beforeSettings } = await supabaseServer
      .from('personnel_qr_wristband_settings')
      .select('enabled')
      .eq('id', 'DEFAULT')
      .maybeSingle()

    const { data: beforeRanges } = await supabaseServer
      .from('personnel_qr_wristband_ranges')
      .select('type_code, series_from, series_to, active')
      .order('type_code', { ascending: true })

    const { error: settingsError } = await supabaseServer
      .from('personnel_qr_wristband_settings')
      .upsert({
        id: 'DEFAULT',
        enabled,
        updated_by: guard.actor.id,
        updated_at: new Date().toISOString()
      })

    if (settingsError) {
      return NextResponse.json({ error: settingsError.message }, { status: 500 })
    }

    const { data: existingRows, error: existingError } = await supabaseServer
      .from('personnel_qr_wristband_ranges')
      .select('type_code')

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const nextTypes = new Set(ranges.map(range => range.type_code))
    const inactiveRows = (existingRows || [])
      .filter((row: any) => !nextTypes.has(row.type_code))
      .map((row: any) => ({
        type_code: row.type_code,
        active: false,
        updated_by: guard.actor!.id
      }))

    const { error: rangesError } = await supabaseServer
      .from('personnel_qr_wristband_ranges')
      .upsert([...ranges, ...inactiveRows], { onConflict: 'type_code' })

    if (rangesError) {
      return NextResponse.json({ error: rangesError.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: guard.actor.id,
        action: 'QR_WRISTBAND_RULES_UPDATED',
        entity_table: 'personnel_qr_wristband_ranges',
        entity_id: null,
        before_data: {
          enabled: beforeSettings?.enabled !== false,
          ranges: beforeRanges || []
        },
        after_data: {
          enabled,
          ranges
        }
      })

    return NextResponse.json({
      ok: true,
      message: enabled
        ? 'Pravidla QR naramkov boli ulozene a kontrola je zapnuta.'
        : 'Pravidla QR naramkov boli ulozene, kontrola je vypnuta.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
