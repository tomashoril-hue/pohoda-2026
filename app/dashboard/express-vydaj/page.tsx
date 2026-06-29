import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { canUseGroupIssue, getDelegatedRegistrationGroupIds, getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'
import ExpressVydajClient from './ExpressVydajClient'

type RegistrationGroupOption = {
  id: string
  name: string
  accessLabel: string
}

async function loadExpressGroups(userId: string, access: { isAdmin: boolean, isPersonalista: boolean }) {
  const privileged = access.isAdmin || access.isPersonalista
  const [managedIds, delegatedIds, groupsResult] = await Promise.all([
    getManagedRegistrationGroupIds(userId),
    getDelegatedRegistrationGroupIds(userId),
    supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('active', true)
      .order('name', { ascending: true })
  ])

  if (groupsResult.error) throw groupsResult.error

  const allGroups = groupsResult.data || []
  const managedSet = new Set(privileged ? allGroups.map((group: any) => group.id) : managedIds)
  const delegatedSet = new Set(delegatedIds)
  const allowedIds = new Set([...Array.from(managedSet), ...Array.from(delegatedSet)])

  return allGroups
    .filter((group: any) => allowedIds.has(group.id))
    .map((group: any): RegistrationGroupOption => ({
      id: group.id,
      name: group.name || '',
      accessLabel: managedSet.has(group.id) ? 'Manager' : 'Poverený'
    }))
}

export default async function ExpressVydajPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)
  const allowed = await canUseGroupIssue(user.id, access)

  if (!allowed) {
    redirect('/dashboard')
  }

  const groups = await loadExpressGroups(user.id, access)

  if (groups.length === 0) {
    redirect('/dashboard')
  }

  const language = await requestLanguage(user)

  return (
    <ExpressVydajClient
      language={language}
      userName={`${user.meno || ''} ${user.priezvisko || ''}`.trim()}
      groups={groups}
    />
  )
}
