import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

export async function canManagePersonAsPersonalista(actorUserId: string, targetUserId: string) {
  const globalAccess = await getGlobalAccess(actorUserId)

  if (globalAccess.canUsePersonalista) {
    return {
      ok: true,
      globalAccess,
      manageableGroupIds: [] as string[]
    }
  }

  const { data: myMemberships, error: myMembershipsError } = await supabaseServer
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', actorUserId)

  if (myMembershipsError) {
    return {
      ok: false,
      error: myMembershipsError.message,
      status: 500,
      globalAccess,
      manageableGroupIds: [] as string[]
    }
  }

  const manageableGroupIds = (myMemberships || [])
    .filter((membership: any) => {
      const role = String(membership.role || '').toUpperCase()
      return role === 'MANAGER' || role === 'OWNER'
    })
    .map((membership: any) => membership.group_id)
    .filter(Boolean)

  if (manageableGroupIds.length === 0) {
    return {
      ok: false,
      error: 'Nemate opravnenie upravovat osoby.',
      status: 403,
      globalAccess,
      manageableGroupIds
    }
  }

  const { data: targetMembership, error: targetMembershipError } = await supabaseServer
    .from('group_members')
    .select('id')
    .eq('user_id', targetUserId)
    .in('group_id', manageableGroupIds)
    .limit(1)
    .maybeSingle()

  if (targetMembershipError) {
    return {
      ok: false,
      error: targetMembershipError.message,
      status: 500,
      globalAccess,
      manageableGroupIds
    }
  }

  if (!targetMembership) {
    return {
      ok: false,
      error: 'Tuto osobu moze upravit iba ADMIN alebo PERSONALISTA.',
      status: 403,
      globalAccess,
      manageableGroupIds
    }
  }

  return {
    ok: true,
    globalAccess,
    manageableGroupIds
  }
}
