import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, canManageGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import GroupDetailClient from './GroupDetailClient'

type Invite = {
  id: string
  email: string
  status: string
  created_at: string
}

export default async function GroupDetailPage({
  params
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { groupId } = await params
  const globalAccess = await getGlobalAccess(user.id)

  const { data: myMembership, error: membershipError } = await supabaseServer
    .from('group_members')
    .select(`
      role,
      group_id,
      groups (
        id,
        name
      )
    `)
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError) {
    redirect('/dashboard/groups')
  }

  const membershipGroup = myMembership?.groups
  let group: any = Array.isArray(membershipGroup)
    ? membershipGroup[0]
    : membershipGroup

  if (!myMembership && globalAccess.isAdmin) {
    const { data: adminGroup } = await supabaseServer
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .maybeSingle()

    group = adminGroup
  }

  if (!myMembership && !globalAccess.isAdmin) {
    redirect('/dashboard/groups')
  }

  if (!group) {
    redirect('/dashboard/groups')
  }

  const myRole = globalAccess.isAdmin
    ? String(myMembership?.role || 'ADMIN').toUpperCase()
    : String(myMembership?.role || '').toUpperCase()

  const canManage = canManageGroupByRole(myRole, globalAccess)
  const canInvite = canManage
  const canIssue = canIssueForGroupByRole(myRole, globalAccess)

  const { data: membersData } = await supabaseServer
    .from('group_members')
    .select(`
      id,
      user_id,
      role,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon,
        aktivny
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  const members = (membersData || []).map(member => {
    const memberUser = Array.isArray(member.users)
      ? member.users[0]
      : member.users

    const fullName = `${memberUser?.meno || ''} ${memberUser?.priezvisko || ''}`.trim()

    return {
      id: member.id,
      userId: member.user_id,
      role: String(member.role || '').toUpperCase(),
      fullName: fullName || memberUser?.email || 'Bez mena',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      aktivny: memberUser?.aktivny || 'ANO',
      isMe: member.user_id === user.id
    }
  })

  let invites: Invite[] = []

  if (canInvite) {
    const { data: invitesData } = await supabaseServer
      .from('group_invites')
      .select('id, email, status, created_at')
      .eq('group_id', groupId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })

    invites = invitesData || []
  }

  return (
    <GroupDetailClient
      group={{
        id: groupId,
        name: group?.name || 'Skupina bez názvu'
      }}
      myRole={myRole}
      members={members}
      invites={invites}
      canManage={canManage}
      canInvite={canInvite}
      canIssue={canIssue}
      canAssignManagers={globalAccess.canUsePersonalista}
    />
  )
}
