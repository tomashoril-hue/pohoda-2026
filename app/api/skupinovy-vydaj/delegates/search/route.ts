import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
import { fullName, loadRegistrationGroupPeople, normalizeDate } from '@/lib/registrationGroupIssue'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '')
    .trim()
    .replaceAll('%', '')
    .replaceAll(',', ' ')
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const scope = cleanText(req.nextUrl.searchParams.get('scope')).toUpperCase()
    const query = cleanText(req.nextUrl.searchParams.get('q'))

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    const access = await getGlobalAccess(actor.id)
    const privileged = access.isAdmin || access.isPersonalista
    const manager = await canManageRegistrationGroup(actor.id, registrationGroupId)
    const allowed = privileged || manager

    if (!allowed) {
      return NextResponse.json(
        { error: 'Vyhladavat poverenych moze iba admin alebo manager tejto registracnej skupiny.' },
        { status: 403 }
      )
    }

    if (scope === 'ALL' || scope === 'OUTSIDE') {
      if (!privileged) {
        return NextResponse.json(
          { error: 'Mimo registracnej skupiny moze vyhladavat iba admin alebo personalista.' },
          { status: 403 }
        )
      }

      if (query.length < 3) {
        return NextResponse.json({ users: [] })
      }

      if (!date) {
        return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })
      }

      const groupPeople = await loadRegistrationGroupPeople(registrationGroupId, date)
      const groupUserIds = new Set(groupPeople.map((user: any) => user.id).filter(Boolean))
      const pattern = `%${query}%`
      const { data, error } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, aktivny')
        .eq('aktivny', 'ANO')
        .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern}`)
        .order('priezvisko', { ascending: true })
        .order('meno', { ascending: true })
        .limit(80)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const users = (data || [])
        .filter((user: any) => !groupUserIds.has(user.id))
        .slice(0, 16)
        .map((user: any) => ({
          id: user.id,
          name: fullName(user),
          email: user.email || ''
        }))

      return NextResponse.json({ users })
    }

    if (!date) {
      return NextResponse.json({ error: 'Chyba datum.' }, { status: 400 })
    }

    const groupPeople = await loadRegistrationGroupPeople(registrationGroupId, date)
    const normalizedQuery = query.toLowerCase()
    const filteredPeople = query.length >= 3
      ? groupPeople.filter((user: any) => {
          return [
            user.meno,
            user.priezvisko,
            user.email,
            `${user.priezvisko || ''} ${user.meno || ''}`,
            `${user.meno || ''} ${user.priezvisko || ''}`
          ].join(' ').toLowerCase().includes(normalizedQuery)
        })
      : groupPeople

    const groupUsers = filteredPeople
      .sort((a: any, b: any) => {
        return (
          String(a.priezvisko || '').localeCompare(String(b.priezvisko || ''), 'sk', { sensitivity: 'base' }) ||
          String(a.meno || '').localeCompare(String(b.meno || ''), 'sk', { sensitivity: 'base' }) ||
          String(a.email || '').localeCompare(String(b.email || ''), 'sk', { sensitivity: 'base' })
        )
      })
      .slice(0, 160)
      .map((user: any) => ({
        id: user.id,
        name: fullName(user),
        email: user.email || ''
    }))

    return NextResponse.json({ users: groupUsers })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
