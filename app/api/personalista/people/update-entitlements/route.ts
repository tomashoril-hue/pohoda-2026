import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }

  return dates
}

type DayClaim = {
  datum: string
  obed: boolean
  vecera: boolean
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const obed = !!body.obed
    const vecera = !!body.vecera
    const mode = cleanText(body.mode).toUpperCase() || 'SET'
    const requestedDates: string[] = Array.isArray(body.dates)
      ? Array.from(new Set<string>(body.dates.map((date: any) => cleanText(date)).filter(isIsoDate))).sort()
      : []
    const rawDayClaims: DayClaim[] = Array.isArray(body.dayClaims)
      ? body.dayClaims
        .map((item: any) => ({
          datum: cleanText(item?.datum),
          obed: !!item?.obed,
          vecera: !!item?.vecera
        }))
        .filter((item: DayClaim) => isIsoDate(item.datum) && (item.obed || item.vecera))
        .sort((a: DayClaim, b: DayClaim) => a.datum.localeCompare(b.datum))
      : []
    const requestedDayClaims = Array.from(
      rawDayClaims.reduce((map, item) => {
        const existing = map.get(item.datum) || { datum: item.datum, obed: false, vecera: false }
        map.set(item.datum, {
          datum: item.datum,
          obed: existing.obed || item.obed,
          vecera: existing.vecera || item.vecera
        })
        return map
      }, new Map<string, DayClaim>()).values()
    ).sort((a, b) => a.datum.localeCompare(b.datum))
    const validFrom = mode === 'DATES'
      ? cleanText(body.validFrom) || requestedDayClaims[0]?.datum || requestedDates[0] || ''
      : cleanText(body.validFrom)
    const validTo = mode === 'DATES'
      ? cleanText(body.validTo) || requestedDayClaims[requestedDayClaims.length - 1]?.datum || requestedDates[requestedDates.length - 1] || ''
      : cleanText(body.validTo)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (mode !== 'SET' && mode !== 'CLEAR' && mode !== 'DATES') {
      return NextResponse.json({ error: 'Neplatny sposob upravy narokov.' }, { status: 400 })
    }

    if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) {
      return NextResponse.json({ error: 'Zadaj platne obdobie.' }, { status: 400 })
    }

    if (mode === 'SET' && !obed && !vecera) {
      return NextResponse.json({ error: 'Vyber aspon jeden narok.' }, { status: 400 })
    }

    if (mode === 'DATES' && requestedDayClaims.length === 0 && requestedDates.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jeden den v kalendari.' }, { status: 400 })
    }

    const dates = mode === 'DATES'
      ? requestedDayClaims.length > 0
        ? requestedDayClaims.map(item => item.datum)
        : requestedDates
      : dateRange(validFrom, validTo)

    if (dates.length > 370) {
      return NextResponse.json(
        { error: 'Jedna uprava narokov moze mat najviac 370 dni.' },
        { status: 400 }
      )
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const { data: beforeRows } = await supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera, source, note')
      .eq('user_id', userId)
      .gte('datum', validFrom)
      .lte('datum', validTo)

    const now = new Date().toISOString()

    const { error: deleteError } = await supabaseServer
      .from('user_food_entitlements')
      .delete()
      .eq('user_id', userId)
      .gte('datum', validFrom)
      .lte('datum', validTo)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    if (mode === 'SET' || mode === 'DATES') {
      const rows = mode === 'DATES' && requestedDayClaims.length > 0
        ? requestedDayClaims.map(item => ({
          user_id: userId,
          datum: item.datum,
          obed: item.obed,
          vecera: item.vecera,
          source: 'PERSONALISTA',
          note: 'Rucna uprava v personalistike.',
          created_by: actor.id,
          updated_by: actor.id,
          updated_at: now
        }))
        : dates.map(datum => ({
          user_id: userId,
          datum,
          obed,
          vecera,
          source: 'PERSONALISTA',
          note: 'Rucna uprava v personalistike.',
          created_by: actor.id,
          updated_by: actor.id,
          updated_at: now
        }))

      const { error: insertError } = await supabaseServer
        .from('user_food_entitlements')
        .insert(rows)

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    await supabaseServer
      .from('personnel_work_periods')
      .insert({
        user_id: userId,
        valid_from: validFrom,
        valid_to: validTo,
        active: mode !== 'CLEAR',
        source: 'MANUAL',
        note: mode !== 'CLEAR'
          ? 'Rucna uprava narokov v personalistike.'
          : 'Rucne vymazanie narokov v personalistike.',
        created_by: actor.id,
        updated_by: actor.id
      })

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: mode === 'CLEAR' ? 'PERSON_ENTITLEMENTS_CLEARED' : 'PERSON_ENTITLEMENTS_UPDATED',
        entity_table: 'user_food_entitlements',
        entity_id: null,
        before_data: {
          rows: beforeRows || []
        },
        after_data: {
          valid_from: validFrom,
          valid_to: validTo,
          mode,
          days: dates.length,
          obed,
          vecera,
          day_claims: requestedDayClaims
        }
      })

    return NextResponse.json({
      ok: true,
      days: dates.length,
      lunches: mode === 'DATES' && requestedDayClaims.length > 0
        ? requestedDayClaims.filter(item => item.obed).length
        : mode !== 'CLEAR' && obed ? dates.length : 0,
      dinners: mode === 'DATES' && requestedDayClaims.length > 0
        ? requestedDayClaims.filter(item => item.vecera).length
        : mode !== 'CLEAR' && vecera ? dates.length : 0,
      message: mode === 'CLEAR' ? 'Naroky v obdobi boli vymazane.' : 'Naroky boli ulozene.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
