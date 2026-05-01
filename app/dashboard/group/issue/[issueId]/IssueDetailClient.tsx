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
  return value
}

function choiceLabel(value: string | null) {
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  return 'NEZADANÉ'
}

function isIssuedStatus(status: string) {
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
  const [openGroup, setOpenGroup] = useState<'ALL' | 'MASO' | 'VEGE' | 'UNKNOWN' | 'ISSUED' | null>(null)

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

  const issuedItems = activeItems.filter(item => isIssuedStatus(item.status))
  const masoItems = activeItems.filter(item => item.volba === 'MASO')
  const vegeItems = activeItems.filter(item => item.volba === 'VEGE')
  const unknownItems = activeItems.filter(item => item.volba !== 'MASO' && item.volba !== 'VEGE')

  const selectedGroupItems = useMemo(() => {
    if (openGroup === 'ALL') return activeItems
    if (openGroup === 'MASO') return masoItems
    if (openGroup === 'VEGE') return vegeItems
    if (openGroup === 'UNKNOWN') return unknownItems
    if (openGroup === 'ISSUED') return issuedItems
    return []
  }, [openGroup, activeItems, masoItems, vegeItems, unknownItems, issuedItems])

  const openGroupTitle =
    openGroup === 'ALL'
      ? 'Všetky osoby'
      : openGroup === 'MASO'
        ? 'Zoznam MASO'
        : openGroup === 'VEGE'
          ? 'Zoznam VEGE'
          : openGroup === 'UNKNOWN'
            ? 'Zoznam NEZADANÉ'
            : openGroup === 'ISSUED'
              ? 'Zoznam UŽ VYDANÉ'
              : ''

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

  const toggleSummary = (type: 'ALL' | 'MASO' | 'VEGE' | 'UNKNOWN' | 'ISSUED') => {
    setOpenGroup(prev => (prev === type ? null : type))
  }

  const issueSelected = async (itemIds: string[]) => {
    setMessage('')
    setMessageType('')

    if (!itemIds.length) {
      setMessage('Nie sú vybrané žiadne osoby.')
      setMessageType('error')
      return
    }

    if (!isReady) {
      setMessage('Hromadný výdaj ešte nie je aktívny. Počkajte na skončenie odpočtu.')
      setMessageType('error')
      return
    }

    const confirmText =
      itemIds.length === selectableItems.length
        ? `Naozaj chcete vydať všetkým pripraveným osobám? Počet: ${itemIds.length}`
        : `Naozaj chcete vydať označeným osobám? Počet: ${itemIds.length}`

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/issue-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: issue.id,
          itemIds
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
        setMessage(json.error || 'Výdaj sa nepodarilo zapísať.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Výdaj bol zapísaný.')
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

  const issueAllPrepared = () => {
    issueSelected(selectableItems.map(item => item.id))
  }

  const cancelIssue = async () => {
    setMessage('')
    setMessageType('')

    if (!confirm('Naozaj chcete zrušiť tento hromadný výdaj?')) return

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
        setMessage(json.error || 'Hromadný výdaj sa nepodarilo zrušiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Hromadný výdaj bol zrušený.')
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

  const masoCount = masoItems.length
  const vegeCount = vegeItems.length
  const unknownCount = unknownItems.length
  const issuedCount = issuedItems.length

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
        <button
          type="button"
          style={{
            ...styles.summaryCard,
            ...(openGroup === 'ALL' ? styles.summaryCardActive : {})
          }}
          onClick={() => toggleSummary('ALL')}
        >
          <div style={styles.summaryNumber}>{activeItems.length}</div>
          <div style={styles.summaryLabel}>Spolu osôb</div>
        </button>

        <button
          type="button"
          style={{
            ...styles.summaryCard,
            ...(openGroup === 'MASO' ? styles.summaryCardActive : {})
          }}
          onClick={() => toggleSummary('MASO')}
        >
          <div style={styles.summaryNumber}>{masoCount}</div>
          <div style={styles.summaryLabel}>MASO</div>
        </button>

        <button
          type="button"
          style={{
            ...styles.summaryCard,
            ...(openGroup === 'VEGE' ? styles.summaryCardActive : {})
          }}
          onClick={() => toggleSummary('VEGE')}
        >
          <div style={styles.summaryNumber}>{vegeCount}</div>
          <div style={styles.summaryLabel}>VEGE</div>
        </button>

        <button
          type="button"
          style={{
            ...styles.summaryCard,
            ...(openGroup === 'UNKNOWN' ? styles.summaryCardActive : {})
          }}
          onClick={() => toggleSummary('UNKNOWN')}
        >
          <div style={styles.summaryNumber}>{unknownCount}</div>
          <div style={styles.summaryLabel}>Nezadané</div>
        </button>

        <button
          type="button"
          style={{
            ...styles.summaryCard,
            ...(openGroup === 'ISSUED' ? styles.summaryCardActive : {}),
            background: openGroup === 'ISSUED' ? '#56db3f' : '#eeeeee'
          }}
          onClick={() => toggleSummary('ISSUED')}
        >
          <div style={styles.summaryNumber}>{issuedCount}</div>
          <div style={styles.summaryLabel}>Už vydané</div>
        </button>
      </div>

      {openGroup && (
        <div style={styles.peoplePanel}>
          <div style={styles.peoplePanelHeader}>
            <div>
              <h3 style={styles.peoplePanelTitle}>{openGroupTitle}</h3>
              <div style={styles.peoplePanelCount}>Počet: {selectedGroupItems.length}</div>
            </div>

            <button
              type="button"
              style={styles.closePanelButton}
              onClick={() => setOpenGroup(null)}
            >
              Zavrieť
            </button>
          </div>

          {!selectedGroupItems.length ? (
            <div style={styles.emptyPanel}>V tejto kategórii nie je nikto.</div>
          ) : (
            <div style={styles.peoplePanelList}>
              {selectedGroupItems.map(item => {
                const issued = isIssuedStatus(item.status)

                return (
                  <div
                    key={item.id}
                    style={{
                      ...styles.peoplePanelRow,
                      background: issued ? '#eeeeee' : '#fff'
                    }}
                  >
                    <div>
                      <div style={styles.peoplePanelName}>
                        {item.fullName || 'Bez mena'}
                      </div>
                      <div style={styles.peoplePanelEmail}>
                        {item.email || '-'}
                      </div>
                    </div>

                    <div style={styles.peoplePanelBadges}>
                      <span
                        style={{
                          ...styles.panelChoiceBadge,
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
                      </span>

                      {issued && (
                        <span style={styles.issuedBadgeSmall}>
                          VYDANÉ
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
            <div style={styles.actionsTop}>
        <button
          style={{
            ...styles.smallButton,
            opacity: loading || selectableItems.length === 0 ? 0.55 : 1,
            cursor: loading || selectableItems.length === 0 ? 'not-allowed' : 'pointer'
          }}
          onClick={toggleAll}
          disabled={loading || selectableItems.length === 0}
        >
          {allSelected ? 'Zrušiť výber' : 'Označiť všetkých'}
        </button>

        <div style={styles.selectedInfo}>
          Vybraní: <b>{selected.length}</b>
        </div>
      </div>

      <div style={styles.issueActions}>
        <button
          style={{
            ...styles.issueButton,
            opacity: loading || selected.length === 0 || !isReady ? 0.55 : 1,
            cursor: loading || selected.length === 0 || !isReady ? 'not-allowed' : 'pointer'
          }}
          disabled={loading || selected.length === 0 || !isReady}
          onClick={() => issueSelected(selected)}
        >
          {loading ? 'Zapisujem...' : 'Vydať označeným'}
        </button>

        <button
          style={{
            ...styles.issueAllButton,
            opacity: loading || selectableItems.length === 0 || !isReady ? 0.55 : 1,
            cursor: loading || selectableItems.length === 0 || !isReady ? 'not-allowed' : 'pointer'
          }}
          disabled={loading || selectableItems.length === 0 || !isReady}
          onClick={issueAllPrepared}
        >
          Vydať všetkým pripraveným
        </button>

        <button
          style={{
            ...styles.cancelButton,
            opacity: loading || issuedCount > 0 ? 0.55 : 1,
            cursor: loading || issuedCount > 0 ? 'not-allowed' : 'pointer'
          }}
          disabled={loading || issuedCount > 0}
          onClick={cancelIssue}
        >
          Zrušiť hromadný výdaj
        </button>
      </div>

      {!isReady && (
        <div style={styles.warningBox}>
          Výdaj ešte nie je aktívny. Tlačidlá na vydanie sa sprístupnia po skončení odpočtu.
        </div>
      )}

      {issuedCount > 0 && (
        <div style={styles.warningBox}>
          Tento výdaj už obsahuje vydané osoby. Zrušenie celého hromadného výdaja je preto zablokované.
        </div>
      )}

      {message && (
        <div
          style={{
            ...styles.messageBox,
            background: messageType === 'ok' ? '#56db3f' : '#f25be6'
          }}
        >
          {message}
        </div>
      )}

      <div style={styles.list}>
        {activeItems.map(item => {
          const isSelected = selected.includes(item.id)
          const isIssued = isIssuedStatus(item.status)

          return (
            <div
              key={item.id}
              style={{
                ...styles.itemCard,
                background: isIssued ? '#eeeeee' : isSelected ? '#56db3f' : '#fff',
                opacity: isIssued ? 0.78 : 1,
                borderColor: isIssued ? '#777' : '#000'
              }}
            >
              <div style={styles.checkCol}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isIssued || loading}
                  onChange={() => toggleOne(item.id)}
                  style={styles.checkbox}
                />
              </div>

              <div style={styles.personCol}>
                <div
                  style={{
                    ...styles.name,
                    textDecoration: isIssued ? 'line-through' : 'none'
                  }}
                >
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

                {isIssued && (
                  <div style={styles.issuedText}>
                    Táto osoba už má jedlo vydané.
                  </div>
                )}
              </div>

              <div style={styles.metaCol}>
                {isIssued && (
                  <div style={styles.issuedBadge}>
                    VYDANÉ
                  </div>
                )}

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
    textAlign: 'center',
    cursor: 'pointer',
    color: '#000'
  },
  summaryCardActive: {
    background: '#56db3f',
    boxShadow: '5px 5px 0 #000'
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
  peoplePanel: {
    marginTop: 16,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    boxShadow: '6px 6px 0 #f25be6'
  },
  peoplePanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12
  },
  peoplePanelTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 950
  },
  peoplePanelCount: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 850,
    opacity: 0.75
  },
  closePanelButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '9px 13px',
    fontWeight: 950
  },
  emptyPanel: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    fontWeight: 900
  },
  peoplePanelList: {
    display: 'grid',
    gap: 10,
    maxHeight: 360,
    overflowY: 'auto',
    paddingRight: 4
  },
  peoplePanelRow: {
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center'
  },
  peoplePanelName: {
    fontSize: 16,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  peoplePanelEmail: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: 800,
    opacity: 0.72,
    overflowWrap: 'anywhere'
  },
  peoplePanelBadges: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  panelChoiceBadge: {
    border: '2px solid #000',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  issuedBadgeSmall: {
    background: '#000',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
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
  issueActions: {
    marginTop: 14,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 12
  },
  issueButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 18px',
    fontSize: 16,
    fontWeight: 950
  },
  issueAllButton: {
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 18px',
    fontSize: 16,
    fontWeight: 950
  },
  cancelButton: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '14px 18px',
    fontSize: 16,
    fontWeight: 950
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
  messageBox: {
    marginTop: 14,
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 900
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
  issuedText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: 950,
    color: '#000'
  },
  metaCol: {
    display: 'grid',
    gap: 7,
    justifyItems: 'end'
  },
  issuedBadge: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 950,
    whiteSpace: 'nowrap'
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