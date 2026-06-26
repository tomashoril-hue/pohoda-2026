import type { CSSProperties } from 'react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { getSessionUser } from '@/lib/auth'
import type { AppLanguage } from '@/lib/i18n'
import { requestLanguage } from '@/lib/i18nServer'
import { redirect } from 'next/navigation'

const pendingCopy: Record<AppLanguage, {
  logout: string
  rejectedBadge: string
  pendingBadge: string
  rejectedStatus: string
  pendingStatus: string
  text: string
}> = {
  SK: {
    logout: 'Odhlásiť sa',
    rejectedBadge: 'Registrácia zamietnutá',
    pendingBadge: 'Registrácia prijatá',
    rejectedStatus: 'Registráciu sa nepodarilo schváliť. Kontaktujte personalistu.',
    pendingStatus: 'Registrácia čaká na schválenie personalistom.',
    text: 'Po schválení vám systém automaticky pridelí QR kód a sprístupní aplikáciu.'
  },
  EN: {
    logout: 'Sign out',
    rejectedBadge: 'Registration rejected',
    pendingBadge: 'Registration received',
    rejectedStatus: 'Your registration could not be approved. Please contact the personnel team.',
    pendingStatus: 'Your registration is waiting for personnel approval.',
    text: 'After approval, the system will automatically assign your QR code and unlock the application.'
  }
}

export default async function PendingApprovalPage() {
  const user = await getSessionUser()

  if (!user) {
    redirect('/')
  }

  const language = await requestLanguage(user)
  const copy = pendingCopy[language]
  const reviewStatus = String(user.review_status || 'APPROVED').toUpperCase()

  if (reviewStatus === 'APPROVED') {
    redirect('/dashboard')
  }

  const rejected = reviewStatus === 'REJECTED'

  return (
    <main className="pending-page" style={styles.page}>
      <style>
        {`
          .pending-page a[href],
          .pending-page button {
            touch-action: manipulation;
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
            -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
          }

          .pending-page a[href]:active,
          .pending-page button:not(:disabled):active {
            transform: translate(2px, 2px) scale(0.98);
            filter: brightness(0.94);
            box-shadow: 2px 2px 0 #000 !important;
          }

          @media (max-width: 520px) {
            .pending-page {
              padding: 12px !important;
            }

            .pending-top-bar {
              margin-bottom: 10px !important;
              gap: 8px !important;
              align-items: flex-start !important;
            }

            .pending-logo {
              height: 38px !important;
              max-width: 172px !important;
            }

            .pending-logo-group {
              gap: 0 !important;
            }

            .pending-date {
              display: none !important;
            }

            .pending-top-controls {
              gap: 6px !important;
            }

            .pending-logout {
              padding: 7px 10px !important;
              border-width: 2px !important;
              font-size: 12px !important;
            }

            .pending-card {
              padding: 16px !important;
              border-radius: 20px !important;
              border-width: 3px !important;
              box-shadow: 6px 6px 0 #000 !important;
            }

            .pending-badge {
              margin-bottom: 10px !important;
              padding: 6px 11px !important;
              border-width: 2px !important;
              font-size: 12px !important;
            }

            .pending-title {
              font-size: 30px !important;
              line-height: 0.95 !important;
            }

            .pending-status {
              margin-top: 14px !important;
              padding: 12px !important;
              border-width: 2px !important;
              border-radius: 15px !important;
              font-size: 16px !important;
              line-height: 1.25 !important;
            }

            .pending-text {
              font-size: 13px !important;
              line-height: 1.35 !important;
            }
          }
        `}
      </style>

      <div className="pending-top-bar" style={styles.topBar}>
        <div className="pending-logo-group" style={styles.logoGroup}>
          <img className="pending-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
          <div className="pending-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>

        <div className="pending-top-controls" style={styles.topControls}>
          <LanguageSwitcher language={language} compact />
          <a className="pending-logout" href="/logout" style={styles.logout}>{copy.logout}</a>
        </div>
      </div>

      <section className="pending-card" style={styles.card}>
        <div className="pending-badge" style={styles.badge}>{rejected ? copy.rejectedBadge : copy.pendingBadge}</div>
        <h1 className="pending-title" style={styles.title}>POHODA 2026</h1>
        <p className="pending-status" style={styles.status}>
          {rejected ? copy.rejectedStatus : copy.pendingStatus}
        </p>
        <p className="pending-text" style={styles.text}>
          {copy.text}
        </p>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: 24,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  topControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10
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
  logout: {
    color: '#fff',
    background: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '9px 15px',
    textDecoration: 'none',
    fontWeight: 900,
    boxShadow: '2px 2px 0 #000'
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
