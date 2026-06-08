import { supabaseServer } from '@/lib/supabaseServer'

export type GlobalRole = 'ADMIN' | 'PERSONALISTA' | 'VYDAJ' | 'ADMIN_VYDAJ' | 'GROUP_CREATOR' | 'REG_GROUP_MANAGER'

export type GlobalAccess = {
  roles: GlobalRole[]
  isAdmin: boolean
  isPersonalista: boolean
  isVydaj: boolean
  isAdminVydaj: boolean
  isGroupCreator: boolean
  isRegGroupManager: boolean
  canUsePersonalista: boolean
  canUseFoodIssue: boolean
  canAdminFoodIssue: boolean
  canUseGroupIssue: boolean
}

export async function getGlobalAccess(userId: string): Promise<GlobalAccess> {
  const { data } = await supabaseServer
    .from('app_user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('active', true)

  const roles = (data || [])
    .map(item => String(item.role || '').toUpperCase())
    .filter((role): role is GlobalRole => {
      return role === 'ADMIN' || role === 'PERSONALISTA' || role === 'VYDAJ' || role === 'ADMIN_VYDAJ' || role === 'GROUP_CREATOR' || role === 'REG_GROUP_MANAGER'
    })

  const isAdmin = roles.includes('ADMIN')
  const isPersonalista = roles.includes('PERSONALISTA')
  const isVydaj = roles.includes('VYDAJ')
  const isAdminVydaj = roles.includes('ADMIN_VYDAJ')
  const isGroupCreator = roles.includes('GROUP_CREATOR')
  const isRegGroupManager = roles.includes('REG_GROUP_MANAGER')

  return {
    roles,
    isAdmin,
    isPersonalista,
    isVydaj,
    isAdminVydaj,
    isGroupCreator,
    isRegGroupManager,
    canUsePersonalista: isAdmin || isPersonalista,
    canUseFoodIssue: isAdmin || isAdminVydaj || isVydaj,
    canAdminFoodIssue: isAdmin || isAdminVydaj,
    canUseGroupIssue: isAdmin || isRegGroupManager
  }
}

export function canManageGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return Boolean(access?.isAdmin) || normalized === 'MANAGER'
}

export function canCreateGroup(access?: Pick<GlobalAccess, 'canUsePersonalista' | 'isGroupCreator'>) {
  return Boolean(access?.canUsePersonalista) || Boolean(access?.isGroupCreator)
}

export function canIssueForGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return (
    Boolean(access?.isAdmin) ||
    normalized === 'MANAGER' ||
    normalized === 'POVERENY'
  )
}
