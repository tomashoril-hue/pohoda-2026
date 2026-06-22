'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  applyOfflineSyncResults,
  clearOfflineIssueData,
  clearOfflineOperatorPin,
  countOfflineOpenConflicts,
  countOfflinePendingEvents,
  getOfflinePinState,
  getOrCreateOfflineDeviceId,
  listOfflinePendingEvents,
  listOfflineSnapshots,
  saveOfflineSnapshotPayload,
  setOfflineOperatorPin,
  type OfflineSnapshot,
  type OfflineSnapshotPayload
} from '@/lib/offlineIssueDb'

type Props = {
  canPrepareOfflineIssue: boolean
  preparedByName: string
}

type OfflineStats = {
  deviceId: string
  snapshots: OfflineSnapshot[]
  pendingEvents: number
  localOpenConflicts: number
  pinEnabled: boolean
}

type DownloadState = {
  active: boolean
  percent: number
  label: string
}

type ServerConflict = {
  id: string
  offlineEventId: string
  deviceId: string
  qrCode: string
  personName: string
  mealDate: string
  mealType: string
  issueLocation: string
  conflictType: string
  message: string
  status: 'OPEN' | 'RESOLVED'
  createdAt: string
  resolvedAt: string
  resolvedByName: string
  resolutionNote: string
}

function bratislavaTodayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value || ''
  const month = parts.find(part => part.type === 'month')?.value || ''
  const day = parts.find(part => part.type === 'day')?.value || ''

  return `${year}-${month}-${day}`
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

function latestSnapshotsByMeal(snapshots: OfflineSnapshot[]) {
  const latestByKey = new Map<string, OfflineSnapshot>()

  snapshots.forEach(snapshot => {
    const key = `${snapshot.mealDate}|${snapshot.mealType}`
    const existing = latestByKey.get(key)

    if (!existing || snapshot.preparedAt.localeCompare(existing.preparedAt) > 0) {
      latestByKey.set(key, snapshot)
    }
  })

  return Array.from(latestByKey.values())
    .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))
}

function foodCountLabel(summary?: { MASO?: number; VEGE?: number; DIETA?: number }) {
  if (!summary) return ''
  return [
    `MASO ${summary.MASO || 0}`,
    `VEGE ${summary.VEGE || 0}`,
    `DIÉTA ${summary.DIETA || 0}`
  ].join(' / ')
}

function conflictTypeLabel(value: string) {
  if (value === 'CONFLICT_DUPLICATE_ISSUE') return 'Duplicitný výdaj'
  if (value === 'CONFLICT_CANCEL_WITHOUT_ACTIVE_ISSUE') return 'Storno bez aktívneho výdaja'
  if (value === 'CONFLICT_INVALID_ENTITLEMENT') return 'Neplatný nárok'
  if (value === 'CONFLICT_INVALID_EVENT') return 'Neplatná offline udalosť'
  if (value === 'CONFLICT_ALREADY_CANCELLED') return 'Už stornované'
  return value || 'Konflikt'
}

