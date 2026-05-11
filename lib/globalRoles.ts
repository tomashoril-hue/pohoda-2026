import { supabaseServer } from '@/lib/supabaseServer'

export type GlobalRole = 'ADMIN' | 'PERSONALISTA'

export type GlobalAccess = {
  roles: GlobalRole[]
  isAdmin: boolean
  isPersonalista: boolean
  canUsePersonalista: boolean
}

export async function getGlobalAccess(userId: string): Promise<GlobalAccess> {
  const { data } = await supabaseServer
    .from('app_user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('active', true)

  const roles = (data || [])
    .map(item => String(item.role || '').toUpperCase())
    .filter((role): role is GlobalRole => role === 'ADMIN' || role === 'PERSONALISTA')

  const isAdmin = roles.includes('ADMIN')
  const isPersonalista = roles.includes('PERSONALISTA')

  return {
    roles,
    isAdmin,
    isPersonalista,
    canUsePersonalista: isAdmin || isPersonalista
  }
}

export function canManageGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return Boolean(access?.isAdmin) || normalized === 'MANAGER' || normalized === 'OWNER'
}

export function canIssueForGroupByRole(role: string, access?: Pick<GlobalAccess, 'isAdmin'>) {
  const normalized = String(role || '').toUpperCase()

  return (
    Boolean(access?.isAdmin) ||
    normalized === 'MANAGER' ||
    normalized === 'POVERENY' ||
    normalized === 'OWNER'
  )
}
