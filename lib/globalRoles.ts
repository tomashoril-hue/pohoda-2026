import { supabaseServer } from '@/lib/supabaseServer'

export type GlobalRole = 'ADMIN' | 'PERSONALISTA' | 'VYDAJ' | 'ADMIN_VYDAJ'

export type GlobalAccess = {
  roles: GlobalRole[]
  isAdmin: boolean
  isPersonalista: boolean
  isVydaj: boolean
  isAdminVydaj: boolean
  canUsePersonalista: boolean
  canUseFoodIssue: boolean
  canAdminFoodIssue: boolean
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
      return role === 'ADMIN' || role === 'PERSONALISTA' || role === 'VYDAJ' || role === 'ADMIN_VYDAJ'
    })

  const isAdmin = roles.includes('ADMIN')
  const isPersonalista = roles.includes('PERSONALISTA')
  const isVydaj = roles.includes('VYDAJ')
  const isAdminVydaj = roles.includes('ADMIN_VYDAJ')

  return {
    roles,
    isAdmin,
    isPersonalista,
    isVydaj,
    isAdminVydaj,
    canUsePersonalista: isAdmin || isPersonalista,
    canUseFoodIssue: isAdmin || isAdminVydaj || isVydaj,
    canAdminFoodIssue: isAdmin || isAdminVydaj
  }
}

export function canManageGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return Boolean(access?.isAdmin) || normalized === 'MANAGER'
}

export function canCreateGroupByRole(role: string, access?: Pick<GlobalAccess, 'canUsePersonalista'>) {
  const normalized = String(role || '').toUpperCase()

  return Boolean(access?.canUsePersonalista) || normalized === 'MANAGER'
}

export function canIssueForGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return (
    Boolean(access?.isAdmin) ||
    normalized === 'MANAGER' ||
    normalized === 'POVERENY'
  )
}
