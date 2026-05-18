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

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const validFrom = cleanText(body.validFrom)
    const validTo = cleanText(body.validTo)
    const obed = !!body.obed
    const vecera = !!body.vecera
    const mode = cleanText(body.mode).toUpperCase() || 'SET'

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) {
      return NextResponse.json({ error: 'Zadaj platne obdobie.' }, { status: 400 })
    }

    if (mode !== 'SET' && mode !== 'CLEAR') {
      return NextResponse.json({ error: 'Neplatny sposob upravy narokov.' }, { status: 400 })
    }

    if (mode === 'SET' && !obed && !vecera) {
      return NextResponse.json({ error: 'Vyber aspon jeden narok.' }, { status: 400 })
    }

    const dates = dateRange(validFrom, validTo)

    if (dates.length > 120) {
      return NextResponse.json(
        { error: 'Jedna uprava narokov moze mat najviac 120 dni.' },
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

    if (mode === 'SET') {
      const { error: insertError } = await supabaseServer
        .from('user_food_entitlements')
        .insert(dates.map(datum => ({
          user_id: userId,
          datum,
          obed,
          vecera,
          source: 'PERSONALISTA',
          note: 'Rucna uprava v personalistike.',
          created_by: actor.id,
          updated_by: actor.id,
          updated_at: now
        })))

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
        active: mode === 'SET',
        source: 'MANUAL',
        note: mode === 'SET'
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
        action: mode === 'SET' ? 'PERSON_ENTITLEMENTS_UPDATED' : 'PERSON_ENTITLEMENTS_CLEARED',
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
          vecera
        }
      })

    return NextResponse.json({
      ok: true,
      days: dates.length,
      lunches: mode === 'SET' && obed ? dates.length : 0,
      dinners: mode === 'SET' && vecera ? dates.length : 0,
      message: mode === 'SET' ? 'Naroky boli ulozene.' : 'Naroky v obdobi boli vymazane.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
