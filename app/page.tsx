import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'

export default async function HomePage() {
  const user = await getCurrentUser()

  // 👉 ak je prihlásený → ide rovno na dashboard
  if (user) {
    redirect('/dashboard')
  }

  // 👉 ak NIE JE prihlásený → zobrazí sa úvod
  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Stravovací systém</div>

        <h1 style={styles.title}>POHODA 2026</h1>

        <p style={styles.text}>
          Vyber si svoju stravu, spravuj QR kód a skupiny jednoducho.
        </p>

        <div style={styles.actions}>
          <Link href="/login" style={styles.loginButton}>
            Prihlásiť sa
          </Link>

          <Link href="/register" style={styles.registerButton}>
            Registrovať sa
          </Link>
        </div>

        <p style={styles.note}>
          Ak si už bol prihlásený, systém ťa automaticky presmeruje.
        </p>
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
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 34,
    boxShadow: '12px 12px 0 #000',
    textAlign: 'center'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 22
  },
  title: {
    fontSize: 46,
    margin: 0,
    fontWeight: 950
  },
  text: {
    marginTop: 20,
    fontSize: 19,
    fontWeight: 700
  },
  actions: {
    marginTop: 30,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  loginButton: {
    display: 'block',
    textAlign: 'center',
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 20px',
    fontSize: 18,
    fontWeight: 900,
    textDecoration: 'none'
  },
  registerButton: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 20px',
    fontSize: 18,
    fontWeight: 900,
    textDecoration: 'none'
  },
  note: {
    marginTop: 24,
    fontSize: 14,
    fontWeight: 700,
    opacity: 0.75
  }
}