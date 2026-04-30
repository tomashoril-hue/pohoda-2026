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
      <div style={styles.bgBlobOne} />
      <div style={styles.bgBlobTwo} />
      <div style={styles.bgGrid} />

      <div style={styles.shell}>
        <header style={styles.topBar}>
          <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />

          <div style={styles.chefIconWrap}>
            <img
              src="/kuchar-capica.png"
              alt="Stravovanie"
              style={styles.chefIcon}
            />
          </div>
        </header>

        <section style={styles.heroCard}>
          <div style={styles.heroBadge}>
            Stravovací systém
          </div>

          <h1 style={styles.title}>
            POHODA 2026
          </h1>

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
                <div style={styles.infoText}>Obed a večera prehľadne podľa dní.</div>
              </div>
            </div>

            <div style={styles.infoCard}>
              <div style={styles.infoIcon}>▦</div>
              <div>
                <div style={styles.infoTitle}>QR identifikácia</div>
                <div style={styles.infoText}>Rýchle zobrazenie a stiahnutie QR kódu.</div>
              </div>
            </div>

            <div style={styles.infoCard}>
              <div style={styles.infoIcon}>👥</div>
              <div>
                <div style={styles.infoTitle}>Skupiny</div>
                <div style={styles.infoText}>Vhodné pre tímy, partie a hromadný výdaj.</div>
              </div>
            </div>
          </div>

          <p style={styles.note}>
            Ak si už prihlásený, aplikácia ťa automaticky presmeruje na dashboard.
          </p>
        </section>
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '22px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  bgBlobOne: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.23)',
    top: -90,
    right: -70,
    filter: 'blur(2px)'
  },
  bgBlobTwo: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: '50%',
    background: 'rgba(86,219,63,0.35)',
    bottom: -70,
    left: -70,
    filter: 'blur(2px)'
  },
  bgGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
    backgroundSize: '42px 42px',
    opacity: 0.22,
    pointerEvents: 'none'
  },
  shell: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 1040,
    margin: '0 auto'
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  chefIconWrap: {
    width: 54,
    height: 54,
    minWidth: 54,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.92)',
    border: '2px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(0,0,0,0.22)'
  },
  chefIcon: {
    width: 34,
    height: 34,
    objectFit: 'contain',
    display: 'block'
  },
  heroCard: {
    maxWidth: 780,
    margin: '0 auto',
    background: 'rgba(255,255,255,0.94)',
    border: '2px solid rgba(0,0,0,0.95)',
    borderRadius: 34,
    padding: 30,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    backdropFilter: 'blur(12px)'
  },
  heroBadge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '9px 15px',
    fontWeight: 950,
    marginBottom: 18,
    boxShadow: '4px 4px 0 #000'
  },
  title: {
    margin: 0,
    fontSize: 54,
    lineHeight: 0.95,
    fontWeight: 950,
    letterSpacing: '-1.5px'
  },
  subtitle: {
    maxWidth: 620,
    margin: '18px 0 0',
    fontSize: 21,
    lineHeight: 1.35,
    fontWeight: 800
  },
  actionPanel: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 14
  },
  primaryButton: {
    display: 'block',
    textAlign: 'center',
    background: '#000',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '17px 22px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '0 12px 24px rgba(0,0,0,0.24)'
  },
  secondaryButton: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '17px 22px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '0 12px 24px rgba(0,0,0,0.16)'
  },
  infoGrid: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 13
  },
  infoCard: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 22,
    padding: 15
  },
  infoIcon: {
    width: 38,
    height: 38,
    minWidth: 38,
    borderRadius: 14,
    background: '#56db3f',
    border: '2px solid #000',
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
    fontWeight: 750,
    lineHeight: 1.3,
    opacity: 0.78
  },
  note: {
    margin: '24px 0 0',
    fontSize: 14,
    fontWeight: 800,
    opacity: 0.72,
    textAlign: 'center'
  }
}