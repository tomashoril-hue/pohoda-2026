import { supabaseServer } from '@/lib/supabaseServer'

export type GlobalRole = 'ADMIN' | 'PERSONALISTA' | 'VYDAJ' | 'ADMIN_VYDAJ' | 'GROUP_CREATOR' | 'WRISTBAND_KIOSK' | 'MENU_KIOSK' | 'OFFLINE_OBSLUHA' | 'SAMOSTATNE_OBJEDNAVANIE_STRAVY' | 'ADMIN_REG_SKUPINY'

export type GlobalAccess = {
  roles: GlobalRole[]
  isAdmin: boolean
  isPersonalista: boolean
  isVydaj: boolean
  isAdminVydaj: boolean
  isGroupCreator: boolean
  isWristbandKiosk: boolean
  isMenuKiosk: boolean
  isOfflineObsluha: boolean
  isSelfOrderingMeal: boolean
  isRegistrationGroupAdmin: boolean
  canUsePersonalista: boolean
  canUseFoodIssue: boolean
  canAdminFoodIssue: boolean
  canUseWristbandKiosk: boolean
  canUseMenuKiosk: boolean
  canUseOfflineIssue: boolean
  canPrepareOfflineIssue: boolean
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
      return role === 'ADMIN' || role === 'PERSONALISTA' || role === 'VYDAJ' || role === 'ADMIN_VYDAJ' || role === 'GROUP_CREATOR' || role === 'WRISTBAND_KIOSK' || role === 'MENU_KIOSK' || role === 'OFFLINE_OBSLUHA' || role === 'SAMOSTATNE_OBJEDNAVANIE_STRAVY' || role === 'ADMIN_REG_SKUPINY'
    })

  const isAdmin = roles.includes('ADMIN')
  const isPersonalista = roles.includes('PERSONALISTA')
  const isVydaj = roles.includes('VYDAJ')
  const isAdminVydaj = roles.includes('ADMIN_VYDAJ')
  const isGroupCreator = roles.includes('GROUP_CREATOR')
  const isWristbandKiosk = roles.includes('WRISTBAND_KIOSK')
  const isMenuKiosk = roles.includes('MENU_KIOSK')
  const isOfflineObsluha = roles.includes('OFFLINE_OBSLUHA')
  const isSelfOrderingMeal = roles.includes('SAMOSTATNE_OBJEDNAVANIE_STRAVY')
  const isRegistrationGroupAdmin = roles.includes('ADMIN_REG_SKUPINY')

  return {
    roles,
    isAdmin,
    isPersonalista,
    isVydaj,
    isAdminVydaj,
    isGroupCreator,
    isWristbandKiosk,
    isMenuKiosk,
    isOfflineObsluha,
    isSelfOrderingMeal,
    isRegistrationGroupAdmin,
    canUsePersonalista: isAdmin || isPersonalista,
    canUseFoodIssue: isAdmin || isAdminVydaj || isVydaj,
    canAdminFoodIssue: isAdmin || isAdminVydaj,
    canUseWristbandKiosk: isAdmin || isWristbandKiosk,
    canUseMenuKiosk: isAdmin || isMenuKiosk,
    canUseOfflineIssue: isAdmin || isOfflineObsluha,
    canPrepareOfflineIssue: isAdmin || isOfflineObsluha
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
