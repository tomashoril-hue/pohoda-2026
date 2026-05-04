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
      typStravy: memberUser?.typ_stravy || ''
    }
  })

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
      .select('id, hromadny_vydaj_id, user_id, status')
      .in('hromadny_vydaj_id', activeIssueIds)
      .neq('status', 'REMOVED')

    activeIssueItems = itemsData || []
  }

  const activeIssues = (activeIssuesData || []).map((issue: any) => {
    const issueItems = activeIssueItems.filter(
      item => item.hromadny_vydaj_id === issue.id
    )

    return {
      ...issue,
      userIds: issueItems.map(item => item.user_id),
      peopleCount: issueItems.length
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