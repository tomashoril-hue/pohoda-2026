import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
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
    const query = cleanText(req.nextUrl.searchParams.get('q'))

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    if (query.length < 2) {
      return NextResponse.json({ users: [] })
    }

    const access = await getGlobalAccess(actor.id)
    const allowed = access.isAdmin || await canManageRegistrationGroup(actor.id, registrationGroupId)

    if (!allowed) {
      return NextResponse.json(
        { error: 'Vyhladavat poverenych moze iba admin alebo manager tejto registracnej skupiny.' },
        { status: 403 }
      )
    }

    const pattern = `%${query}%`
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny')
      .eq('aktivny', 'ANO')
      .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern}`)
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })
      .limit(12)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = (data || []).map((user: any) => ({
      id: user.id,
      name: `${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || 'Bez mena',
      email: user.email || ''
    }))

    return NextResponse.json({ users })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
