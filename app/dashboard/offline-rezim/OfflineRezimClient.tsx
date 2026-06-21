'use client'

import Link from 'next/link'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  clearOfflineIssueData,
  countOfflineOpenConflicts,
  countOfflinePendingEvents,
  getOrCreateOfflineDeviceId,
  listOfflineSnapshots,
  type OfflineSnapshot
} from '@/lib/offlineIssueDb'

type Props = {
  canPrepareOfflineIssue: boolean
  preparedByName: string
}

type OfflineStats = {
  deviceId: string
  snapshots: OfflineSnapshot[]
  pendingEvents: number
  openConflicts: number
}

function dateTimeLabel(value: string) {
  if (!value) return '-'

  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function mealLabel(value: string) {
  if (value === 'OBED') return 'Obed'
  if (value === 'VECERA') return 'Večera'
  return value || '-'
}

export default function OfflineRezimClient({ canPrepareOfflineIssue, preparedByName }: Props) {
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [stats, setStats] = useState<OfflineStats>({
    deviceId: '',
    snapshots: [],
    pendingEvents: 0,
    openConflicts: 0
  })

  const latestSnapshot = stats.snapshots
    .slice()
    .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))[0]

  async function refreshStats() {
    setLoading(true)
    setMessage('')

    try {
      const [deviceId, snapshots, pendingEvents, openConflicts] = await Promise.all([
        getOrCreateOfflineDeviceId(),
        listOfflineSnapshots(),
        countOfflinePendingEvents(),
        countOfflineOpenConflicts()
      ])

      setStats({ deviceId, snapshots, pendingEvents, openConflicts })
    } catch (err: any) {
      setMessage(err?.message || 'Offline úložisko sa nepodarilo načítať.')
    } finally {
      setLoading(false)
    }
  }

  async function clearData() {
    const ok = window.confirm('Vymazať offline dáta z tohto zariadenia? Túto akciu použi až po synchronizácii.')
    if (!ok) return

    try {
      await clearOfflineIssueData()
      await refreshStats()
      setMessage('Offline dáta boli vymazané.')
    } catch (err: any) {
      setMessage(err?.message || 'Offline dáta sa nepodarilo vymazať.')
    }
  }

  useEffect(() => {
    setOnline(navigator.onLine)
    void refreshStats()

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div>
          <div style={styles.kicker}>Offline režim</div>
          <h1 style={styles.title}>Skupinový výdaj offline</h1>
          <p style={styles.subtitle}>Príprava zariadenia, lokálne výdaje a neskoršia synchronizácia.</p>
        </div>
        <Link href="/dashboard" style={styles.backButton}>Späť</Link>
      </section>

      <section style={styles.statusGrid}>
        <article style={online ? styles.statusOnline : styles.statusOffline}>
          <span style={styles.statLabel}>Sieť</span>
          <b>{online ? 'ONLINE' : 'OFFLINE'}</b>
        </article>
        <article style={styles.statusCard}>
          <span style={styles.statLabel}>Snapshoty</span>
          <b>{loading ? '-' : stats.snapshots.length}</b>
        </article>
        <article style={styles.statusCard}>
          <span style={styles.statLabel}>Čaká na sync</span>
          <b>{loading ? '-' : stats.pendingEvents}</b>
        </article>
        <article style={stats.openConflicts > 0 ? styles.statusWarning : styles.statusCard}>
          <span style={styles.statLabel}>Konflikty</span>
          <b>{loading ? '-' : stats.openConflicts}</b>
        </article>
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Toto zariadenie</h2>
            <p style={styles.cardText}>Offline dáta sú uložené iba lokálne v tomto telefóne alebo tablete.</p>
          </div>
          <button type="button" style={styles.lightButton} onClick={refreshStats} disabled={loading}>
            Obnoviť
          </button>
        </div>

        <dl style={styles.metaGrid}>
          <div>
            <dt>ID zariadenia</dt>
            <dd>{stats.deviceId || '-'}</dd>
          </div>
          <div>
            <dt>Prihlásený používateľ</dt>
            <dd>{preparedByName}</dd>
          </div>
        </dl>
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Offline dáta</h2>
            <p style={styles.cardText}>
              Stiahnutie nárokov doplníme v ďalšom kroku. Pripraví ho iba Admin, používať ho bude môcť aj OFFLINE_OBSLUHA.
            </p>
          </div>
        </div>

        {latestSnapshot ? (
          <div style={styles.snapshotBox}>
            <b>{mealLabel(latestSnapshot.mealType)} · {latestSnapshot.mealDate}</b>
            <span>{latestSnapshot.issueLocation || 'Bez názvu výdajného miesta'}</span>
            <span>Stiahnuté: {dateTimeLabel(latestSnapshot.preparedAt)}</span>
            <span>Počet nárokov: {latestSnapshot.entitlementCount}</span>
          </div>
        ) : (
          <div style={styles.emptyBox}>
            Offline dáta zatiaľ nie sú stiahnuté.
          </div>
        )}

        <div style={styles.actions}>
          {canPrepareOfflineIssue && (
            <button type="button" style={styles.primaryButton} disabled>
              Stiahnuť offline dáta
            </button>
          )}
          <button type="button" style={styles.secondaryButton} disabled={stats.pendingEvents === 0}>
            Synchronizovať teraz
          </button>
          <button type="button" style={styles.dangerButton} onClick={clearData} disabled={loading}>
            Vymazať offline dáta
          </button>
        </div>
      </section>

      {message && <div style={styles.message}>{message}</div>}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#f3f4f6',
    color: '#111827',
    padding: 14,
    fontFamily: 'Arial, Helvetica, sans-serif',
    display: 'grid',
    gap: 10,
    alignContent: 'start'
  },
  header: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  kicker: {
    color: '#166534',
    fontSize: 11,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  title: {
    margin: 0,
    color: '#111827',
    fontSize: 26,
    lineHeight: 1.05,
    fontWeight: 950,
    letterSpacing: 0
  },
  subtitle: {
    margin: '4px 0 0 0',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 800
  },
  backButton: {
    minHeight: 36,
    border: '1px solid #111827',
    borderRadius: 6,
    background: '#111827',
    color: '#fff',
    padding: '0 12px',
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 900
  },
  statusGrid: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8
  },
  statusCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    padding: 12,
    display: 'grid',
    gap: 4,
    minHeight: 66
  },
  statusOnline: {
    border: '1px solid #86efac',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 12,
    display: 'grid',
    gap: 4,
    minHeight: 66
  },
  statusOffline: {
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
    padding: 12,
    display: 'grid',
    gap: 4,
    minHeight: 66
  },
  statusWarning: {
    border: '1px solid #fed7aa',
    borderRadius: 8,
    background: '#fff7ed',
    color: '#9a3412',
    padding: 12,
    display: 'grid',
    gap: 4,
    minHeight: 66
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  card: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#fff',
    padding: 14,
    display: 'grid',
    gap: 12
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10
  },
  cardTitle: {
    margin: 0,
    color: '#111827',
    fontSize: 15,
    fontWeight: 950
  },
  cardText: {
    margin: '3px 0 0 0',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.35
  },
  lightButton: {
    minHeight: 36,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#374151',
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 900
  },
  metaGrid: {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  snapshotBox: {
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 12,
    display: 'grid',
    gap: 4,
    fontSize: 12,
    fontWeight: 850
  },
  emptyBox: {
    border: '1px dashed #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#6b7280',
    padding: 14,
    fontSize: 13,
    fontWeight: 900,
    textAlign: 'center'
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
  },
  primaryButton: {
    minHeight: 40,
    border: '1px solid #16a34a',
    borderRadius: 6,
    background: '#22c55e',
    color: '#052e16',
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 950
  },
  secondaryButton: {
    minHeight: 40,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#374151',
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 900
  },
  dangerButton: {
    minHeight: 40,
    border: '1px solid #fecaca',
    borderRadius: 6,
    background: '#fef2f2',
    color: '#991b1b',
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 900
  },
  message: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 12,
    fontSize: 13,
    fontWeight: 900
  }
}
