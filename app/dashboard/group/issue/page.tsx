import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import GroupIssueClient from './GroupIssueClient'

export default async function GroupIssuePage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: membership, error: membershipError } = await supabaseServer
    .from('group_members')
    .select(`
      group_id,
      role,
      groups (
        id,
        name
      )
    `)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError || !membership) {
    redirect('/dashboard')
  }

  const role = String(membership.role || '').toUpperCase()

  if (role !== 'MANAGER' && role !== 'POVERENY') {
    redirect('/dashboard')
  }

  const group = Array.isArray(membership.groups)
    ? membership.groups[0]
    : membership.groups

  const { data: membersData } = await supabaseServer
    .from('group_members')
    .select(`
      user_id,
      role,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy
      )
    `)
    .eq('group_id', membership.group_id)
    .order('created_at', { ascending: true })

  const members = (membersData || []).map((member: any) => {
    const memberUser = Array.isArray(member.users)
      ? member.users[0]
      : member.users

    const fullName = `${memberUser?.meno || ''} ${memberUser?.priezvisko || ''}`.trim()

    return {
      userId: member.user_id,
      role: member.role,
      fullName: fullName || memberUser?.email || 'Bez mena',
      meno: memberUser?.meno || '',
      priezvisko: memberUser?.priezvisko || '',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      typStravy: memberUser?.typ_stravy || '',
      status: 'PLANNED',
      removeReason: null
    }
  })

  const memberRoleMap = new Map(
    members.map((member: any) => [member.userId, member.role])
  )

  const { data: activeIssuesData } = await supabaseServer
    .from('hromadne_vydaje')
    .select(`
      id,
      datum,
      typ_jedla,
      status,
      valid_after,
      created_at
    `)
    .eq('group_id', membership.group_id)
    .in('status', ['READY', 'WAITING'])
    .order('created_at', { ascending: false })

  const activeIssueIds = (activeIssuesData || []).map((issue: any) => issue.id)

  let activeIssueItems: any[] = []

  if (activeIssueIds.length > 0) {
    const { data: itemsData } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        hromadny_vydaj_id,
        user_id,
        volba,
        status,
        source,
        remove_reason,
        removed_at
      `)
      .in('hromadny_vydaj_id', activeIssueIds)

    const rawItems = itemsData || []
    const userIds = Array.from(new Set(rawItems.map((item: any) => item.user_id).filter(Boolean)))

    let usersMap = new Map<string, any>()

    if (userIds.length > 0) {
      const { data: usersData } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy')
        .in('id', userIds)

      usersMap = new Map((usersData || []).map((u: any) => [u.id, u]))
    }

    activeIssueItems = rawItems.map((item: any) => {
      const itemUser = usersMap.get(item.user_id)
      const fullName = `${itemUser?.meno || ''} ${itemUser?.priezvisko || ''}`.trim()

      return {
        id: item.id,
        issueId: item.hromadny_vydaj_id,
        userId: item.user_id,
        fullName: fullName || itemUser?.email || 'Bez mena',
        meno: itemUser?.meno || '',
        priezvisko: itemUser?.priezvisko || '',
        email: itemUser?.email || '',
        telefon: itemUser?.telefon || '',
        typStravy: item.volba || itemUser?.typ_stravy || '',
        role:
  item.status === 'REMOVED' && item.remove_reason === 'REMOVED_FROM_GROUP'
    ? '-'
    : memberRoleMap.get(item.user_id) || '-',
        status: item.status,
        source: item.source,
        removeReason: item.remove_reason,
        removedAt: item.removed_at
      }
    })
  }

  const activeIssues = (activeIssuesData || []).map((issue: any) => {
    const issueItems = activeIssueItems.filter(
      item => item.issueId === issue.id
    )

    const activeItems = issueItems.filter(
      item => item.status !== 'REMOVED'
    )

    const plannedItems = issueItems.filter(
      item => item.status === 'PLANNED'
    )

    return {
      ...issue,
      userIds: plannedItems.map(item => item.userId),
      peopleCount: activeItems.length,
      items: issueItems
    }
  })

  return (
    <main style={styles.page}>
      <GroupIssueClient
        group={{
          id: membership.group_id,
          name: group?.name || 'Skupina bez názvu'
        }}
        myRole={role}
        members={members}
        activeIssues={activeIssues}
      />
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 0,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  }
}