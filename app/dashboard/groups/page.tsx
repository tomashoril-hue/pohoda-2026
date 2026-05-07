import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import GroupsClient from './GroupsClient'

export default async function GroupsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select(`
      id,
      user_id,
      group_id,
      role,
      created_at,
      groups (
        id,
        name,
        created_at
      ),
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon
      )
    `)
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>
          {error.message}
        </section>
      </main>
    )
  }

  const myMemberships = (memberships || []).filter((membership: any) => {
    return membership.user_id === user.id
  })

  const myGroupIds = myMemberships.map((membership: any) => membership.group_id)

  const groupRoleMap = new Map(
    myMemberships.map((membership: any) => [
      membership.group_id,
      String(membership.role || '').toUpperCase()
    ])
  )

  const visibleMemberships = (memberships || []).filter((membership: any) => {
    return myGroupIds.includes(membership.group_id)
  })

  const groupCounts = new Map<string, number>()

  visibleMemberships.forEach((membership: any) => {
    groupCounts.set(
      membership.group_id,
      (groupCounts.get(membership.group_id) || 0) + 1
    )
  })

  const groups = myMemberships.map((membership: any) => {
    const group = Array.isArray(membership.groups)
      ? membership.groups[0]
      : membership.groups

    const role = groupRoleMap.get(membership.group_id) || ''

    return {
      id: group?.id || membership.group_id,
      name: group?.name || 'Skupina bez názvu',
      role,
      membersCount: groupCounts.get(membership.group_id) || 0,
      canManage: role === 'MANAGER' || role === 'OWNER',
      canIssue: role === 'MANAGER' || role === 'POVERENY' || role === 'OWNER'
    }
  })

  const members = visibleMemberships.map((membership: any) => {
    const memberUser = Array.isArray(membership.users)
      ? membership.users[0]
      : membership.users

    const fullName = `${memberUser?.meno || ''} ${memberUser?.priezvisko || ''}`.trim()

    return {
      id: membership.id,
      groupId: membership.group_id,
      userId: membership.user_id,
      role: String(membership.role || '').toUpperCase(),
      fullName: fullName || memberUser?.email || 'Bez mena',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || ''
    }
  })

  return (
    <GroupsClient
      groups={groups}
      members={members}
    />
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  }
}
