import { supabaseServer } from '@/lib/supabaseServer'
import type { GlobalAccess } from '@/lib/globalRoles'

export async function getManagedRegistrationGroupIds(userId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_managers')
    .select('registration_group_id')
    .eq('user_id', userId)
    .eq('active', true)

  if (error) return []

  return (data || [])
    .map((item: any) => String(item.registration_group_id || ''))
    .filter(Boolean)
}

export async function canManageRegistrationGroup(userId: string, registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_managers')
    .select('id')
    .eq('user_id', userId)
    .eq('registration_group_id', registrationGroupId)
    .eq('active', true)
    .limit(1)

  if (error) return false

  return Boolean(data?.length)
}

export async function canUseGroupIssue(userId: string, access: Pick<GlobalAccess, 'isAdmin'>) {
  if (access.isAdmin) return true

  const [managedGroupIds, delegatedGroupIds] = await Promise.all([
    getManagedRegistrationGroupIds(userId),
    getDelegatedRegistrationGroupIds(userId)
  ])

  return managedGroupIds.length > 0 || delegatedGroupIds.length > 0
}

export async function getDelegatedRegistrationGroupIds(userId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issue_delegates')
    .select('registration_group_id')
    .eq('user_id', userId)
    .eq('active', true)

  if (error) return []

  return (data || [])
    .map((item: any) => String(item.registration_group_id || ''))
    .filter(Boolean)
}
