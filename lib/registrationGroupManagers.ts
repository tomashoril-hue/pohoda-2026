import { supabaseServer } from '@/lib/supabaseServer'
import type { GlobalAccess } from '@/lib/globalRoles'

export async function getManagedRegistrationGroupIds(userId: string) {
  const { data } = await supabaseServer
    .from('registration_group_managers')
    .select('registration_group_id')
    .eq('user_id', userId)
    .eq('active', true)

  return (data || [])
    .map((item: any) => String(item.registration_group_id || ''))
    .filter(Boolean)
}

export async function canUseGroupIssue(userId: string, access: Pick<GlobalAccess, 'isAdmin'>) {
  if (access.isAdmin) return true

  const managedGroupIds = await getManagedRegistrationGroupIds(userId)

  return managedGroupIds.length > 0
}
