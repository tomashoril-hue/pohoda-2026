import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'

export default async function PendingApprovalPage() {
  const user = await getSessionUser()

  if (!user) {
    redirect('/')
  }

  const reviewStatus = String(user.review_status || 'APPROVED').toUpperCase()

  if (reviewStatus === 'APPROVED') {
    redirect('/dashboard')
  }

  const rejected = reviewStatus === 'REJECTED'

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <a href="/logout" style={styles.logout}>Odhlásiť sa</a>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>{rejected ? 'Registrácia zamietnutá' : 'Registrácia prijatá'}</div>
        <h1 style={styles.title}>POHODA 2026</h1>
        <p style={styles.status}>
          {rejected
            ? 'Registráciu sa nepodarilo schváliť. Kontaktujte personalistu.'
            : 'Registrácia čaká na schválenie personalistom.'}
        </p>
        <p style={styles.text}>
          Po schválení vám systém automaticky pridelí QR kód a sprístupní aplikáciu.
        </p>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: 24,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 760,
    margin: '0 auto 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  logout: {
    color: '#fff',
    background: '#000',
    borderRadius: 999,
    padding: '10px 16px',
    textDecoration: 'none',
    fontWeight: 900
  },
  card: {
    maxWidth: 680,
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
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  status: {
    marginTop: 24,
    fontSize: 22,
    lineHeight: 1.35,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontWeight: 900
  },
  text: {
    marginBottom: 0,
    fontSize: 17,
    lineHeight: 1.5,
    fontWeight: 700
  }
}
