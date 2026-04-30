import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'

export default async function HomePage() {
  const user = await getCurrentUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />

        <div style={styles.chefIconWrap}>
          <img
            src="/kuchar%20capica.png"
            alt="Stravovanie"
            style={styles.chefIcon}
          />
        </div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Stravovací systém</div>

        <h1 style={styles.title}>POHODA 2026</h1>

        <p style={styles.subtitle}>
          Vyber si stravu, zobraz QR kód a spravuj skupiny jednoducho v jednej aplikácii.
        </p>

        <div style={styles.actionPanel}>
          <Link href="/login" style={styles.primaryButton}>
            Prihlásiť sa
          </Link>

          <Link href="/register" style={styles.secondaryButton}>
            Registrovať sa
          </Link>
        </div>

        <div style={styles.infoGrid}>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🍽️</div>

            <div>
              <div style={styles.infoTitle}>Výber stravy</div>
              <div style={styles.infoText}>
                Obed a večera prehľadne podľa dní.
              </div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>▦</div>

            <div>
              <div style={styles.infoTitle}>QR identifikácia</div>
              <div style={styles.infoText}>
                Rýchle zobrazenie a stiahnutie QR kódu.
              </div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>👥</div>

            <div>
              <div style={styles.infoTitle}>Skupiny</div>
              <div style={styles.infoText}>
                Vhodné pre tímy, partie a hromadný výdaj.
              </div>
            </div>
          </div>
        </div>

        <p style={styles.note}>
          Ak si už prihlásený, aplikácia ťa automaticky presmeruje na dashboard.
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
    objectFit: 'contain',
    display: 'block'
  },
  chefIconWrap: {
    width: 54,
    height: 54,
    minWidth: 54,
    borderRadius: '50%',
    background: '#fff',
    border: '3px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '4px 4px 0 #000'
  },
  chefIcon: {
    width: 34,
    height: 34,
    objectFit: 'contain',
    display: 'block'
  },
  card: {
    maxWidth: 720,
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
  subtitle: {
    margin: '12px 0 28px',
    fontSize: 19,
    lineHeight: 1.45,
    fontWeight: 700
  },
  actionPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  primaryButton: {
    display: 'block',
    textAlign: 'center',
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 19,
    fontWeight: 900,
    textDecoration: 'none'
  },
  secondaryButton: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 19,
    fontWeight: 900,
    textDecoration: 'none'
  },
  infoGrid: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 14
  },
  infoCard: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 15
  },
  infoIcon: {
    width: 40,
    height: 40,
    minWidth: 40,
    borderRadius: 14,
    background: '#56db3f',
    border: '3px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 950,
    marginBottom: 4
  },
  infoText: {
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.3,
    opacity: 0.8
  },
  note: {
    margin: '24px 0 0',
    fontSize: 14,
    fontWeight: 800,
    opacity: 0.72,
    textAlign: 'center'
  }
}