import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  filterIssuablePeople,
  getIssueAccess,
  loadRegistrationGroupPeople,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

function displayName(user: any) {
  const firstName = cleanText(user?.meno)
  const lastName = cleanText(user?.priezvisko)
  return `${lastName} ${firstName}`.trim() || user?.email || user?.id || 'Bez mena'
}

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
    const scope = cleanText(req.nextUrl.searchParams.get('scope')).toUpperCase()
    const query = cleanText(req.nextUrl.searchParams.get('q')).replaceAll('%', '').replaceAll(',', ' ')

    if (!registrationGroupId || (mode !== 'PICKUP' && (!date || !meal))) {
      return NextResponse.json({ error: 'Chyba registracna skupina, datum alebo jedlo.' }, { status: 400 })
    }

    const isPickupGroupSearch = mode === 'PICKUP' && scope !== 'OUTSIDE'

    if (!isPickupGroupSearch && query.length < 3) {
      return NextResponse.json({ people: [] })
    }

    if (scope === 'OUTSIDE' && !date) {
      return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })
    }

    const access = await getIssueAccess(actor.id, registrationGroupId)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    if (isPickupGroupSearch) {
      if (!date) {
        return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })
      }

      const groupPeopleForPickup = await loadRegistrationGroupPeople(registrationGroupId, date)
      const normalizedQuery = query.toLowerCase()
      const people = groupPeopleForPickup
        .filter((user: any) => {
          return [
            user.meno,
            user.priezvisko,
            user.email,
            `${user.priezvisko || ''} ${user.meno || ''}`,
            `${user.meno || ''} ${user.priezvisko || ''}`
          ].join(' ').toLowerCase().includes(normalizedQuery)
        })
        .sort((a: any, b: any) => {
          return (
            String(a.priezvisko || '').localeCompare(String(b.priezvisko || ''), 'sk', { sensitivity: 'base' }) ||
            String(a.meno || '').localeCompare(String(b.meno || ''), 'sk', { sensitivity: 'base' }) ||
            String(a.email || '').localeCompare(String(b.email || ''), 'sk', { sensitivity: 'base' })
          )
        })
        .map((user: any) => ({
          id: user.id,
          name: displayName(user),
          email: user.email || ''
        }))

      return NextResponse.json({ people })
    }

    const groupPeople = scope === 'OUTSIDE'
      ? await loadRegistrationGroupPeople(registrationGroupId, date)
      : []
    const groupUserIds = new Set(groupPeople.map((user: any) => user.id).filter(Boolean))
    const pattern = `%${query}%`
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
      .eq('aktivny', 'ANO')
      .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern}`)
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })
      .limit(scope === 'OUTSIDE' ? 80 : 16)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (mode === 'PICKUP') {
      return NextResponse.json({
        people: (data || [])
          .filter((user: any) => scope !== 'OUTSIDE' || !groupUserIds.has(user.id))
          .slice(0, 16)
          .map((user: any) => ({
            id: user.id,
            name: displayName(user),
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
