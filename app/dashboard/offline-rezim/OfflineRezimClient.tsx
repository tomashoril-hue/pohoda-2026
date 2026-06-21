'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import QrCameraScanner from '@/app/dashboard/skupinovy-vydaj/QrCameraScanner'
import {
  applyOfflineSyncResults,
  cancelLastOfflineIssue,
  clearOfflineIssueData,
  clearOfflineOperatorPin,
  countOfflineOpenConflicts,
  countOfflinePendingEvents,
  getOfflinePinState,
  getOrCreateOfflineDeviceId,
  listOfflinePendingEvents,
  listOfflineSnapshots,
  processOfflineIssueQr,
  saveOfflineSnapshotPayload,
  setOfflineOperatorPin,
  type OfflineIssueDecision,
  type OfflineIssueScanResult,
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
  openConflicts: number
  pinEnabled: boolean
}

type DownloadState = {
  active: boolean
  percent: number
  label: string
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

function foodCountLabel(summary?: { MASO?: number; VEGE?: number; DIETA?: number }) {
  if (!summary) return ''
  return [
    `MASO ${summary.MASO || 0}`,
    `VEGE ${summary.VEGE || 0}`,
    `DIÉTA ${summary.DIETA || 0}`
  ].join(' / ')
}

export default function OfflineRezimClient({ canPrepareOfflineIssue, preparedByName }: Props) {
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [pinValue, setPinValue] = useState('')
  const [manualQr, setManualQr] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [successCount, setSuccessCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [scanHistory, setScanHistory] = useState<OfflineIssueScanResult[]>([])
  const [issueDecision, setIssueDecision] = useState<OfflineIssueDecision | null>(null)
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
    openConflicts: 0,
    pinEnabled: false
  })

  const latestSnapshot = useMemo(() => {
    return stats.snapshots
      .slice()
      .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))[0]
  }, [stats.snapshots])

  async function refreshStats() {
    setLoading(true)
    setMessage('')

    try {
      const [deviceId, snapshots, pendingEvents, openConflicts, pinState] = await Promise.all([
        getOrCreateOfflineDeviceId(),
        listOfflineSnapshots(),
        countOfflinePendingEvents(),
        countOfflineOpenConflicts(),
        getOfflinePinState()
      ])

      setStats({ deviceId, snapshots, pendingEvents, openConflicts, pinEnabled: pinState.enabled })
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

  async function downloadSnapshot() {
    if (!canPrepareOfflineIssue || download.active) return

    if (!online) {
      setMessage('Offline dáta sa dajú stiahnuť iba pri online pripojení.')
      return
    }

    setMessage('')
    setDownload({ active: true, percent: 5, label: 'Pripravujem stiahnutie.' })

    try {
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

  function addScanHistory(result: OfflineIssueScanResult) {
    setScanHistory(prev => [result, ...prev].slice(0, 8))
    if (result.ok && result.status === 'CANCELLED') {
      setSuccessCount(prev => Math.max(0, prev - Math.max(1, Number(result.issuedCount || 1))))
    } else if (result.ok) {
      setSuccessCount(prev => prev + Math.max(1, Number(result.issuedCount || 1)))
    } else if (result.status !== 'ISSUE_DECISION_REQUIRED') {
      setErrorCount(prev => prev + 1)
    }
  }

  async function processOfflineQr(
    value: string,
    issueAction?: 'INDIVIDUAL' | 'BULK',
    bulkIssueId?: string
  ) {
    setScanLoading(true)

    try {
      const result = await processOfflineIssueQr({
        qrCode: value,
        issueAction,
        bulkIssueId
      })

      if (result.decision) {
        setIssueDecision(result.decision)
      } else {
        addScanHistory(result)
        await refreshStats()
      }

      return {
        tone: result.tone,
        message: result.message
      }
    } catch (err: any) {
      const result: OfflineIssueScanResult = {
        ok: false,
        status: 'ERROR',
        tone: 'error',
        message: err?.message || 'Offline výdaj sa nepodarilo spracovať.'
      }
      addScanHistory(result)
      return {
        tone: 'error' as const,
        message: result.message
      }
    } finally {
      setScanLoading(false)
    }
  }

  async function submitManualQr() {
    const value = manualQr.trim()
    if (!value || scanLoading) return

    setManualQr('')
    await processOfflineQr(value)
  }

  async function confirmIssueDecision(issueAction: 'INDIVIDUAL' | 'BULK', bulkIssueId?: string) {
    if (!issueDecision || scanLoading) return

    const qrCode = issueDecision.qrCode
    setIssueDecision(null)
    await processOfflineQr(qrCode, issueAction, bulkIssueId)
  }

  async function cancelLastIssue() {
    if (scanLoading || !latestSnapshot) return

    const ok = window.confirm('Naozaj stornovať posledný offline výdaj na tomto zariadení?')
    if (!ok) return

    setScanLoading(true)

    try {
      const result = await cancelLastOfflineIssue()
      addScanHistory(result)
      await refreshStats()
    } catch (err: any) {
      addScanHistory({
        ok: false,
        status: 'ERROR',
        tone: 'error',
        message: err?.message || 'Offline storno sa nepodarilo spracovať.'
      })
    } finally {
      setScanLoading(false)
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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ events })
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || 'Synchronizácia sa nepodarila.')
      }

      await applyOfflineSyncResults(data.results || [])
      await refreshStats()

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

  function choiceSummaryLabel(summary?: { MASO: number; VEGE: number; DIETA: number }) {
    if (!summary) return ''
    return [
      summary.MASO ? `MÄSO ${summary.MASO}` : '',
      summary.VEGE ? `VEGE ${summary.VEGE}` : '',
      summary.DIETA ? `DIÉTA ${summary.DIETA}` : ''
    ].filter(Boolean).join(' · ')
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
            <h2 style={styles.cardTitle}>Stiahnuť offline dáta</h2>
            <p style={styles.cardText}>
              Stiahnu sa iba pripravené skupinové výdaje pre zvolený dátum a jedlo vrátane aktívnych QR kódov a náramkov.
            </p>
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
          <div style={styles.emptyBox}>
            Offline dáta zatiaľ nie sú stiahnuté.
          </div>
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
            <h2 style={styles.cardTitle}>Offline výdaj</h2>
            <p style={styles.cardText}>
              Skenovanie pracuje iba s posledným stiahnutým snapshotom. Individuálny a skupinový výdaj používajú spoločný lokálny stav.
            </p>
          </div>
          <div style={styles.scanStats}>
            <span>Vydané {successCount}</span>
            <span>Stop {errorCount}</span>
          </div>
        </div>

        {latestSnapshot ? (
          <>
            <div style={styles.offlineIssueHeader}>
              <b>{mealLabel(latestSnapshot.mealType)} · {latestSnapshot.mealDate}</b>
              <span>{latestSnapshot.issueLocation}</span>
              <span>Dáta z {dateTimeLabel(latestSnapshot.preparedAt)}</span>
            </div>

            <QrCameraScanner
              disabled={scanLoading}
              autoStopMs={5 * 60 * 1000}
              showLastMessage
              onScan={value => processOfflineQr(value)}
            />

            <div style={styles.manualQrRow}>
              <input
                type="password"
                value={manualQr}
                onChange={event => setManualQr(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitManualQr()
                  }
                }}
                placeholder="Scanner / ručné QR"
                style={styles.input}
              />
              <button type="button" style={styles.primaryButton} onClick={submitManualQr} disabled={scanLoading || !manualQr.trim()}>
                Spracovať QR
              </button>
            </div>

            <div style={styles.offlineIssueActions}>
              <button
                type="button"
                style={styles.warningButton}
                onClick={cancelLastIssue}
                disabled={scanLoading || stats.pendingEvents === 0}
              >
                Stornovať posledný výdaj
              </button>
            </div>

            <div style={styles.historyList}>
              {scanHistory.length === 0 ? (
                <div style={styles.emptyBox}>Čaká sa na prvý offline výdaj.</div>
              ) : scanHistory.map((item, index) => (
                <div
                  key={`${item.status}-${index}`}
                  style={item.tone === 'warning' ? styles.historyWarning : item.ok ? styles.historyOk : styles.historyError}
                >
                  <b>{item.message}</b>
                  <span>{item.personName || 'Bez mena'}{item.groupName ? ` · ${item.groupName}` : ''}</span>
                  {item.summary && <small>{choiceSummaryLabel(item.summary)}</small>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={styles.emptyBox}>Najprv stiahni offline dáta pre konkrétny výdaj.</div>
        )}
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <h2 style={styles.cardTitle}>Lokálny PIN obsluhy</h2>
            <p style={styles.cardText}>
              PIN je uložený iba v tomto zariadení. Slúži na odomknutie už pripraveného offline výdaja, nie na stiahnutie dát.
            </p>
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

      {issueDecision && (
        <div style={styles.modalBackdrop}>
          <div style={styles.decisionModal}>
            <div style={styles.decisionHeader}>
              <div>
                <div style={styles.decisionKicker}>OFFLINE VÝDAJ</div>
                <h2 style={styles.decisionTitle}>Vyber spôsob výdaja</h2>
                <p style={styles.decisionPerson}>{issueDecision.personName || 'Bez mena'}</p>
              </div>
              <button
                type="button"
                onClick={() => setIssueDecision(null)}
                disabled={scanLoading}
                style={styles.closeButton}
              >
                Zavrieť
              </button>
            </div>

            <div style={styles.decisionList}>
              {issueDecision.bulkIssues.map(issue => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => confirmIssueDecision('BULK', issue.id)}
                  disabled={scanLoading}
                  style={styles.bulkDecisionButton}
                >
                  <span style={styles.decisionAction}>VYDAŤ SKUPINOVO</span>
                  <b style={styles.decisionGroup}>{issue.groupName || 'Skupinový výdaj'}</b>
                  <span style={styles.decisionSummary}>
                    {issue.count} osôb{choiceSummaryLabel(issue.summary) ? ` · ${choiceSummaryLabel(issue.summary)}` : ''}
                  </span>
                  <span style={issue.includesScannedPerson ? styles.decisionIncluded : styles.decisionExcluded}>
                    {issue.includesScannedPerson ? 'Vrátane porcie: ' : 'Bez porcie: '}
                    {issueDecision.personName || 'Bez mena'}
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => confirmIssueDecision('INDIVIDUAL')}
                disabled={scanLoading || !issueDecision.individual.available}
                style={{
                  ...styles.individualDecisionButton,
                  opacity: scanLoading || !issueDecision.individual.available ? 0.5 : 1
                }}
              >
                <span style={styles.decisionAction}>
                  {issueDecision.individual.available
                    ? 'VYDAŤ IBA OSOBNE'
                    : issueDecision.individual.alreadyIssued
                      ? 'UŽ VYDANÉ'
                      : 'BEZ OSOBNÉHO NÁROKU'}
                </span>
                <b style={styles.decisionGroup}>{issueDecision.personName || 'Bez mena'}</b>
                {issueDecision.choice && <span style={styles.decisionSummary}>1 x {issueDecision.choice}</span>}
              </button>
            </div>
          </div>
        </div>
      )}
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
    ...buttonBase,
    minHeight: 36,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontSize: 12
  },
  metaGrid: {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '160px 160px minmax(220px, 1fr)',
    gap: 8,
    alignItems: 'end'
  },
  fieldLabel: {
    display: 'grid',
    gap: 4,
    color: '#374151',
    fontSize: 11,
    fontWeight: 950
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
  progressWrap: {
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    background: '#eff6ff',
    padding: 10,
    display: 'grid',
    gap: 8
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 900
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    background: '#dbeafe',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    borderRadius: 999,
    background: '#2563eb',
    transition: 'width 160ms ease'
  },
  syncNotice: {
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    background: '#eff6ff',
    color: '#1d4ed8',
    padding: 10,
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1.35
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
  pinRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 180px) auto auto',
    gap: 8,
    alignItems: 'center'
  },
  input: {
    width: '100%',
    minHeight: 40,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    color: '#111827',
    padding: '0 10px',
    fontSize: 14,
    fontWeight: 900,
    boxSizing: 'border-box'
  },
  pinEnabled: {
    border: '1px solid #86efac',
    borderRadius: 999,
    background: '#f0fdf4',
    color: '#14532d',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  pinDisabled: {
    border: '1px solid #d1d5db',
    borderRadius: 999,
    background: '#f9fafb',
    color: '#6b7280',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  primaryButton: {
    ...buttonBase,
    border: '1px solid #16a34a',
    background: '#22c55e',
    color: '#052e16'
  },
  secondaryButton: {
    ...buttonBase,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontWeight: 900
  },
  dangerButton: {
    ...buttonBase,
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#991b1b',
    fontWeight: 900
  },
  warningButton: {
    ...buttonBase,
    border: '1px solid #fed7aa',
    background: '#fff7ed',
    color: '#9a3412',
    fontWeight: 900
  },
  scanStats: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  offlineIssueHeader: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#111827',
    padding: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 900
  },
  manualQrRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center'
  },
  offlineIssueActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap'
  },
  historyList: {
    display: 'grid',
    gap: 8
  },
  historyOk: {
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 850
  },
  historyError: {
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 850
  },
  historyWarning: {
    border: '1px solid #fed7aa',
    borderRadius: 8,
    background: '#fff7ed',
    color: '#9a3412',
    padding: 10,
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 850
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 80,
    background: 'rgba(17, 24, 39, 0.58)',
    display: 'grid',
    placeItems: 'center',
    padding: 12
  },
  decisionModal: {
    width: 'min(560px, 100%)',
    maxHeight: 'calc(100dvh - 24px)',
    overflow: 'auto',
    borderRadius: 8,
    background: '#fff',
    border: '1px solid #e5e7eb',
    padding: 14,
    display: 'grid',
    gap: 12
  },
  decisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  decisionKicker: {
    color: '#166534',
    fontSize: 10,
    fontWeight: 950
  },
  decisionTitle: {
    margin: 0,
    color: '#111827',
    fontSize: 20,
    fontWeight: 950
  },
  decisionPerson: {
    margin: '3px 0 0 0',
    color: '#6b7280',
    fontSize: 13,
    fontWeight: 900
  },
  closeButton: {
    ...buttonBase,
    minHeight: 34,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontSize: 12
  },
  decisionList: {
    display: 'grid',
    gap: 8
  },
  bulkDecisionButton: {
    border: '1px solid #bbf7d0',
    borderRadius: 8,
    background: '#f0fdf4',
    color: '#14532d',
    padding: 12,
    display: 'grid',
    gap: 4,
    textAlign: 'left',
    cursor: 'pointer'
  },
  individualDecisionButton: {
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    background: '#eff6ff',
    color: '#1d4ed8',
    padding: 12,
    display: 'grid',
    gap: 4,
    textAlign: 'left',
    cursor: 'pointer'
  },
  decisionAction: {
    fontSize: 10,
    fontWeight: 950,
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  decisionGroup: {
    fontSize: 15,
    fontWeight: 950
  },
  decisionSummary: {
    fontSize: 12,
    fontWeight: 900
  },
  decisionIncluded: {
    color: '#166534',
    fontSize: 11,
    fontWeight: 950
  },
  decisionExcluded: {
    color: '#9a3412',
    fontSize: 11,
    fontWeight: 950
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
