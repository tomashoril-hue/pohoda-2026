import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { getPublicRegistrationEnabled } from '@/lib/appSettings'
import { requestLanguage } from '@/lib/i18nServer'
import LanguageSwitcher from '@/components/LanguageSwitcher'

export default async function HomePage() {
  const user = await getSessionUser()

  if (user) {
    const reviewStatus = String(user.review_status || 'APPROVED').toUpperCase()
    redirect(reviewStatus === 'APPROVED' ? '/dashboard' : '/pending-approval')
  }

  const language = await requestLanguage()
  const registrationEnabled = await getPublicRegistrationEnabled()
  const isEnglish = language === 'EN'
  const copy = isEnglish
    ? {
      system: 'Meal system',
      subtitle: 'Choose meals, show your QR code and manage groups in one simple app.',
      login: 'Sign in',
      register: 'Register',
      registerDisabled: 'Registration is currently disabled. Sign in if you already have an account.',
      selectionTitle: 'Meal selection',
      selectionText: 'Lunch and dinner clearly organized by day.',
      qrTitle: 'QR identification',
      qrText: 'Fast QR code display and download.',
      groupsTitle: 'Meal groups',
      groupsText: 'Useful for teams, crews and shared meal pickup.',
      note: 'If you are already signed in, the app will redirect you to the dashboard automatically.'
    }
    : {
      system: 'Stravovací systém',
      subtitle: 'Vyber si stravu, zobraz QR kód a spravuj skupiny jednoducho v jednej aplikácii.',
      login: 'Prihlásiť sa',
      register: 'Registrovať sa',
      selectionTitle: 'Výber stravy',
      selectionText: 'Obed a večera prehľadne podľa dní.',
      qrTitle: 'QR identifikácia',
      qrText: 'Rýchle zobrazenie a stiahnutie QR kódu.',
      groupsTitle: 'Stravovacie skupiny',
      groupsText: 'Vhodné pre tímy, partie a spoločné stravovanie.',
      note: 'Ak si už prihlásený, aplikácia ťa automaticky presmeruje na dashboard.'
    }

  const registrationDisabledText = isEnglish
    ? 'Registration is currently disabled. Sign in if you already have an account.'
    : 'Registracia je momentalne vypnuta. Ak uz mas ucet, prihlas sa.'

  return (
    <main className="home-page" style={styles.page}>
      <style>
        {`
          .home-page a[href],
          .home-page button {
            touch-action: manipulation;
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
            -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
          }

          .home-page a[href]:active,
          .home-page button:not(:disabled):active {
            transform: translate(2px, 2px) scale(0.98);
            filter: brightness(0.94);
            box-shadow: 2px 2px 0 #000 !important;
          }

          @media (max-width: 640px) {
            .home-page {
              padding: 14px !important;
            }

            .home-top-bar {
              margin-bottom: 12px !important;
              gap: 10px !important;
            }

            .home-logo {
              height: 42px !important;
              max-width: 190px !important;
            }

            .home-logo-group {
              gap: 0 !important;
            }

            .home-date {
              display: none !important;
            }

            .home-right-tools {
              gap: 7px !important;
            }

            .home-hero-title-row {
              align-items: flex-start !important;
              gap: 10px !important;
            }

            .home-chef-frame {
              width: 46px !important;
              height: 46px !important;
              min-width: 46px !important;
              border-radius: 15px !important;
              box-shadow: 3px 3px 0 #000 !important;
            }

            .home-chef-frame img {
              width: 28px !important;
              height: 28px !important;
            }

            .home-card {
              padding: 20px !important;
              border-radius: 24px !important;
            }

            .home-title {
              font-size: 40px !important;
            }

            .home-system {
              font-size: 22px !important;
            }

            .home-subtitle {
              font-size: 16px !important;
              margin-top: 14px !important;
            }

            .home-action-panel {
              margin-top: 22px !important;
              gap: 10px !important;
            }

            .home-action-panel a {
              padding: 14px 18px !important;
              font-size: 16px !important;
            }

            .home-info-grid {
              margin-top: 20px !important;
              gap: 10px !important;
            }
          }
        `}
      </style>

      <div className="home-top-bar" style={styles.topBar}>
        <div className="home-logo-group" style={styles.logoGroup}>
          <a href="/dashboard" style={styles.logoLink}>
            <img className="home-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
          </a>
          <div className="home-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>

        <div className="home-right-tools" style={styles.rightTools}>
          <LanguageSwitcher language={language} compact />
        </div>
      </div>

      <section className="home-card" style={styles.card}>
        <div className="home-hero-title-row" style={styles.heroTitleRow}>
          <h1 className="home-title" style={styles.title}>POHODA 2026</h1>

          <div className="home-chef-frame" style={styles.chefIconWrap}>
            <img
              src="/kuchar-capica.png"
              alt={copy.system}
              style={styles.chefIcon}
            />
          </div>
        </div>

        <div className="home-system" style={styles.systemTitle}>{copy.system}</div>

        <p className="home-subtitle" style={styles.subtitle}>
          {copy.subtitle}
        </p>

        <div className="home-action-panel" style={styles.actionPanel}>
          <Link href="/login" style={styles.primaryButton}>
            {copy.login}
          </Link>

          {registrationEnabled ? (
            <Link href="/register" style={styles.secondaryButton}>
              {copy.register}
            </Link>
          ) : (
            <span aria-disabled="true" title={registrationDisabledText} style={styles.secondaryButtonDisabled}>
              {copy.register}
            </span>
          )}
        </div>

        {!registrationEnabled && (
          <p style={styles.registrationDisabledNote}>
            {registrationDisabledText}
          </p>
        )}

        <div className="home-info-grid" style={styles.infoGrid}>
          <div style={styles.infoCard}>
            <div style={{ ...styles.infoIcon, ...styles.infoIconGreen }} aria-hidden="true" />

            <div>
              <div style={styles.infoTitle}>{copy.selectionTitle}</div>
              <div style={styles.infoText}>{copy.selectionText}</div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={{ ...styles.infoIcon, ...styles.infoIconPink }} aria-hidden="true" />

            <div>
              <div style={styles.infoTitle}>{copy.qrTitle}</div>
              <div style={styles.infoText}>{copy.qrText}</div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={{ ...styles.infoIcon, ...styles.infoIconPurple }} aria-hidden="true" />

            <div>
              <div style={styles.infoTitle}>{copy.groupsTitle}</div>
              <div style={styles.infoText}>{copy.groupsText}</div>
            </div>
          </div>
        </div>

        <p style={styles.note}>
          {copy.note}
        </p>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 16px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logoLink: {
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none'
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain',
    display: 'block'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  rightTools: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10
  },
  chefIconWrap: {
    width: 56,
    height: 56,
    minWidth: 56,
    borderRadius: 18,
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
    maxWidth: 760,
    margin: '0 auto',
    background: 'rgba(255,255,255,0.97)',
    border: '2px solid rgba(0,0,0,0.92)',
    borderRadius: 34,
    padding: 30,
    boxShadow: '0 18px 46px rgba(0,0,0,0.24)'
  },
  heroTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16
  },
  title: {
    margin: 0,
    fontSize: 52,
    lineHeight: 0.95,
    fontWeight: 950,
    letterSpacing: '-1.5px'
  },
  systemTitle: {
    marginTop: 10,
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 950
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
    border: '3px solid #000',
    borderRadius: 999,
    padding: '17px 22px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none'
  },
  secondaryButton: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '17px 22px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none'
  },
  secondaryButtonDisabled: {
    display: 'block',
    textAlign: 'center',
    background: '#e5e7eb',
    color: '#6b7280',
    border: '3px solid #9ca3af',
    borderRadius: 999,
    padding: '17px 22px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'not-allowed',
    userSelect: 'none'
  },
  registrationDisabledNote: {
    margin: '10px 0 0',
    fontSize: 13,
    fontWeight: 850,
    color: '#6b7280',
    textAlign: 'center'
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
    border: '2px solid #000',
    boxShadow: '3px 3px 0 #000'
  },
  infoIconGreen: {
    background: '#56db3f'
  },
  infoIconPink: {
    background: '#f25be6'
  },
  infoIconPurple: {
    background: '#7417e8'
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
