'use client'

import { useMemo, useState, useEffect } from 'react'

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
  return value
}

function choiceLabel(value: string | null) {
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  return 'NEZADANÉ'
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
  const [selected, setSelected] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const activeItems = useMemo(() => {
    return items.filter(item => item.status !== 'REMOVED')
  }, [items])

  const selectableItems = activeItems.filter(item => {
    return item.status === 'PLANNED'
  })

  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every(item => selected.includes(item.id))

  const validAfterMs = issue.validAfter
    ? new Date(issue.validAfter).getTime()
    : null

  const remainingMs =
    issue.status === 'WAITING' && validAfterMs
      ? validAfterMs - now
      : 0

  const isWaiting = issue.status === 'WAITING' && remainingMs > 0
  const isReady = issue.status === 'READY' || (issue.status === 'WAITING' && remainingMs <= 0)

  const toggleOne = (id: string) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    )
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelected([])
      return
    }

    setSelected(selectableItems.map(item => item.id))
  }

  const masoCount = activeItems.filter(item => item.volba === 'MASO').length
  const vegeCount = activeItems.filter(item => item.volba === 'VEGE').length
  const unknownCount = activeItems.filter(item => item.volba !== 'MASO' && item.volba !== 'VEGE').length

  return (
    <div style={styles.wrap}>
      <div style={styles.infoBox}>
        <p><b>Skupina:</b> {issue.groupName}</p>
        <p><b>Dátum:</b> {formatDate(issue.datum)}</p>
        <p><b>Typ jedla:</b> {mealLabel(issue.typJedla)}</p>
        <p><b>Vaša rola:</b> {myRole}</p>
      </div>

      <div
        style={{
          ...styles.statusBox,
          background: isReady ? '#56db3f' : '#f25be6'
        }}
      >
        <div>
          <div style={styles.statusTitle}>
            {isReady ? 'Výdaj je pripravený' : 'Výdaj čaká na aktiváciu'}
          </div>

          <div style={styles.statusText}>
            Status: <b>{issue.status}</b>
          </div>

          {issue.validAfter && (
            <div style={styles.statusText}>
              Platné od: <b>{formatDateTime(issue.validAfter)}</b>
            </div>
          )}
        </div>

        {issue.status === 'WAITING' && (
          <div style={styles.countdownBox}>
            {isWaiting ? formatCountdown(remainingMs) : '00:00'}
          </div>
        )}
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryNumber}>{activeItems.length}</div>
          <div style={styles.summaryLabel}>Spolu osôb</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryNumber}>{masoCount}</div>
          <div style={styles.summaryLabel}>MASO</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryNumber}>{vegeCount}</div>
          <div style={styles.summaryLabel}>VEGE</div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryNumber}>{unknownCount}</div>
          <div style={styles.summaryLabel}>Nezadané</div>
        </div>
      </div>

      <div style={styles.actionsTop}>
        <button
          style={styles.smallButton}
          onClick={toggleAll}
          disabled={selectableItems.length === 0}
        >
          {allSelected ? 'Zrušiť výber' : 'Označiť všetkých'}
        </button>

        <div style={styles.selectedInfo}>
          Vybraní: <b>{selected.length}</b>
        </div>
      </div>

      <div style={styles.warningBox}>
        Toto je zatiaľ príprava výdaja. V ďalšom kroku pridáme tlačidlo na finálne vydanie označeným osobám.
      </div>

      <div style={styles.list}>
        {activeItems.map(item => {
          const isSelected = selected.includes(item.id)
          const isIssued =
            item.status === 'INDIVIDUAL_ISSUED' ||
            item.status === 'BULK_ISSUED'

          return (
            <div
              key={item.id}
              style={{
                ...styles.itemCard,
                background: isSelected ? '#56db3f' : '#fff',
                opacity: isIssued ? 0.6 : 1
              }}
            >
              <div style={styles.checkCol}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isIssued}
                  onChange={() => toggleOne(item.id)}
                  style={styles.checkbox}
                />
              </div>

              <div style={styles.personCol}>
                <div style={styles.name}>
                  {item.fullName || 'Bez mena'}
                </div>

                <div style={styles.email}>
                  {item.email || '-'}
                </div>

                {item.telefon && (
                  <div style={styles.phone}>
                    {item.telefon}
                  </div>
                )}
              </div>

              <div style={styles.metaCol}>
                <div
                  style={{
                    ...styles.choiceBadge,
                    background:
                      item.volba === 'MASO'
                        ? '#000'
                        : item.volba === 'VEGE'
                          ? '#56db3f'
                          : '#f25be6',
                    color: item.volba === 'MASO' ? '#fff' : '#000'
                  }}
                >
                  {choiceLabel(item.volba)}
                </div>

                <div style={styles.itemStatus}>
                  {item.status}
                </div>

                {item.source === 'QR_EXTRA' && (
                  <div style={styles.sourceBadge}>
                    mimo skupiny
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    marginTop: 24
  },
  infoBox: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18,
    fontSize: 18,
    fontWeight: 700
  },
  statusBox: {
    marginTop: 18,
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 16,
    alignItems: 'center'
  },
  statusTitle: {
    fontSize: 22,
    fontWeight: 950,
    marginBottom: 5
  },
  statusText: {
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.4
  },
  countdownBox: {
    background: '#000',
    color: '#fff',
    borderRadius: 18,
    padding: '12px 16px',
    fontSize: 28,
    fontWeight: 950,
    letterSpacing: 1,
    minWidth: 100,
    textAlign: 'center'
  },
  summaryGrid: {
    marginTop: 18,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 12
  },
  summaryCard: {
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    background: '#fff',
    textAlign: 'center'
  },
  summaryNumber: {
    fontSize: 30,
    fontWeight: 950,
    lineHeight: 1
  },
  summaryLabel: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: 900,
    textTransform: 'uppercase'
  },
  actionsTop: {
    marginTop: 18,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap'
  },
  smallButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '11px 16px',
    fontSize: 15,
    fontWeight: 950
  },
  selectedInfo: {
    fontWeight: 900,
    fontSize: 16
  },
  warningBox: {
    marginTop: 14,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 850,
    lineHeight: 1.35
  },
  list: {
    marginTop: 18,
    display: 'grid',
    gap: 12
  },
  itemCard: {
    border: '3px solid #000',
    borderRadius: 20,
    padding: 14,
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 12,
    alignItems: 'center'
  },
  checkCol: {
    display: 'flex',
    alignItems: 'center'
  },
  checkbox: {
    width: 22,
    height: 22
  },
  personCol: {
    minWidth: 0
  },
  name: {
    fontSize: 18,
    fontWeight: 950,
    lineHeight: 1.15,
    overflowWrap: 'anywhere'
  },
  email: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 800,
    opacity: 0.75,
    overflowWrap: 'anywhere'
  },
  phone: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: 800,
    opacity: 0.7
  },
  metaCol: {
    display: 'grid',
    gap: 7,
    justifyItems: 'end'
  },
  choiceBadge: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 13,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  itemStatus: {
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.7
  },
  sourceBadge: {
    background: '#f25be6',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 950
  }
}