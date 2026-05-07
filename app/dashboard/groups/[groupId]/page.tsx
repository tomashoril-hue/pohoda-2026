import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import InviteBox from '../../group/InviteBox'
import LeaveGroupButton from '../../group/LeaveGroupButton'
import MembersManager from '../../group/MembersManager'
import SentInvites from '../../group/SentInvites'

type SentInvite = {
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

  if (membershipError || !myMembership) {
    redirect('/dashboard/groups')
  }

  const myRole = String(myMembership.role || '').toUpperCase()

  const group = Array.isArray(myMembership.groups)
    ? myMembership.groups[0]
    : myMembership.groups

  const canManage =
    myRole === 'MANAGER' ||
    myRole === 'OWNER'

  const canInvite =
    myRole === 'MANAGER' ||
    myRole === 'POVERENY' ||
    myRole === 'OWNER'

  const canIssue =
    myRole === 'MANAGER' ||
    myRole === 'POVERENY' ||
    myRole === 'OWNER'

  const { data: membersData, error: membersError } = await supabaseServer
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
        typ_stravy,
        qr_code
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  let sentInvites: SentInvite[] = []

  if (canInvite) {
    const { data: invitesData } = await supabaseServer
      .from('group_invites')
      .select(`
        id,
        email,
        status,
        created_at
      `)
      .eq('group_id', groupId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })

    sentInvites = invitesData || []
  }

  const members = membersData || []

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Dashboard / Skupiny / Detail</div>
          <h1 style={styles.title}>{group?.name || 'Skupina bez názvu'}</h1>
          <p style={styles.subtitle}>
            Správa členov, pozvánok a výdaja pre túto skupinu.
          </p>
        </div>

        <Link href="/dashboard/groups" style={styles.darkButton}>
          Skupiny
        </Link>
      </header>

      <section style={styles.summaryBar}>
        <div>
          <span style={styles.label}>Tvoja rola</span>
          <b>{myRole}</b>
        </div>

        <div>
          <span style={styles.label}>Členovia</span>
          <b>{members.length}</b>
        </div>
      </section>

      <section style={styles.actionBar}>
        {canIssue && (
          <a
            href={`/dashboard/groups/${groupId}/issue`}
            style={styles.greenButton}
          >
            Hromadný výdaj
          </a>
        )}

        {canManage && (
          <a
            href={`/dashboard/groups/${groupId}/add-by-qr`}
            style={styles.blueButton}
          >
            Pridať cez QR
          </a>
        )}

        {canManage && (
          <Link
            href="/dashboard/groups"
            style={styles.lightButton}
          >
            Presun členov
          </Link>
        )}
      </section>

      {membersError && (
        <section style={styles.errorBox}>
          {membersError.message}
        </section>
      )}

      <MembersManager
        members={members}
        myRole={myRole}
        myUserId={user.id}
      />

      {canInvite && (
        <>
          <InviteBox groupId={groupId} />
          <SentInvites invites={sentInvites} />
        </>
      )}

      <LeaveGroupButton groupId={groupId} redirectTo="/dashboard/groups" />

      {!canManage && myRole === 'MEMBER' && (
        <section style={styles.notice}>
          Ako člen skupiny môžeš vidieť svoju skupinu a opustiť ju. Správu
          členov, pozvánky a hromadný výdaj rieši poverená osoba alebo manažér.
        </section>
      )}
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.05)'
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 800,
    color: '#6b7280',
    marginBottom: 3
  },
  title: {
    margin: 0,
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  summaryBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10
  },
  label: {
    display: 'block',
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  actionBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    whiteSpace: 'nowrap'
  },
  greenButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  blueButton: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  },
  notice: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    fontSize: 13,
    fontWeight: 850,
    color: '#374151'
  }
}
