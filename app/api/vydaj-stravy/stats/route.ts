import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

type FoodChoice = 'MASO' | 'VEGE' | 'DIETA' | 'NEZADANE'

function normalizeDate(value: any) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeChoice(value: any): FoodChoice {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'
  return 'NEZADANE'
}

function isNoInterestChoice(value: any) {
  return String(value || '').trim().toUpperCase() === 'BEZ_ZAUJMU'
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }

  return result
}

async function fetchAll(buildQuery: (from: number, to: number) => any) {
  const pageSize = 1000
  const rows: any[] = []
  let from = 0

  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1)

    if (error) throw new Error(error.message)

    const page = data || []
    rows.push(...page)

    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function issuerAccess(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)

  return {
    canUse: globalAccess.canUseFoodIssue
  }
}

function emptyStats() {
  return {
    total: 0,
    issued: 0,
    MASO: { total: 0, issued: 0 },
    VEGE: { total: 0, issued: 0 },
    DIETA: { total: 0, issued: 0 },
    NEZADANE: { total: 0, issued: 0 }
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const datum = normalizeDate(searchParams.get('datum'))

    if (!datum) {
      return NextResponse.json({ error: 'Chýba dátum.' }, { status: 400 })
    }

    const access = await issuerAccess(actor.id)

    if (!access.canUse) {
      return NextResponse.json({ error: 'Nemáš oprávnenie vydávať stravu.' }, { status: 403 })
    }

    const stats: Record<'OBED' | 'VECERA', ReturnType<typeof emptyStats>> = {
      OBED: emptyStats(),
      VECERA: emptyStats()
    }

    const issuedRows = await fetchAll((from, to) => supabaseServer
      .from('vydaj_jedal')
      .select('user_id, typ_jedla, volba')
      .eq('datum', datum)
      .eq('status', 'VYDANE')
      .in('typ_jedla', ['OBED', 'VECERA'])
      .range(from, to)
    )

    issuedRows.forEach((row: any) => {
      const meal = String(row.typ_jedla || '').toUpperCase()
      if (meal !== 'OBED' && meal !== 'VECERA') return

      const issuedChoice = normalizeChoice(row.volba)

      stats[meal].issued += 1
      stats[meal][issuedChoice].issued += 1
    })

    let userIds: string[] = []

    let entitlementRows: any[] = []

    entitlementRows = await fetchAll((from, to) => supabaseServer
      .from('user_food_entitlements')
      .select('user_id, obed, vecera')
      .eq('datum', datum)
      .range(from, to)
    )
    userIds = Array.from(new Set(entitlementRows.map((row: any) => row.user_id).filter(Boolean)))

    if (userIds.length === 0) {
      return NextResponse.json({
        ok: true,
        stats
      })
    }

    const usersRows: any[] = []
    const selectionRows: any[] = []

    for (const userIdChunk of chunks(userIds, 400)) {
      const users = await fetchAll((from, to) => supabaseServer
        .from('users')
        .select('id, typ_stravy, aktivny')
        .in('id', userIdChunk)
        .range(from, to)
      )

      const selections = await fetchAll((from, to) => supabaseServer
        .from('vyber_jedal')
        .select('user_id, typ_jedla, volba')
        .eq('datum', datum)
        .in('user_id', userIdChunk)
        .range(from, to)
      )

      usersRows.push(...users)
      selectionRows.push(...selections)
    }

    const userMap = new Map(usersRows.map((row: any) => [row.id, row]))
    const selectionMap = new Map(
      selectionRows.map((row: any) => [`${row.user_id}|${row.typ_jedla}`, row])
    )

    entitlementRows.forEach((entitlement: any) => {
      const user = userMap.get(entitlement.user_id)

      if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') return

      ;(['OBED', 'VECERA'] as const).forEach(meal => {
        const hasEntitlement = meal === 'OBED' ? entitlement.obed === true : entitlement.vecera === true
        if (!hasEntitlement) return

        const selection = selectionMap.get(`${entitlement.user_id}|${meal}`)
        if (isNoInterestChoice(selection?.volba)) return

        const choice = normalizeChoice(selection?.volba || user.typ_stravy)

        stats[meal].total += 1
        stats[meal][choice].total += 1
      })
    })

    return NextResponse.json({
      ok: true,
      stats
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