export default function OfflineRezimClient({ canPrepareOfflineIssue, preparedByName }: Props) {
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [pinValue, setPinValue] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [snapshotDate, setSnapshotDate] = useState(() => bratislavaTodayIsoDate())
  const [snapshotMeal, setSnapshotMeal] = useState<'OBED' | 'VECERA'>('OBED')
  const [issueLocation, setIssueLocation] = useState('Hlavné výdajné miesto')
  const [download, setDownload] = useState<DownloadState>({
    active: false,
    percent: 0,
    label: ''
  })
  const [stats, setStats] = useState<OfflineStats>({
    deviceId: '',
    snapshots: [],
    pendingEvents: 0,
    localOpenConflicts: 0,
    pinEnabled: false
  })
  const [serverConflicts, setServerConflicts] = useState<ServerConflict[]>([])
  const [conflictsLoading, setConflictsLoading] = useState(false)
  const [resolvingId, setResolvingId] = useState('')

  const latestSnapshot = useMemo(() => {
    return stats.snapshots
      .slice()
      .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))[0]
  }, [stats.snapshots])
  const visibleSnapshots = useMemo(() => {
    return latestSnapshotsByMeal(stats.snapshots)
  }, [stats.snapshots])

  async function refreshStats() {
    setLoading(true)
    setMessage('')

    try {
      const [deviceId, snapshots, pendingEvents, localOpenConflicts, pinState] = await Promise.all([
        getOrCreateOfflineDeviceId(),
        listOfflineSnapshots(),
        countOfflinePendingEvents(),
        countOfflineOpenConflicts(),
        getOfflinePinState()
      ])

      setStats({ deviceId, snapshots, pendingEvents, localOpenConflicts, pinEnabled: pinState.enabled })
      setSyncNotice(navigator.onLine && pendingEvents > 0
        ? 'Po návrate internetu sa čakajúce offline udalosti automaticky zosynchronizujú.'
        : ''
      )
    } catch (err: any) {
      setMessage(err?.message || 'Offline úložisko sa nepodarilo načítať.')
    } finally {
      setLoading(false)
    }
  }

  async function loadServerConflicts() {
    if (!online) return

    setConflictsLoading(true)

    try {
      const response = await fetch('/api/offline/conflicts?status=OPEN&limit=80', {
        method: 'GET',
        cache: 'no-store'
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Konflikty sa nepodarilo načítať.')
      }

      setServerConflicts(data.items || [])
    } catch (err: any) {
      setMessage(err?.message || 'Konflikty sa nepodarilo načítať.')
    } finally {
      setConflictsLoading(false)
    }
  }

  async function resolveConflict(conflictId: string) {
    if (!conflictId || resolvingId) return

    const note = window.prompt('Poznámka k vyriešeniu konfliktu:', 'Skontrolované manažérom.')
    if (note === null) return

    setResolvingId(conflictId)

    try {
      const response = await fetch('/api/offline/conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conflictId, note })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Konflikt sa nepodarilo označiť ako vyriešený.')
      }

      setServerConflicts(prev => prev.filter(item => item.id !== conflictId))
      setMessage('Konflikt bol označený ako vyriešený.')
    } catch (err: any) {
      setMessage(err?.message || 'Konflikt sa nepodarilo vyriešiť.')
    } finally {
      setResolvingId('')
    }
  }

  async function downloadSnapshot() {
    if (!canPrepareOfflineIssue || download.active) return

    if (!online) {
      setMessage('Offline dáta sa dajú stiahnuť iba pri online pripojení.')
      return
    }

    setMessage('')
    setDownload({ active: true, percent: 5, label: 'Pripravujem stiahnutie.' })

    try {
      const pendingEvents = await listOfflinePendingEvents()

      if (pendingEvents.length > 0) {
        setDownload({ active: false, percent: 0, label: '' })
        setMessage('Najprv zosynchronizuj čakajúce offline výdaje. Potom stiahni novú offline zálohu.')
        return
      }

      const deviceId = stats.deviceId || await getOrCreateOfflineDeviceId()
      setDownload({ active: true, percent: 15, label: 'Načítavam dáta zo servera.' })

      const params = new URLSearchParams({
        date: snapshotDate,
        meal: snapshotMeal,
        issueLocation,
        deviceId
      })
      const response = await fetch(`/api/offline/snapshot?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store'
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Offline dáta sa nepodarilo stiahnuť.')
      }

      const payload: OfflineSnapshotPayload = {
        snapshot: data.snapshot,
        entitlements: data.entitlements || [],
        qrCodes: data.qrCodes || [],
        pickupUsers: data.pickupUsers || []
      }

      setDownload({ active: true, percent: 45, label: 'Ukladám dáta do zariadenia.' })
      await saveOfflineSnapshotPayload(payload, (percent, label) => {
        setDownload({
          active: true,
          percent: Math.min(99, 45 + Math.round(percent * 0.5)),
          label
        })
      })

      await refreshStats()
      setDownload({ active: false, percent: 100, label: 'Hotovo.' })
      const byChoiceText = foodCountLabel(data.counts?.peopleByChoice)
      const issuedText = data.counts?.issuedPeople
        ? ` Už vydané v čase stiahnutia: ${data.counts.issuedPeople}.`
        : ''
      setMessage(
        `Offline dáta sú uložené. Osoby: ${data.counts?.totalPeople ?? payload.snapshot.entitlementCount}${byChoiceText ? ` (${byChoiceText})` : ''}, technické záznamy: ${data.counts?.entitlementRows ?? payload.entitlements.length}, QR kódy: ${payload.qrCodes.length}.${issuedText}`
      )
    } catch (err: any) {
      setDownload({ active: false, percent: 0, label: '' })
      setMessage(err?.message || 'Offline dáta sa nepodarilo pripraviť.')
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

  async function savePin() {
    try {
      await setOfflineOperatorPin(pinValue)
      setPinValue('')
      await refreshStats()
      setMessage('Lokálny PIN pre obsluhu bol uložený.')
    } catch (err: any) {
      setMessage(err?.message || 'PIN sa nepodarilo uložiť.')
    }
  }

  async function removePin() {
    try {
      await clearOfflineOperatorPin()
      await refreshStats()
      setMessage('Lokálny PIN bol zrušený.')
    } catch (err: any) {
      setMessage(err?.message || 'PIN sa nepodarilo zrušiť.')
    }
  }

  async function syncOfflineEvents(mode: 'manual' | 'auto' = 'manual') {
    if (!online || syncing || stats.pendingEvents === 0) return

    setSyncing(true)
    setMessage('')
    setSyncNotice(mode === 'auto'
      ? 'Internet je späť. Automaticky synchronizujem offline udalosti.'
      : 'Synchronizujem offline udalosti.'
    )

    try {
      const events = await listOfflinePendingEvents()
      if (events.length === 0) {
        await refreshStats()
        setSyncNotice('')
        if (mode === 'manual') setMessage('Nie sú žiadne čakajúce offline udalosti.')
        return
      }

      const response = await fetch('/api/offline/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Synchronizácia sa nepodarila.')
      }

      await applyOfflineSyncResults(data.results || [])
      await refreshStats()
      await loadServerConflicts()

      setMessage(
        `Synchronizácia hotová. Úspešné: ${data.syncedCount || 0}, konflikty: ${data.conflictCount || 0}, na opakovanie: ${data.retryCount || 0}.`
      )
      setSyncNotice('')
    } catch (err: any) {
      setMessage(err?.message || 'Synchronizácia sa nepodarila.')
      setSyncNotice('Synchronizácia zlyhala. Čakajúce udalosti ostali uložené v zariadení.')
    } finally {
      setSyncing(false)
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

  useEffect(() => {
    if (online) {
      void loadServerConflicts()
    }
  }, [online])

  useEffect(() => {
    if (!online || stats.pendingEvents === 0 || syncing) {
      setSyncNotice('')
      return
    }

    setSyncNotice('Internet je dostupný. Spúšťam automatickú synchronizáciu.')
    const timeoutId = window.setTimeout(() => {
      void syncOfflineEvents('auto')
    }, 1200)

    return () => window.clearTimeout(timeoutId)
  }, [online, stats.pendingEvents, syncing])

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div>
          <div style={styles.kicker}>Offline režim</div>
          <h1 style={styles.title}>Správa offline dát</h1>
          <p style={styles.subtitle}>Stiahnutie databázy, synchronizácia, konflikty a lokálny PIN. Výdaj prebieha cez hlavnú obrazovku Výdaj stravy.</p>
        </div>
        <div style={styles.headerActions}>
          <Link href="/dashboard/vydaj-stravy" style={styles.primaryLink}>Výdaj stravy</Link>
          <Link href="/dashboard" style={styles.backButton}>Späť</Link>
        </div>
      </section>

      <section style={styles.statusGrid}>
        <article style={online ? styles.statusOnline : styles.statusOffline}>
          <span style={styles.statLabel}>Sieť</span>
          <b>{online ? 'ONLINE' : 'OFFLINE'}</b>
        </article>
        <article style={styles.statusCard}>
          <span style={styles.statLabel}>Snapshoty</span>
          <b>{loading ? '-' : visibleSnapshots.length}</b>
        </article>
        <article style={styles.statusCard}>
          <span style={styles.statLabel}>Čaká na sync</span>
          <b>{loading ? '-' : stats.pendingEvents}</b>
        </article>
        <article style={stats.localOpenConflicts + serverConflicts.length > 0 ? styles.statusWarning : styles.statusCard}>
          <span style={styles.statLabel}>Konflikty</span>
          <b>{loading ? '-' : stats.localOpenConflicts + serverConflicts.length}</b>
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
            <h2 style={styles.cardTitle}>Stiahnuť offline dáta</h2>
            <p style={styles.cardText}>Stiahne sa snapshot pre zvolený dátum a jedlo vrátane individuálnych nárokov, pripravených skupinových výdajov, aktívnych QR kódov a náramkov.</p>
          </div>
        </div>

        {canPrepareOfflineIssue ? (
          <div style={styles.formGrid}>
            <label style={styles.fieldLabel}>
              Dátum
              <input
                type="date"
                value={snapshotDate}
                onChange={event => setSnapshotDate(event.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.fieldLabel}>
              Jedlo
              <select
                value={snapshotMeal}
                onChange={event => setSnapshotMeal(event.target.value as 'OBED' | 'VECERA')}
                style={styles.input}
              >
                <option value="OBED">Obed</option>
                <option value="VECERA">Večera</option>
              </select>
            </label>
            <label style={styles.fieldLabel}>
              Zariadenie / miesto
              <input
                type="text"
                value={issueLocation}
                onChange={event => setIssueLocation(event.target.value)}
                style={styles.input}
                maxLength={80}
              />
            </label>
          </div>
        ) : (
          <div style={styles.emptyBox}>Tento používateľ nemá oprávnenie pripraviť offline databázu.</div>
        )}

        {latestSnapshot ? (
          <div style={styles.snapshotBox}>
            <b>{mealLabel(latestSnapshot.mealType)} · {latestSnapshot.mealDate}</b>
            <span>{latestSnapshot.issueLocation || 'Bez názvu výdajného miesta'}</span>
            <span>Stiahnuté: {dateTimeLabel(latestSnapshot.preparedAt)}</span>
            <span>Počet osôb: {latestSnapshot.entitlementCount}</span>
          </div>
        ) : (
          <div style={styles.emptyBox}>Offline dáta zatiaľ nie sú stiahnuté.</div>
        )}

        {download.active && (
          <div style={styles.progressWrap}>
            <div style={styles.progressHeader}>
              <b>{download.percent}%</b>
              <span>{download.label}</span>
            </div>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: `${download.percent}%` }} />
            </div>
          </div>
        )}

        <div style={styles.actions}>
          {canPrepareOfflineIssue && (
            <button
              type="button"
              style={styles.primaryButton}
              onClick={downloadSnapshot}
              disabled={download.active || !online || !snapshotDate}
            >
              Stiahnuť offline dáta
            </button>
          )}
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() => syncOfflineEvents('manual')}
            disabled={!online || syncing || stats.pendingEvents === 0}
          >
            Synchronizovať teraz
          </button>
          <button type="button" style={styles.dangerButton} onClick={clearData} disabled={loading || download.active}>
            Vymazať offline dáta
          </button>
        </div>

        {syncNotice && <div style={styles.syncNotice}>{syncNotice}</div>}
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Snapshoty v zariadení</h2>
            <p style={styles.cardText}>Výdaj stravy používa najnovší snapshot pre zvolený dátum a jedlo.</p>
          </div>
        </div>

        {visibleSnapshots.length === 0 ? (
          <div style={styles.emptyBox}>V zariadení nie je uložený žiadny snapshot.</div>
        ) : (
          <div style={styles.snapshotList}>
            {visibleSnapshots.map(snapshot => (
                <div key={snapshot.snapshotId} style={styles.snapshotRow}>
                  <b>{mealLabel(snapshot.mealType)} · {snapshot.mealDate}</b>
                  <span>{snapshot.issueLocation || 'Bez miesta'}</span>
                  <span>{snapshot.entitlementCount} osôb · Aktualizované {dateTimeLabel(snapshot.preparedAt)}</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Konflikty synchronizácie</h2>
            <p style={styles.cardText}>Konflikt nezastaví synchronizáciu. Manažér ho po kontrole označí ako vyriešený.</p>
          </div>
          <button type="button" style={styles.lightButton} onClick={loadServerConflicts} disabled={!online || conflictsLoading}>
            {conflictsLoading ? 'Načítavam...' : 'Obnoviť konflikty'}
          </button>
        </div>

        {serverConflicts.length === 0 ? (
          <div style={styles.emptyBox}>{online ? 'Nie sú otvorené serverové konflikty.' : 'Konflikty servera sa dajú načítať iba online.'}</div>
        ) : (
          <div style={styles.conflictList}>
            {serverConflicts.map(conflict => (
              <article key={conflict.id} style={styles.conflictItem}>
                <div>
                  <b>{conflictTypeLabel(conflict.conflictType)}</b>
                  <span>{conflict.message || 'Bez detailu'}</span>
                </div>
                <div style={styles.conflictMeta}>
                  <span>{conflict.personName || conflict.qrCode || 'Bez osoby'}</span>
                  <span>{mealLabel(conflict.mealType)} · {conflict.mealDate}</span>
                  <span>{conflict.issueLocation || conflict.deviceId}</span>
                  <span>{dateTimeLabel(conflict.createdAt)}</span>
                </div>
                <button
                  type="button"
                  style={styles.warningButton}
                  onClick={() => resolveConflict(conflict.id)}
                  disabled={resolvingId === conflict.id}
                >
                  {resolvingId === conflict.id ? 'Ukladám...' : 'Označiť vyriešené'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Lokálny PIN obsluhy</h2>
            <p style={styles.cardText}>PIN je uložený iba v tomto zariadení. Slúži na odomknutie už pripraveného offline režimu.</p>
          </div>
          <span style={stats.pinEnabled ? styles.pinEnabled : styles.pinDisabled}>
            {stats.pinEnabled ? 'PIN nastavený' : 'PIN nie je nastavený'}
          </span>
        </div>

        <div style={styles.pinRow}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pinValue}
            onChange={event => setPinValue(event.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="4 až 8 číslic"
            style={styles.input}
          />
          <button type="button" style={styles.primaryButton} onClick={savePin} disabled={pinValue.length < 4}>
            Uložiť PIN
          </button>
          <button type="button" style={styles.secondaryButton} onClick={removePin} disabled={!stats.pinEnabled}>
            Zrušiť PIN
          </button>
        </div>
      </section>

      {message && <div style={styles.message}>{message}</div>}
    </main>
  )
}

const buttonBase: CSSProperties = {
  minHeight: 40,
  borderRadius: 6,
  padding: '0 12px',
  fontSize: 13,
  fontWeight: 950,
  cursor: 'pointer'
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
    background: '#111827',
    color: '#fff',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  kicker: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: 950
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.05,
    fontWeight: 950
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: 750,
    maxWidth: 720
  },
  backButton: {
    ...buttonBase,
    background: '#fff',
    border: '1px solid #e5e7eb',
    color: '#111827',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center'
  },
  primaryLink: {
    ...buttonBase,
    background: '#22c55e',
    border: '1px solid #16a34a',
    color: '#052e16',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center'
  },
  statusGrid: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8
  },
  statusCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 4
  },
  statusOnline: {
    background: '#dcfce7',
    border: '1px solid #86efac',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 4,
    color: '#14532d'
  },
  statusOffline: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 4,
    color: '#991b1b'
  },
  statusWarning: {
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: 8,
    padding: 12,
    display: 'grid',
    gap: 4,
    color: '#9a3412'
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 850
  },
  card: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 14,
    display: 'grid',
    gap: 12,
    boxSizing: 'border-box'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start',
    flexWrap: 'wrap'
  },
  cardTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 950
  },
  cardText: {
    margin: '4px 0 0',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 750,
    lineHeight: 1.35
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
    margin: 0
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8
  },
  fieldLabel: {
    display: 'grid',
    gap: 5,
    color: '#334155',
    fontSize: 12,
    fontWeight: 900
  },
  input: {
    width: '100%',
    minHeight: 40,
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    padding: '0 10px',
    fontSize: 14,
    fontWeight: 800,
    boxSizing: 'border-box'
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  primaryButton: {
    ...buttonBase,
    background: '#16a34a',
    border: '1px solid #15803d',
    color: '#fff'
  },
  secondaryButton: {
    ...buttonBase,
    background: '#111827',
    border: '1px solid #111827',
    color: '#fff'
  },
  lightButton: {
    ...buttonBase,
    background: '#f8fafc',
    border: '1px solid #cbd5e1',
    color: '#111827'
  },
  dangerButton: {
    ...buttonBase,
    background: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b'
  },
  warningButton: {
    ...buttonBase,
    background: '#f59e0b',
    border: '1px solid #d97706',
    color: '#111827'
  },
  snapshotBox: {
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gap: 3,
    color: '#14532d',
    fontSize: 13,
    fontWeight: 800
  },
  snapshotList: {
    display: 'grid',
    gap: 7,
    maxHeight: 284,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
    paddingRight: 4
  },
  snapshotRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 13,
    fontWeight: 800
  },
  emptyBox: {
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    background: '#f8fafc',
    padding: 12,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 850
  },
  progressWrap: {
    display: 'grid',
    gap: 6
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: '#334155',
    fontSize: 12,
    fontWeight: 850
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    background: '#e5e7eb',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    borderRadius: 999,
    background: '#22c55e',
    transition: 'width 160ms ease'
  },
  syncNotice: {
    border: '1px solid #bae6fd',
    background: '#f0f9ff',
    color: '#075985',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    fontWeight: 850
  },
  conflictList: {
    display: 'grid',
    gap: 8
  },
  conflictItem: {
    border: '1px solid #fed7aa',
    background: '#fff7ed',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gap: 8
  },
  conflictMeta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 5,
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: 850
  },
  pinRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 1fr) auto auto',
    gap: 8
  },
  pinEnabled: {
    color: '#166534',
    fontSize: 12,
    fontWeight: 950
  },
  pinDisabled: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 950
  },
  message: {
    maxWidth: 1040,
    width: '100%',
    margin: '0 auto',
    border: '1px solid #bae6fd',
    background: '#f0f9ff',
    color: '#075985',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    fontWeight: 850,
    boxSizing: 'border-box'
  }
}
