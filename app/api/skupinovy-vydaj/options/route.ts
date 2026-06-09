import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  choiceSummary,
  filterIssuablePeople,
  getIssueAccess,
  loadRegistrationGroup,
  loadRegistrationGroupPeople,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const registrationGroupId = String(req.nextUrl.searchParams.get('registrationGroupId') || '').trim()
    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))

    if (!registrationGroupId || !date || !meal) {
      return NextResponse.json({ error: 'Chyba registracna skupina, datum alebo jedlo.' }, { status: 400 })
    }

    const access = await getIssueAccess(actor.id, registrationGroupId)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const registrationGroup = await loadRegistrationGroup(registrationGroupId)

    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const groupUsers = await loadRegistrationGroupPeople(registrationGroupId, date)
    const people = await filterIssuablePeople({
      users: groupUsers,
      date,
      meal,
      source: 'REGISTRATION_GROUP'
    })

    return NextResponse.json({
      ok: true,
      access,
      group: {
        id: registrationGroup.id,
        name: registrationGroup.name || ''
      },
      people,
      summary: choiceSummary(people)
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
