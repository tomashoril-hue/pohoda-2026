import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import InviteBox from './InviteBox'
import MembersManager from './MembersManager'
import LeaveGroupButton from './LeaveGroupButton'

export default async function GroupPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  let group: any = null
  let members: any[] = []

  if (membership) {
    const { data: groupData } = await supabaseServer
      .from('groups')
      .select('*')
      .eq('id', membership.group_id)
      .single()

    group = groupData

    const { data: membersData } = await supabaseServer
      .from('group_members')
      .select(`
        id,
        role,
        created_at,
        user_id,
        users (
          id,
          email,
          meno,
          priezvisko,
          telefon
        )
      `)
      .eq('group_id', membership.group_id)
      .order('created_at', { ascending: true })

    members = membersData || []
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Moja skupina</div>

        <h1 style={styles.title}>Moja skupina</h1>

        {!group && (
          <div style={styles.emptyBox}>
            <p style={styles.subtitle}>Nie ste v žiadnej skupine.</p>

            <a href="/dashboard/group/create" style={styles.buttonLink}>
              Vytvoriť skupinu
            </a>
          </div>
        )}

        {group && (
          <div>
            <div style={styles.infoBox}>
              <p><b>Názov skupiny:</b> {group.name}</p>
              <p><b>Vaša rola:</b> {membership?.role}</p>
            </div>

            <MembersManager
              members={members}
              myRole={membership?.role || ''}
              myUserId={user.id}
            />

            <LeaveGroupButton />

            {membership?.role === 'OWNER' && <InviteBox />}
          </div>
        )}

        <a href="/dashboard" style={styles.back}>
          Späť na dashboard
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
    fontSize: 18,
    fontWeight: 700
  },
  emptyBox: {
    marginTop: 24
  },
  infoBox: {
    marginTop: 24,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18,
    fontSize: 18,
    fontWeight: 700
  },
  buttonLink: {
    display: 'inline-block',
    marginTop: 16,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 22px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  back: {
    display: 'block',
    marginTop: 24,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900
  }
}