import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  filterIssuablePeople,
  fullName,
  getIssueAccess,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))
    const mode = cleanText(req.nextUrl.searchParams.get('mode')).toUpperCase()
    const query = cleanText(req.nextUrl.searchParams.get('q')).replaceAll('%', '').replaceAll(',', ' ')

    if (!registrationGroupId || (mode !== 'PICKUP' && (!date || !meal))) {
      return NextResponse.json({ error: 'Chyba registracna skupina, datum alebo jedlo.' }, { status: 400 })
    }

    if (query.length < 3) {
      return NextResponse.json({ people: [] })
    }

    const access = await getIssueAccess(actor.id, registrationGroupId)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const pattern = `%${query}%`
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
      .eq('aktivny', 'ANO')
      .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern}`)
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })
      .limit(16)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (mode === 'PICKUP') {
      return NextResponse.json({
        people: (data || []).map((user: any) => ({
          id: user.id,
          name: fullName(user),
          email: user.email || ''
        }))
      })
    }

    if (!date || !meal) {
      return NextResponse.json({ error: 'Chyba datum alebo jedlo.' }, { status: 400 })
    }

    const people = await filterIssuablePeople({
      users: data || [],
      date,
      meal,
      source: 'SEARCH'
    })

    return NextResponse.json({ people })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
