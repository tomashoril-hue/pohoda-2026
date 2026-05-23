import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import ImportClient from './ImportClient'

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export default async function PersonalistaImportPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const globalAccess = await getGlobalAccess(user.id)

  if (!globalAccess.canUsePersonalista) {
    redirect('/dashboard')
  }

  const { data: memberships } = await supabaseServer
    .from('group_members')
    .select(`
      group_id,
      user_id,
      role,
      groups (
        id,
        name
      )
    `)
    .order('created_at', { ascending: true })

  const manageableGroupIds = (memberships || [])
    .filter((membership: any) => {
      const role = String(membership.role || '').toUpperCase()
      return membership.user_id === user.id && role === 'MANAGER'
    })
    .map((membership: any) => membership.group_id)

  let groups: any[] = []

  if (globalAccess.canUsePersonalista) {
    const { data: allGroups } = await supabaseServer
      .from('groups')
      .select('id, name')
      .order('name', { ascending: true })

    groups = allGroups || []
  } else {
    const groupMap = new Map<string, any>()

    ;(memberships || []).forEach((membership: any) => {
      if (!manageableGroupIds.includes(membership.group_id)) return

      const group = Array.isArray(membership.groups)
        ? membership.groups[0]
        : membership.groups

      if (group?.id) {
        groupMap.set(group.id, {
          id: group.id,
          name: group.name || 'Skupina bez nazvu'
        })
      }
    })

    groups = Array.from(groupMap.values()).sort((a, b) => {
      return a.name.localeCompare(b.name, 'sk')
    })
  }

  return (
    <ImportClient
      groups={groups}
      fromDate={isoDateOffset(0)}
      toDate={isoDateOffset(0)}
    />
  )
}
