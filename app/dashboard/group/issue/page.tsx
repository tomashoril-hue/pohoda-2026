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

  const canCreateIssue =
    role === 'MANAGER' ||
    role === 'POVERENY'

  if (!canCreateIssue) {
    redirect('/dashboard')
  }

  const group = Array.isArray(membership.groups)
    ? membership.groups[0]
    : membership.groups

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Hromadný výdaj</div>

        <h1 style={styles.title}>Pripraviť hromadný výdaj</h1>

        <p style={styles.subtitle}>
          Vyberte dátum a typ jedla. Systém automaticky načíta členov skupiny a ich výber jedla.
        </p>

        <div style={styles.infoBox}>
          <p><b>Skupina:</b> {group?.name || 'Skupina bez názvu'}</p>
          <p><b>Vaša rola:</b> {role}</p>
        </div>

        <GroupIssueClient
          myRole={role}
          groupName={group?.name || ''}
        />

        <a href="/dashboard/group" style={styles.back}>
          Späť na skupinu
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
    maxWidth: 760,
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
  subtitle: {
    margin: '14px 0 22px',
    fontSize: 18,
    lineHeight: 1.45,
    fontWeight: 700
  },
  infoBox: {
    marginTop: 20,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18,
    fontSize: 18,
    fontWeight: 700
  },
  back: {
    display: 'block',
    marginTop: 24,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900
  }
}