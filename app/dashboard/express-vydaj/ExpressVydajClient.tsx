'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { appText, type AppLanguage } from '@/lib/i18n'

type RegistrationGroupOption = {
  id: string
  name: string
  accessLabel: string
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="M3.5 10.8 12 3.8l8.5 7v9.1a.9.9 0 0 1-.9.9h-5.1v-6.2h-5v6.2H4.4a.9.9 0 0 1-.9-.9v-9.1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M2.5 11.6 12 3.8l9.5 7.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ExpressVydajClient({
  language = 'SK',
  userName,
  groups
}: {
  language?: AppLanguage
  userName: string
  groups: RegistrationGroupOption[]
}) {
  const router = useRouter()
  const copy = appText(language)
  const isEnglish = language === 'EN'
  const t = (sk: string, en: string) => isEnglish ? en : sk
  const [groupId, setGroupId] = useState(groups[0]?.id || '')
  const selectedGroup = useMemo(
    () => groups.find(group => group.id === groupId) || groups[0] || null,
    [groupId, groups]
  )

  return (
    <main className="express-page" style={styles.page}>
      <style>{`
        .express-page button,
        .express-page select {
          touch-action: manipulation;
          transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease, background 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .express-page button:not(:disabled):active,
        .express-page select:not(:disabled):active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @media (max-width: 560px) {
          .express-page { padding: 10px !important; }
          .express-top { margin-bottom: 8px !important; gap: 8px !important; align-items: flex-start !important; }
          .express-logo { height: 38px !important; max-width: 172px !important; }
          .express-date { display: none !important; }
          .express-user { font-size: 10px !important; padding: 4px 7px !important; max-width: min(70vw, 300px) !important; }
          .express-card { padding: 14px !important; border-radius: 16px !important; }
          .express-title { font-size: 28px !important; line-height: 1 !important; }
        }
      `}</style>

      <div className="express-top" style={styles.topBar}>
        <div style={styles.logoGroup}>
          <div style={styles.logoStack}>
            <img className="express-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
            <div className="express-user" style={styles.userBadge}>
              {t('Prihlásený:', 'Signed in:')} <b>{userName || '-'}</b>
            </div>
          </div>
          <div className="express-date" style={styles.date}>8. &amp; 9. - 11. 7. 2026</div>
        </div>
        <button type="button" onClick={() => router.push('/dashboard')} style={styles.homeButton} title={copy.backToDashboard} aria-label={copy.backToDashboard}>
          <HomeIcon />
        </button>
      </div>

      <section className="express-card" style={styles.card}>
        <div>
          <h1 className="express-title" style={styles.title}>{t('Express výdaj', 'Express issue')}</h1>
          <div style={styles.subtitle}>
            {t('Zatiaľ je ponechaný iba výber registračnej skupiny podľa oprávnení.', 'For now, only registration group selection is enabled according to permissions.')}
          </div>
        </div>

        <section style={styles.groupPanel}>
          <div style={styles.groupPanelHeader}>
            <div>
              <div style={styles.fieldLabel}>{t('Registračná skupina', 'Registration group')}</div>
              <div style={styles.groupCount}>
                {groups.length === 1
                  ? t('Máš dostupnú jednu skupinu.', 'You have one available group.')
                  : `${groups.length} ${t('dostupných skupín', 'available groups')}`}
              </div>
            </div>
            {selectedGroup?.accessLabel && <span style={styles.accessBadge}>{selectedGroup.accessLabel}</span>}
          </div>

          {groups.length > 1 ? (
            <select
              value={groupId}
              onChange={event => setGroupId(event.target.value)}
              style={styles.select}
            >
              {groups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          ) : (
            <div style={styles.singleGroupBox}>{selectedGroup?.name || '-'}</div>
          )}
        </section>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 48%, #56db3f 100%)',
    padding: 18,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#141414'
  },
  topBar: {
    maxWidth: 760,
    margin: '0 auto 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  logoStack: {
    display: 'grid',
    gap: 5,
    minWidth: 0
  },
  logo: {
    height: 50,
    maxWidth: 238,
    objectFit: 'contain',
    filter: 'drop-shadow(0 2px 10px rgba(0, 0, 0, 0.22))'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontWeight: 900,
    fontSize: 14
  },
  userBadge: {
    border: '1px solid #d7d3e8',
    borderRadius: 999,
    background: '#fff',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 850,
    width: 'fit-content',
    maxWidth: 'min(78vw, 420px)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  homeButton: {
    color: '#1f2937',
    background: '#fff',
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    width: 38,
    height: 38,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'Arial, Helvetica, sans-serif',
    boxShadow: '0 6px 14px rgba(31, 24, 61, 0.14)'
  },
  card: {
    maxWidth: 760,
    margin: '0 auto',
    background: 'rgba(255, 255, 255, 0.97)',
    border: '1px solid #ded8f2',
    borderRadius: 20,
    padding: 16,
    boxShadow: '0 18px 44px rgba(31, 24, 61, 0.26)',
    display: 'grid',
    gap: 14
  },
  title: {
    fontSize: 34,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: 900,
    color: '#5b5870',
    lineHeight: 1.35
  },
  groupPanel: {
    border: '1px solid #e1deea',
    borderRadius: 16,
    background: '#fbfbfd',
    padding: 12,
    display: 'grid',
    gap: 10
  },
  groupPanelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    color: '#5b5870'
  },
  groupCount: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: 850,
    color: '#6b667c'
  },
  accessBadge: {
    border: '1px solid #ddd6fe',
    borderRadius: 999,
    background: '#f5f3ff',
    color: '#5b21b6',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  select: {
    width: '100%',
    minHeight: 44,
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    background: '#fff',
    padding: '9px 10px',
    fontSize: 15,
    fontWeight: 900,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#211b35'
  },
  singleGroupBox: {
    minHeight: 44,
    border: '1px solid #d7d3e8',
    borderRadius: 12,
    background: '#fff',
    padding: '11px 10px',
    fontSize: 15,
    fontWeight: 950,
    color: '#211b35'
  }
}
