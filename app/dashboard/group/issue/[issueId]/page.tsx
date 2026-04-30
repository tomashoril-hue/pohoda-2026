import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import IssueDetailClient from './IssueDetailClient'

export default async function IssueDetailPage({
  params
}: {
  params: Promise<{ issueId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { issueId } = await params

  const { data: issue, error: issueError } = await supabaseServer
    .from('hromadne_vydaje')
    .select(`
      id,
      group_id,
      datum,
      typ_jedla,
      status,
      valid_after,
      created_by,
      created_by_role,
      created_at,
      groups (
        id,
        name
      )
    `)
    .eq('id', issueId)
    .maybeSingle()

  if (issueError || !issue) {
    redirect('/dashboard/group/issue')
  }

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('group_id', issue.group_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    redirect('/dashboard')
  }

  const myRole = String(membership.role || '').toUpperCase()

  const canOpenIssue =
    myRole === 'MANAGER' ||
    myRole === 'POVERENY'

  if (!canOpenIssue) {
    redirect('/dashboard')
  }

  const { data: itemsData, error: itemsError } = await supabaseServer
    .from('hromadny_vydaj_polozky')
    .select(`
      id,
      user_id,
      source,
      volba,
      status,
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
    .eq('hromadny_vydaj_id', issue.id)
    .neq('status', 'REMOVED')
    .order('created_at', { ascending: true })

  if (itemsError) {
    redirect('/dashboard/group/issue')
  }

  const group = Array.isArray(issue.groups)
    ? issue.groups[0]
    : issue.groups

  const items = (itemsData || []).map((item: any) => {
    const itemUser = Array.isArray(item.users)
      ? item.users[0]
      : item.users

    const fullName = `${itemUser?.meno || ''} ${itemUser?.priezvisko || ''}`.trim()

    return {
      id: item.id,
      userId: item.user_id,
      source: item.source,
      volba: item.volba,
      status: item.status,
      meno: itemUser?.meno || '',
      priezvisko: itemUser?.priezvisko || '',
      fullName: fullName || itemUser?.email || 'Bez mena',
      email: itemUser?.email || '',
      telefon: itemUser?.telefon || '',
      typStravy: itemUser?.typ_stravy || ''
    }
  })

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Hromadný výdaj</div>

        <h1 style={styles.title}>Detail výdaja</h1>

        <IssueDetailClient
          issue={{
            id: issue.id,
            groupId: issue.group_id,
            groupName: group?.name || 'Skupina bez názvu',
            datum: issue.datum,
            typJedla: issue.typ_jedla,
            status: issue.status,
            validAfter: issue.valid_after,
            createdByRole: issue.created_by_role
          }}
          items={items}
          myRole={myRole}
        />

        <a href="/dashboard/group/issue" style={styles.back}>
          Späť na hromadný výdaj
        </a>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  card: {
    maxWidth: 860,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  title: {
    fontSize: 44,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  back: {
    display: 'block',
    marginTop: 24,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900
  }
}