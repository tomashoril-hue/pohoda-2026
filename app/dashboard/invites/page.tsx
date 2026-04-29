import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import InvitesClient from './InvitesClient'

export default async function InvitesPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: invites, error } = await supabaseServer
    .from('group_invites')
    .select(`
      id,
      email,
      status,
      created_at,
      groups (
        name
      )
    `)
    .eq('email', String(user.email || '').toLowerCase())
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Pozvánky</div>

        <h1 style={styles.title}>Moje pozvánky</h1>

        {error && (
          <div style={styles.error}>
            Chyba pri načítaní pozvánok: {error.message}
          </div>
        )}

        <InvitesClient invites={invites || []} />

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
  error: {
    marginTop: 20,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 14,
    fontWeight: 900
  },
  back: {
    display: 'block',
    marginTop: 24,
    textAlign: 'center',
    color: '#000',
    fontWeight: 900
  }
}