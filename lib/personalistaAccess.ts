import { getGlobalAccess } from '@/lib/globalRoles'

export async function canManagePersonAsPersonalista(actorUserId: string, _targetUserId: string) {
  const globalAccess = await getGlobalAccess(actorUserId)

  if (globalAccess.canUsePersonalista) {
    return {
      ok: true,
      globalAccess,
      manageableGroupIds: [] as string[]
    }
  }

  return {
    ok: false,
    error: 'Tuto osobu moze upravit iba ADMIN alebo PERSONALISTA.',
    status: 403,
    globalAccess,
    manageableGroupIds: [] as string[]
  }
}
