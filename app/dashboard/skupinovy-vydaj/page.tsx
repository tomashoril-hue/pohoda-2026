import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canUseGroupIssue, getDelegatedRegistrationGroupIds, getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { fullName, loadUsersByIds } from '@/lib/registrationGroupIssue'
import { supabaseServer } from '@/lib/supabaseServer'
import SkupinovyVydajClient from './SkupinovyVydajClient'

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

async function loadGroupIssueAccess(userId: string, access: { isAdmin: boolean, isPersonalista: boolean }) {
  const privileged = access.isAdmin || access.isPersonalista
  const [managedIds, delegatedIds, allGroupsResult] = await Promise.all([
    getManagedRegistrationGroupIds(userId),
    getDelegatedRegistrationGroupIds(userId),
    supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('active', true)
      .order('name', { ascending: true })
  ])

  if (allGroupsResult.error) throw allGroupsResult.error

  const allGroups = allGroupsResult.data || []
  const managedSet = new Set(privileged ? allGroups.map((group: any) => group.id) : managedIds)
  const delegatedSet = new Set(delegatedIds)
  const allowedIds = new Set([...Array.from(managedSet), ...Array.from(delegatedSet)])

  const groups = allGroups
    .filter((group: any) => allowedIds.has(group.id))
    .map((group: any) => ({
      id: group.id,
      name: group.name || '',
      canManageDelegates: managedSet.has(group.id),
      canSearchAllDelegates: privileged,
      accessLabel: managedSet.has(group.id) ? 'Manager' : 'Povereny'
    }))

  const managedGroupIds = groups
    .filter(group => group.canManageDelegates)
    .map(group => group.id)

  let delegateRows: any[] = []

  if (managedGroupIds.length > 0) {
    const { data, error } = await supabaseServer
      .from('registration_group_issue_delegates')
      .select(`
        id,
        user_id,
        registration_group_id,
        active,
        note,
        created_at
      `)
      .in('registration_group_id', managedGroupIds)
      .eq('active', true)

    if (!error) {
      delegateRows = data || []
    }
  }

  const delegateUserIds = Array.from(new Set(delegateRows.map((row: any) => row.user_id).filter(Boolean)))
  const delegateUsers = await loadUsersByIds(delegateUserIds)
  const delegateUserById = new Map(delegateUsers.map((user: any) => [user.id, user]))
  const delegatesByGroupId: Record<string, any[]> = {}

  delegateRows.forEach((row: any) => {
    const user: any = delegateUserById.get(row.user_id)
    const item = {
      id: row.id,
      userId: row.user_id,
      registrationGroupId: row.registration_group_id,
      name: fullName(user) || row.user_id,
      email: user?.email || '',
      note: row.note || '',
      createdAt: row.created_at || ''
    }

    delegatesByGroupId[row.registration_group_id] = [
      ...(delegatesByGroupId[row.registration_group_id] || []),
      item
    ]
  })

  Object.values(delegatesByGroupId).forEach(list => {
    list.sort((a: any, b: any) => a.name.localeCompare(b.name, 'sk'))
  })

  return { groups, delegatesByGroupId }
}

export default async function SkupinovyVydajPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  const allowed = await canUseGroupIssue(user.id, access)

  if (!allowed) {
    redirect('/dashboard')
  }

  const groupIssueAccess = await loadGroupIssueAccess(user.id, access)

  return (
    <SkupinovyVydajClient
      initialDate={todayIsoDate()}
      groups={groupIssueAccess.groups}
      delegatesByGroupId={groupIssueAccess.delegatesByGroupId}
    />
  )
}
