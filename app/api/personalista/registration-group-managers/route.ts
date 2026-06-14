import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export async function GET() {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemas opravnenie.' }, { status: 403 })
    }

    const [groupsResult, managersResult] = await Promise.all([
      supabaseServer
        .from('registration_groups')
        .select('id, name, active')
        .eq('active', true)
        .order('name', { ascending: true }),
      supabaseServer
        .from('registration_group_managers')
        .select(`
          id,
          user_id,
          registration_group_id,
          created_at
        `)
        .eq('active', true)
    ])

    if (groupsResult.error) {
      return NextResponse.json({ error: groupsResult.error.message }, { status: 500 })
    }

    if (managersResult.error) {
      return NextResponse.json({ error: managersResult.error.message }, { status: 500 })
    }

    const managerRows = managersResult.data || []
    const managerUserIds = Array.from(new Set(
      managerRows
        .map((row: any) => row.user_id)
        .filter(Boolean)
    ))

    const usersResult = managerUserIds.length
      ? await supabaseServer
          .from('users')
          .select('id, meno, priezvisko, email, telefon, aktivny')
          .in('id', managerUserIds)
      : { data: [], error: null }

    if (usersResult.error) {
      return NextResponse.json({ error: usersResult.error.message }, { status: 500 })
    }

    const usersById = new Map((usersResult.data || []).map((user: any) => [user.id, user]))
    const managersByGroupId = new Map<string, any[]>()

    managerRows.forEach((row: any) => {
      const user = usersById.get(row.user_id)
      const registrationGroupId = row.registration_group_id

      if (!registrationGroupId || !user?.id) return

      const list = managersByGroupId.get(registrationGroupId) || []
      list.push({
        id: row.id,
        userId: row.user_id,
        fullName: fullName(user) || user.email || 'Bez mena',
        email: user.email || '',
        telefon: user.telefon || '',
        aktivny: user.aktivny || '',
        createdAt: row.created_at || ''
      })
      managersByGroupId.set(registrationGroupId, list)
    })

    const groups = (groupsResult.data || []).map((group: any) => {
      const managers = (managersByGroupId.get(group.id) || [])
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))

      return {
        id: group.id,
        name: group.name || '',
        managers,
        managerCount: managers.length
      }
    })

    return NextResponse.json({
      ok: true,
      groups,
      totalGroups: groups.length,
      totalManagers: groups.reduce((sum: number, group: any) => sum + group.managerCount, 0)
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
