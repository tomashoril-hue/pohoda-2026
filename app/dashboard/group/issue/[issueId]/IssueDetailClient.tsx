'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatDateTime(value: string | null) {
  if (!value) return ''

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

function formatCountdown(ms: number) {
  const safeMs = Math.max(0, ms)
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function mealLabel(value: string) {
  if (value === 'OBED') return 'OBED'
  if (value === 'VECERA') return 'VEČERA'
  return value || '-'
}

function choiceLabel(value: string | null) {
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  return 'NEZADANÉ'
}

function statusLabel(status: string) {
  if (status === 'PLANNED') return 'PRIPRAVENÉ'
  if (status === 'REMOVED') return 'VYRADENÉ'
  if (status === 'BULK_ISSUED') return 'PREVZATÉ HROMADNE'
  if (status === 'INDIVIDUAL_ISSUED') return 'PREVZATÉ OSOBNE'
  return status || '-'
}

function isTakenStatus(status: string) {
  return status === 'INDIVIDUAL_ISSUED' || status === 'BULK_ISSUED'
}

export default function IssueDetailClient({
  issue,
  items,
  myRole
}: {
  issue: {
    id: string
    groupId: string
    groupName: string
    datum: string
    typJedla: string
    status: string
    validAfter: string | null
    createdByRole: string
  }
  items: any[]
  myRole: string
}) {
  const router = useRouter()

  const [selected, setSelected] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')

  const [search, setSearch] = useState('')
  const [choiceFilter, setChoiceFilter] = useState<'ALL' | 'MASO' | 'VEGE' | 'UNKNOWN'>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PLANNED' | 'TAKEN'>('ALL')

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const activeItems = useMemo(() => {
    return items.filter(item => item.status !== 'REMOVED')
  }, [items])

  const plannedItems = activeItems.filter(item => item.status === 'PLANNED')
  const takenItems = activeItems.filter(item => isTakenStatus(item.status))
  const masoItems = activeItems.filter(item => item.volba === 'MASO')
  const vegeItems = activeItems.filter(item => item.volba === 'VEGE')
  const unknownItems = activeItems.filter(item => item.volba !== 'MASO' && item.volba !== 'VEGE')

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()

    return activeItems.filter(item => {
      const matchesSearch =
        !q ||
        String(item.fullName || '').toLowerCase().includes(q) ||
        String(item.email || '').toLowerCase().includes(q) ||
        String(item.telefon || '').toLowerCase().includes(q)

      const matchesChoice =
        choiceFilter === 'ALL' ||
        (choiceFilter === 'MASO' && item.volba === 'MASO') ||
        (choiceFilter === 'VEGE' && item.volba === 'VEGE') ||
        (choiceFilter === 'UNKNOWN' && item.volba !== 'MASO' && item.volba !== 'VEGE')

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'PLANNED' && item.status === 'PLANNED') ||
        (statusFilter === 'TAKEN' && isTakenStatus(item.status))

      return matchesSearch && matchesChoice && matchesStatus
    })
  }, [activeItems, search, choiceFilter, statusFilter])

  const selectableVisibleItems = visibleItems.filter(item => item.status === 'PLANNED')

  const allVisibleSelected =
    selectableVisibleItems.length > 0 &&
    selectableVisibleItems.every(item => selected.includes(item.id))

  const validAfterMs = issue.validAfter
    ? new Date(issue.validAfter).getTime()
    : null

  const remainingMs =
    issue.status === 'WAITING' && validAfterMs
      ? validAfterMs - now
      : 0

  const isWaiting = issue.status === 'WAITING' && remainingMs > 0
  const isActivePreparation =
    issue.status === 'READY' ||
    (issue.status === 'WAITING' && remainingMs <= 0)

  const isCancelled = issue.status === 'CANCELLED'

  const statusTitle = isCancelled
    ? 'Príprava je zrušená'
    : isWaiting
      ? 'Príprava čaká na aktiváciu'
      : isActivePreparation
        ? 'Príprava je aktívna'
        : 'Príprava hromadného výdaja'

  const toggleOne = (id: string) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    )
  }

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(prev =>
        prev.filter(id => !selectableVisibleItems.some(item => item.id === id))
      )
      return
    }

    setSelected(prev => {
      const next = new Set(prev)
      selectableVisibleItems.forEach(item => next.add(item.id))
      return Array.from(next)
    })
  }

  const clearSelection = () => {
    setSelected([])
  }

  const removeSelectedFromPreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!selected.length) {
      setMessage('Nie sú vybrané žiadne osoby na vyradenie.')
      setMessageType('error')
      return
    }

    if (isCancelled) {
      setMessage('Táto príprava je už zrušená.')
      setMessageType('error')
      return
    }

    if (!confirm(`Vyradiť označené osoby z prípravy? Počet: ${selected.length}`)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/remove-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: issue.id,
          itemIds: selected
        })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        setMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Osoby sa nepodarilo vyradiť z prípravy.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Označené osoby boli vyradené z prípravy.')
      setMessageType('ok')
      setSelected([])
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const cancelPreparation = async () => {
    setMessage('')
    setMessageType('')

    if (isCancelled) {
      setMessage('Táto príprava je už zrušená.')
      setMessageType('error')
      return
    }

    if (!confirm('Naozaj chcete zrušiť celú prípravu hromadného výdaja?')) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        setMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Prípravu sa nepodarilo zrušiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Príprava hromadného výdaja bola zrušená.')
      setMessageType('ok')
      setSelected([])
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const selectedPlannedCount = selected.filter(id =>
    plannedItems.some(item => item.id === id)
  ).length

  return (
    <div style={styles.app}>
      <div style={styles.headerPanel}>
        <div>
          <div style={styles.kicker}>Príprava hromadného výdaja</div>
          <h2 style={styles.pageTitle}>
            {issue.groupName}
          </h2>
        </div>

        <div
          style={{
            ...styles.statusChip,
            background: isCancelled ? '#fee2e2' : isWaiting ? '#fff7ed' : '#dcfce7',
            color: isCancelled ? '#991b1b' : isWaiting ? '#9a3412' : '#166534'
          }}
        >
          {statusTitle}
        </div>
      </div>

      <div style={styles.metaGrid}>
        <div style={styles.metaItem}>
          <span>Dátum</span>
          <b>{formatDate(issue.datum)}</b>
        </div>

        <div style={styles.metaItem}>
          <span>Jedlo</span>
          <b>{mealLabel(issue.typJedla)}</b>
        </div>

        <div style={styles.metaItem}>
          <span>Rola</span>
          <b>{myRole}</b>
        </div>

        <div style={styles.metaItem}>
          <span>Status</span>
          <b>{issue.status}</b>
        </div>

        {issue.validAfter && (
          <div style={styles.metaItemWide}>
            <span>Platné od</span>
            <b>{formatDateTime(issue.validAfter)}</b>
          </div>
        )}

        {issue.status === 'WAITING' && (
          <div style={styles.countdownItem}>
            <span>Odpočet</span>
            <b>{isWaiting ? formatCountdown(remainingMs) : '00:00'}</b>
          </div>
        )}
      </div>

      <div style={styles.statsGrid}>
        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(statusFilter === 'ALL' && choiceFilter === 'ALL' ? styles.statActive : {})
          }}
          onClick={() => {
            setStatusFilter('ALL')
            setChoiceFilter('ALL')
          }}
        >
          <b>{activeItems.length}</b>
          <span>Spolu</span>
        </button>

        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(statusFilter === 'PLANNED' ? styles.statActive : {})
          }}
          onClick={() => setStatusFilter(statusFilter === 'PLANNED' ? 'ALL' : 'PLANNED')}
        >
          <b>{plannedItems.length}</b>
          <span>Pripravené</span>
        </button>

        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(choiceFilter === 'MASO' ? styles.statActive : {})
          }}
          onClick={() => setChoiceFilter(choiceFilter === 'MASO' ? 'ALL' : 'MASO')}
        >
          <b>{masoItems.length}</b>
          <span>MASO</span>
        </button>

        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(choiceFilter === 'VEGE' ? styles.statActive : {})
          }}
          onClick={() => setChoiceFilter(choiceFilter === 'VEGE' ? 'ALL' : 'VEGE')}
        >
          <b>{vegeItems.length}</b>
          <span>VEGE</span>
        </button>

        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(choiceFilter === 'UNKNOWN' ? styles.statActive : {})
          }}
          onClick={() => setChoiceFilter(choiceFilter === 'UNKNOWN' ? 'ALL' : 'UNKNOWN')}
        >
          <b>{unknownItems.length}</b>
          <span>Nezadané</span>
        </button>

        <button
          type="button"
          style={{
            ...styles.statCard,
            ...(statusFilter === 'TAKEN' ? styles.statActive : {})
          }}
          onClick={() => setStatusFilter(statusFilter === 'TAKEN' ? 'ALL' : 'TAKEN')}
        >
          <b>{takenItems.length}</b>
          <span>Prevzaté</span>
        </button>
      </div>
            <div style={styles.toolbar}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Hľadať meno, e-mail, telefón..."
          style={styles.searchInput}
        />

        <select
          value={choiceFilter}
          onChange={e => setChoiceFilter(e.target.value as any)}
          style={styles.select}
        >
          <option value="ALL">Všetky jedlá</option>
          <option value="MASO">MASO</option>
          <option value="VEGE">VEGE</option>
          <option value="UNKNOWN">Nezadané</option>
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          style={styles.select}
        >
          <option value="ALL">Všetky stavy</option>
          <option value="PLANNED">Pripravené</option>
          <option value="TAKEN">Prevzaté</option>
        </select>
      </div>

      <div style={styles.actionBar}>
        <div style={styles.actionLeft}>
          <button
            type="button"
            style={{
              ...styles.smallButton,
              opacity: loading || selectableVisibleItems.length === 0 || isCancelled ? 0.5 : 1
            }}
            disabled={loading || selectableVisibleItems.length === 0 || isCancelled}
            onClick={toggleAllVisible}
          >
            {allVisibleSelected ? 'Zrušiť výber' : 'Označiť zobrazených'}
          </button>

          <button
            type="button"
            style={{
              ...styles.ghostButton,
              opacity: selected.length === 0 ? 0.5 : 1
            }}
            disabled={selected.length === 0}
            onClick={clearSelection}
          >
            Vyčistiť
          </button>

          <div style={styles.selectedPill}>
            Vybraní: <b>{selectedPlannedCount}</b>
          </div>
        </div>

        <div style={styles.actionRight}>
          <button
            type="button"
            style={{
              ...styles.removeButton,
              opacity: loading || selectedPlannedCount === 0 || isCancelled ? 0.5 : 1
            }}
            disabled={loading || selectedPlannedCount === 0 || isCancelled}
            onClick={removeSelectedFromPreparation}
          >
            Vyradiť z prípravy
          </button>

          <button
            type="button"
            style={{
              ...styles.cancelButton,
              opacity: loading || isCancelled ? 0.5 : 1
            }}
            disabled={loading || isCancelled}
            onClick={cancelPreparation}
          >
            Zrušiť prípravu
          </button>
        </div>
      </div>

      <div style={styles.helpBox}>
        Táto obrazovka slúži iba na <b>prípravu hromadného výdaja</b>.
        Skutočný výdaj jedla sa bude zapisovať až neskôr cez QR sken pri výdajnom okienku.
      </div>

      {message && (
        <div
          style={{
            ...styles.messageBox,
            background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
            color: messageType === 'ok' ? '#166534' : '#991b1b',
            borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
          }}
        >
          {message}
        </div>
      )}

      <div style={styles.tableWrap}>
        <div style={styles.tableHeader}>
          <div></div>
          <div>Osoba</div>
          <div>Jedlo</div>
          <div>Stav</div>
          <div>Zdroj</div>
        </div>

        {!visibleItems.length ? (
          <div style={styles.emptyState}>
            Nenašli sa žiadne osoby podľa zvolených filtrov.
          </div>
        ) : (
          <div style={styles.rows}>
            {visibleItems.map(item => {
              const selectedNow = selected.includes(item.id)
              const taken = isTakenStatus(item.status)
              const planned = item.status === 'PLANNED'

              return (
                <div
                  key={item.id}
                  style={{
                    ...styles.row,
                    background: taken ? '#f3f4f6' : selectedNow ? '#ecfdf5' : '#fff',
                    borderColor: selectedNow ? '#22c55e' : '#e5e7eb',
                    opacity: taken ? 0.72 : 1
                  }}
                >
                  <div style={styles.checkCell}>
                    <input
                      type="checkbox"
                      checked={selectedNow}
                      disabled={!planned || loading || isCancelled}
                      onChange={() => toggleOne(item.id)}
                      style={styles.checkbox}
                    />
                  </div>

                  <div style={styles.personCell}>
                    <div style={styles.personName}>
                      {item.fullName || 'Bez mena'}
                    </div>

                    <div style={styles.personMeta}>
                      {item.email || '-'}
                      {item.telefon ? ` · ${item.telefon}` : ''}
                    </div>
                  </div>

                  <div>
                    <span
                      style={{
                        ...styles.choiceBadge,
                        background:
                          item.volba === 'MASO'
                            ? '#111827'
                            : item.volba === 'VEGE'
                              ? '#dcfce7'
                              : '#fef3c7',
                        color:
                          item.volba === 'MASO'
                            ? '#fff'
                            : item.volba === 'VEGE'
                              ? '#166534'
                              : '#92400e'
                      }}
                    >
                      {choiceLabel(item.volba)}
                    </span>
                  </div>

                  <div>
                    <span
                      style={{
                        ...styles.statusBadge,
                        background:
                          item.status === 'PLANNED'
                            ? '#e0f2fe'
                            : taken
                              ? '#e5e7eb'
                              : '#fee2e2',
                        color:
                          item.status === 'PLANNED'
                            ? '#075985'
                            : taken
                              ? '#374151'
                              : '#991b1b'
                      }}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <div>
                    <span style={styles.sourceBadge}>
                      {item.source === 'QR_EXTRA' ? 'Mimo skupiny' : 'Skupina'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    marginTop: 18,
    display: 'grid',
    gap: 12,
    color: '#111827'
  },
  headerPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)'
  },
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  pageTitle: {
    margin: '4px 0 0',
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 900
  },
  statusChip: {
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8
  },
  metaItem: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '10px 12px',
    display: 'grid',
    gap: 2
  },
  metaItemWide: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '10px 12px',
    display: 'grid',
    gap: 2
  },
  countdownItem: {
    background: '#111827',
    color: '#fff',
    borderRadius: 14,
    padding: '10px 12px',
    display: 'grid',
    gap: 2
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
    gap: 8
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: '10px 8px',
    textAlign: 'center',
    color: '#111827',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)'
  },
  statActive: {
    borderColor: '#22c55e',
    background: '#ecfdf5',
    boxShadow: '0 0 0 2px rgba(34,197,94,0.15)'
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 150px 150px',
    gap: 8
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 700,
    outline: 'none'
  },
  select: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  actionBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap'
  },
  actionLeft: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  actionRight: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  smallButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900
  },
  ghostButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: 900
  },
  selectedPill: {
    background: '#f3f4f6',
    borderRadius: 999,
    padding: '8px 11px',
    fontSize: 13,
    fontWeight: 800
  },
  removeButton: {
    background: '#fff7ed',
    color: '#9a3412',
    border: '1px solid #fed7aa',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900
  },
  cancelButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900
  },
  helpBox: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.45,
    color: '#374151'
  },
  messageBox: {
    border: '1px solid',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  },
  tableWrap: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.06)'
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr) 92px 130px 92px',
    gap: 8,
    alignItems: 'center',
    padding: '10px 12px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  rows: {
    display: 'grid'
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr) 92px 130px 92px',
    gap: 8,
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb'
  },
  checkCell: {
    display: 'flex',
    alignItems: 'center'
  },
  checkbox: {
    width: 18,
    height: 18
  },
  personCell: {
    minWidth: 0
  },
  personName: {
    fontSize: 14,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: 'anywhere'
  },
  personMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: 700,
    color: '#6b7280',
    overflowWrap: 'anywhere'
  },
  choiceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  sourceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 11,
    fontWeight: 850,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    padding: 18,
    fontSize: 14,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  }
}