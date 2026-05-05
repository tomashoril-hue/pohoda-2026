'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

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

function statusLabel(value: string) {
  if (value === 'READY') return 'Aktívna'
  if (value === 'WAITING') return 'Čaká na aktiváciu'
  if (value === 'CANCELLED') return 'Zrušená'
  return value || '-'
}

function choiceLabel(value: string | null) {
  if (value === 'MASO') return 'MASO'
  if (value === 'VEGE') return 'VEGE'
  return 'NEZADANÉ'
}

function itemStatusLabel(item: any) {
  if (item.status === 'PLANNED') return 'PRIPRAVENÝ'

  if (item.status === 'REMOVED') {
    if (item.removeReason === 'REMOVED_FROM_GROUP') return 'ODSTRÁNENÝ ZO SKUPINY'
    if (item.removeReason === 'MOVED_TO_OTHER_GROUP') return 'PRESUNUTÝ DO INEJ SKUPINY'
    return 'VYRADENÝ Z PRÍPRAVY'
  }

  if (item.status === 'INDIVIDUAL_ISSUED') return 'PREVZAL OSOBNE'
  if (item.status === 'BULK_ISSUED') return 'PREVZATÉ HROMADNE'

  return item.status || 'PRIPRAVENÝ'
}

function canSelectRow(item: any, currentIssue: any) {
  if (!currentIssue) return true

  if (item.status === 'PLANNED') return true

  if (
    item.status === 'REMOVED' &&
    item.removeReason !== 'REMOVED_FROM_GROUP' &&
    item.role !== 'MIMO SKUPINY'
  ) {
    return true
  }

  return false
}

export default function GroupIssueClient({
  group,
  myRole,
  members,
  activeIssues
}: {
  group: {
    id: string
    name: string
  }
  myRole: string
  members: any[]
  activeIssues: any[]
}) {
  const router = useRouter()

  const [datum, setDatum] = useState(todayIsoDate())
  const [typJedla, setTypJedla] = useState('OBED')
  const [search, setSearch] = useState('')
  const [choiceFilter, setChoiceFilter] = useState<'ALL' | 'MASO' | 'VEGE' | 'UNKNOWN'>('ALL')
  const [selected, setSelected] = useState<string[]>(members.map(member => member.userId))
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const selectedActiveIssue = activeIssues.find(issue => issue.id === selectedIssueId) || null

  const matchingIssue = activeIssues.find(issue => {
    return issue.datum === datum && issue.typ_jedla === typJedla
  }) || null

  const currentIssue = selectedActiveIssue || matchingIssue || null

  const validAfterMs = currentIssue?.valid_after
    ? new Date(currentIssue.valid_after).getTime()
    : null

  const remainingMs =
    currentIssue?.status === 'WAITING' && validAfterMs
      ? validAfterMs - now
      : 0

  const isWaiting = currentIssue?.status === 'WAITING' && remainingMs > 0
  const isActive = currentIssue?.status === 'READY' || (currentIssue?.status === 'WAITING' && remainingMs <= 0)

  const rows = useMemo(() => {
    if (currentIssue) {
      return (currentIssue.items || []).map((item: any) => ({
        ...item,
        rowId: item.id || item.userId,
        typStravy: item.typStravy || item.volba || '',
        isFromIssue: true
      }))
    }

    return members.map((member: any) => ({
      ...member,
      rowId: member.userId,
      status: 'PLANNED',
      removeReason: null,
      isFromIssue: false
    }))
  }, [currentIssue, members])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()

    return rows.filter((row: any) => {
      const rowChoice = String(row.typStravy || row.volba || '').toUpperCase()

      const matchesSearch =
        !q ||
        String(row.fullName || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.telefon || '').toLowerCase().includes(q)

      const matchesChoice =
        choiceFilter === 'ALL' ||
        (choiceFilter === 'MASO' && rowChoice === 'MASO') ||
        (choiceFilter === 'VEGE' && rowChoice === 'VEGE') ||
        (choiceFilter === 'UNKNOWN' && rowChoice !== 'MASO' && rowChoice !== 'VEGE')

      return matchesSearch && matchesChoice
    })
  }, [rows, search, choiceFilter])

  const selectableRows = filteredRows.filter((row: any) => canSelectRow(row, currentIssue))

  const allFilteredSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row: any) => selected.includes(row.userId))

  const selectedRows = rows.filter((row: any) => selected.includes(row.userId))

  const masoCount = rows.filter((row: any) => String(row.typStravy || row.volba || '').toUpperCase() === 'MASO').length
  const vegeCount = rows.filter((row: any) => String(row.typStravy || row.volba || '').toUpperCase() === 'VEGE').length
  const unknownCount = rows.filter((row: any) => {
    const choice = String(row.typStravy || row.volba || '').toUpperCase()
    return choice !== 'MASO' && choice !== 'VEGE'
  }).length

  const removedCount = rows.filter((row: any) => row.status === 'REMOVED').length

  const loadIssueToEditor = (issue: any | null) => {
    if (!issue) {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
      return
    }

    setSelectedIssueId(issue.id)
    setDatum(issue.datum)
    setTypJedla(issue.typ_jedla)
    setSelected(issue.userIds || [])
  }

  const handleDateChange = (value: string) => {
    setDatum(value)
    setMessage('')
    setMessageType('')

    const issue = activeIssues.find(item => {
      return item.datum === value && item.typ_jedla === typJedla
    }) || null

    if (issue) {
      setSelectedIssueId(issue.id)
      setSelected(issue.userIds || [])
    } else {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
    }
  }

  const handleMealChange = (value: string) => {
    setTypJedla(value)
    setMessage('')
    setMessageType('')

    const issue = activeIssues.find(item => {
      return item.datum === datum && item.typ_jedla === value
    }) || null

    if (issue) {
      setSelectedIssueId(issue.id)
      setSelected(issue.userIds || [])
    } else {
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
    }
  }

  const switchToActiveIssue = (issue: any) => {
    loadIssueToEditor(issue)
    setMessage('')
    setMessageType('')
  }

  const startNewPreparation = () => {
    setSelectedIssueId(null)
    setSelected(members.map(member => member.userId))
    setMessage('')
    setMessageType('')
  }

  const markAsChanged = () => {
    setMessage('')
    setMessageType('')
  }

  const toggleOne = (row: any) => {
    if (!canSelectRow(row, currentIssue)) return

    markAsChanged()

    setSelected(prev =>
      prev.includes(row.userId)
        ? prev.filter(id => id !== row.userId)
        : [...prev, row.userId]
    )
  }

  const toggleFiltered = () => {
    markAsChanged()

    if (allFilteredSelected) {
      setSelected(prev =>
        prev.filter(id => !selectableRows.some((row: any) => row.userId === id))
      )
      return
    }

    setSelected(prev => {
      const next = new Set(prev)
      selectableRows.forEach((row: any) => next.add(row.userId))
      return Array.from(next)
    })
  }

  const selectAll = () => {
    markAsChanged()
    setSelected(
      rows
        .filter((row: any) => canSelectRow(row, currentIssue))
        .map((row: any) => row.userId)
    )
  }

  const clearSelected = () => {
    markAsChanged()
    setSelected([])
  }

  const confirmPreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!selected.length) {
      setMessage('Nie sú vybrané žiadne osoby do hromadného výdaja.')
      setMessageType('error')
      return
    }

    if (currentIssue) {
      setMessage('Pre tento dátum a typ jedla už existuje príprava. Použite tlačidlo Uložiť zmeny.')
      setMessageType('error')
      return
    }

    const confirmText =
      myRole === 'POVERENY'
        ? `Potvrdiť prípravu hromadného výdaja pre ${selected.length} osôb? Príprava začne platiť o 15 minút.`
        : `Potvrdiť prípravu hromadného výdaja pre ${selected.length} osôb?`

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datum,
          typJedla,
          userIds: selected
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
        setMessage(json.error || 'Prípravu hromadného výdaja sa nepodarilo potvrdiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Príprava hromadného výdaja bola potvrdená.')
      setMessageType('ok')
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const updatePreparation = async () => {
    setMessage('')
    setMessageType('')

    if (!currentIssue) {
      setMessage('Nie je vybraná žiadna potvrdená príprava.')
      setMessageType('error')
      return
    }

    if (!selected.length) {
      setMessage('Príprava musí obsahovať aspoň jednu osobu.')
      setMessageType('error')
      return
    }

    const confirmText =
      myRole === 'POVERENY'
        ? `Uložiť zmeny prípravy pre ${selected.length} osôb? Po úprave začne znovu plynúť 15 minút.`
        : `Uložiť zmeny prípravy pre ${selected.length} osôb?`

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: currentIssue.id,
          userIds: selected
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
        setMessage(json.error || 'Zmeny prípravy sa nepodarilo uložiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Zmeny prípravy boli uložené.')
      setMessageType('ok')
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

    if (!currentIssue) {
      setMessage('Nie je vybraná žiadna príprava na zrušenie.')
      setMessageType('error')
      return
    }

    if (!confirm('Naozaj chcete zrušiť túto prípravu hromadného výdaja?')) return

    setLoading(true)

    try {
      const res = await fetch('/api/group/issue/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueId: currentIssue.id
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
        setMessage(json.error || 'Prípravu sa nepodarilo zrušiť.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Príprava bola zrušená.')
      setMessageType('ok')
      setSelectedIssueId(null)
      setSelected(members.map(member => member.userId))
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  const modeTitle = currentIssue
    ? 'Upravujete potvrdenú prípravu'
    : 'Pripravujete hromadný výdaj'

  const modeText = currentIssue
    ? `${formatDate(currentIssue.datum)} · ${mealLabel(currentIssue.typ_jedla)} · ${statusLabel(currentIssue.status)}`
    : `${formatDate(datum)} · ${mealLabel(typJedla)} · zatiaľ nepotvrdené`

  return (
    <div style={styles.screen}>
      <header style={styles.mobileHeader}>
        <div>
          <div style={styles.breadcrumb}>Moja skupina / Hromadný výdaj</div>
          <h1 style={styles.title}>Príprava výdaja</h1>
        </div>

        <a href="/dashboard/group" style={styles.closeButton}>
          Späť
        </a>
      </header>

      <section
        style={{
          ...styles.modeBar,
          background: currentIssue
            ? isWaiting
              ? '#fff7ed'
              : isActive
                ? '#ecfdf5'
                : '#fff'
            : '#eff6ff',
          borderColor: currentIssue
            ? isWaiting
              ? '#fed7aa'
              : isActive
                ? '#86efac'
                : '#e5e7eb'
            : '#bfdbfe'
        }}
      >
        <div style={styles.modeMain}>
          <b>{modeTitle}</b>
          <span>{modeText}</span>
        </div>

        {currentIssue && (
          <div style={styles.modeStatus}>
            {isWaiting ? (
              <>
                <strong>{formatCountdown(remainingMs)}</strong>
                <small>do aktivácie</small>
              </>
            ) : (
              <>
                <strong>Platná</strong>
                <small>príprava</small>
              </>
            )}
          </div>
        )}
      </section>

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Nastavenie prípravy</div>

          <div style={styles.formGrid}>
            <label style={styles.field}>
              <span>Dátum</span>
              <input
                type="date"
                value={datum}
                onChange={e => handleDateChange(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span>Jedlo</span>
              <select
                value={typJedla}
                onChange={e => handleMealChange(e.target.value)}
                style={styles.input}
              >
                <option value="OBED">OBED</option>
                <option value="VECERA">VEČERA</option>
              </select>
            </label>
          </div>

          <div style={styles.metaLine}>
            <span>{group.name}</span>
            <span>{myRole}</span>
          </div>

          {myRole === 'POVERENY' && (
            <div
              style={{
                ...styles.waitNotice,
                background: currentIssue && isWaiting ? '#fee2e2' : '#fff7ed',
                color: currentIssue && isWaiting ? '#991b1b' : '#9a3412',
                borderColor: currentIssue && isWaiting ? '#fecaca' : '#fed7aa'
              }}
            >
              {currentIssue ? (
                isWaiting ? (
                  <>
                    Úprava poverenej osoby ešte nie je platná. Ostáva: <b>{formatCountdown(remainingMs)}</b>
                  </>
                ) : (
                  <>
                    Príprava poverenej osoby je platná.
                  </>
                )
              ) : (
                <>
                  Poverená osoba: po potvrdení alebo úprave začne platiť 15 minútový odpočet.
                </>
              )}
            </div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeaderRow}>
            <div style={styles.panelTitle}>Aktívne prípravy</div>

            <button
              type="button"
              style={styles.tinyButton}
              onClick={startNewPreparation}
            >
              Nová
            </button>
          </div>

          {!activeIssues.length ? (
            <div style={styles.emptySmall}>
              Žiadna aktívna príprava.
            </div>
          ) : (
            <div style={styles.activeList}>
              {activeIssues.map((item: any) => {
                const active = currentIssue?.id === item.id

                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => switchToActiveIssue(item)}
                    style={{
                      ...styles.activeIssue,
                      borderColor: active ? '#22c55e' : '#e5e7eb',
                      background: active ? '#ecfdf5' : '#f9fafb'
                    }}
                  >
                    <div style={styles.activeIssueTop}>
                      <b>{formatDate(item.datum)}</b>
                      <b>{mealLabel(item.typ_jedla)}</b>
                    </div>

                    <div style={styles.activeIssueBottom}>
                      <span>{statusLabel(item.status)}</span>
                      <span>{item.peopleCount || 0} osôb</span>
                    </div>

                    {item.valid_after && (
                      <div style={styles.activeIssueTime}>
                        Platné od: {formatDateTime(item.valid_after)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section style={styles.statsGrid}>
        <button type="button" style={styles.statCard} onClick={selectAll}>
          <b>{rows.length}</b>
          <span>Osoby</span>
        </button>

        <button type="button" style={styles.statCard} onClick={() => setChoiceFilter('MASO')}>
          <b>{masoCount}</b>
          <span>MASO</span>
        </button>

        <button type="button" style={styles.statCard} onClick={() => setChoiceFilter('VEGE')}>
          <b>{vegeCount}</b>
          <span>VEGE</span>
        </button>

        <button type="button" style={styles.statCard} onClick={() => setChoiceFilter('UNKNOWN')}>
          <b>{unknownCount}</b>
          <span>Nezadané</span>
        </button>

        <button type="button" style={{ ...styles.statCard, ...styles.selectedStat }}>
          <b>{selectedRows.length}</b>
          <span>Vybraní</span>
        </button>

        {currentIssue && (
          <button type="button" style={{ ...styles.statCard, ...styles.removedStat }}>
            <b>{removedCount}</b>
            <span>Vyradení</span>
          </button>
        )}
      </section>

      <section style={styles.toolbar}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Hľadať osobu..."
          style={styles.searchInput}
        />

        <select
          value={choiceFilter}
          onChange={e => setChoiceFilter(e.target.value as any)}
          style={styles.select}
        >
          <option value="ALL">Všetci</option>
          <option value="MASO">MASO</option>
          <option value="VEGE">VEGE</option>
          <option value="UNKNOWN">Nezadané</option>
        </select>
      </section>

      <section style={styles.actionBar}>
        <div style={styles.actionLeft}>
          <button type="button" style={styles.darkButton} onClick={toggleFiltered}>
            {allFilteredSelected ? 'Zrušiť zobrazených' : 'Označiť zobrazených'}
          </button>

          <button type="button" style={styles.lightButton} onClick={selectAll}>
            Všetkých
          </button>

          <button type="button" style={styles.lightButton} onClick={clearSelected}>
            Vyčistiť
          </button>
        </div>

        <div style={styles.actionRight}>
          {currentIssue ? (
            <>
              <button
                type="button"
                style={{
                  ...styles.confirmButton,
                  opacity: loading || selected.length === 0 ? 0.55 : 1
                }}
                disabled={loading || selected.length === 0}
                onClick={updatePreparation}
              >
                {loading ? 'Ukladám...' : 'Uložiť zmeny'}
              </button>

              <button
                type="button"
                style={{
                  ...styles.cancelButton,
                  opacity: loading ? 0.55 : 1
                }}
                disabled={loading}
                onClick={cancelPreparation}
              >
                Zrušiť prípravu
              </button>
            </>
          ) : (
            <button
              type="button"
              style={{
                ...styles.confirmButton,
                opacity: loading || selected.length === 0 ? 0.55 : 1
              }}
              disabled={loading || selected.length === 0}
              onClick={confirmPreparation}
            >
              {loading ? 'Potvrdzujem...' : 'Potvrdiť prípravu'}
            </button>
          )}
        </div>
      </section>

      {message && (
        <section
          style={{
            ...styles.message,
            background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
            color: messageType === 'ok' ? '#166534' : '#991b1b',
            borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
          }}
        >
          {message}
        </section>
      )}

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div></div>
          <div>Osoba</div>
          <div>Jedlo</div>
          <div>Rola</div>
          <div>Stav</div>
        </div>

        {!filteredRows.length ? (
          <div style={styles.emptyState}>
            Nenašli sa žiadne osoby.
          </div>
        ) : (
          filteredRows.map((row: any) => {
            const isSelected = selected.includes(row.userId)
            const choice = String(row.typStravy || row.volba || '').toUpperCase()
            const selectable = canSelectRow(row, currentIssue)
            const isRemovedFromGroup =
              row.status === 'REMOVED' && row.removeReason === 'REMOVED_FROM_GROUP'

            return (
              <div
                key={row.rowId}
                style={{
                  ...styles.row,
                  background: isRemovedFromGroup
                    ? '#f3f4f6'
                    : isSelected
                      ? '#ecfdf5'
                      : '#fff',
                  borderColor: isRemovedFromGroup
                    ? '#d1d5db'
                    : isSelected
                      ? '#22c55e'
                      : '#e5e7eb',
                  opacity: isRemovedFromGroup ? 0.72 : 1,
                  cursor: selectable ? 'pointer' : 'not-allowed'
                }}
                onClick={() => toggleOne(row)}
              >
                <div style={styles.checkCell}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!selectable}
                    onChange={() => toggleOne(row)}
                    onClick={e => e.stopPropagation()}
                    style={styles.checkbox}
                  />
                </div>

                <div style={styles.personCell}>
                  <div style={styles.personName}>
                    {row.fullName || 'Bez mena'}
                  </div>

                  <div style={styles.personMeta}>
                    {row.email || '-'}
                    {row.telefon ? ` · ${row.telefon}` : ''}
                  </div>
                </div>

                <div>
                  <span
                    style={{
                      ...styles.choiceBadge,
                      background:
                        choice === 'MASO'
                          ? '#111827'
                          : choice === 'VEGE'
                            ? '#dcfce7'
                            : '#fef3c7',
                      color:
                        choice === 'MASO'
                          ? '#fff'
                          : choice === 'VEGE'
                            ? '#166534'
                            : '#92400e'
                    }}
                  >
                    {choiceLabel(choice)}
                  </span>
                </div>

                <div>
                  <span style={styles.roleBadge}>
                    {row.role || '-'}
                  </span>
                </div>

                <div>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background:
                        row.status === 'PLANNED'
                          ? '#dbeafe'
                          : isRemovedFromGroup
                            ? '#fee2e2'
                            : row.status === 'REMOVED'
                              ? '#f3f4f6'
                              : '#dcfce7',
                      color:
                        row.status === 'PLANNED'
                          ? '#1d4ed8'
                          : isRemovedFromGroup
                            ? '#991b1b'
                            : row.status === 'REMOVED'
                              ? '#374151'
                              : '#166534'
                    }}
                  >
                    {itemStatusLabel(row)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </section>

      <section style={styles.bottomSpace} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 10
  },
  mobileHeader: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.05)'
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 800,
    color: '#6b7280',
    marginBottom: 3
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1.1,
    fontWeight: 950
  },
  closeButton: {
    background: '#111827',
    color: '#fff',
    borderRadius: 12,
    padding: '9px 11px',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 900,
    whiteSpace: 'nowrap'
  },
  modeBar: {
    border: '1px solid',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center'
  },
  modeMain: {
    minWidth: 0,
    display: 'grid',
    gap: 5
  },
  modeStatus: {
    background: '#111827',
    color: '#fff',
    borderRadius: 12,
    padding: '8px 10px',
    display: 'grid',
    justifyItems: 'center',
    minWidth: 82
  },
  topGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 10
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  panelHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 10
  },
  tinyButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '6px 9px',
    fontSize: 11,
    fontWeight: 900
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10
  },
  field: {
    display: 'grid',
    gap: 4,
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280',
    minWidth: 0
  },
  input: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    overflow: 'hidden'
  },
  metaLine: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    fontWeight: 850,
    color: '#374151'
  },
  waitNotice: {
    marginTop: 9,
    border: '1px solid',
    borderRadius: 12,
    padding: 9,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.35
  },
  emptySmall: {
    background: '#f9fafb',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  activeList: {
    display: 'grid',
    gap: 7
  },
  activeIssue: {
    width: '100%',
    textAlign: 'left',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    color: '#111827',
    display: 'grid',
    gap: 5
  },
  activeIssueTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 13
  },
  activeIssueBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  activeIssueTime: {
    fontSize: 11,
    fontWeight: 800,
    color: '#9a3412'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
    gap: 8
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '9px 6px',
    textAlign: 'center',
    color: '#111827',
    boxShadow: '0 4px 14px rgba(0,0,0,0.04)'
  },
  selectedStat: {
    background: '#ecfdf5',
    borderColor: '#22c55e'
  },
  removedStat: {
    background: '#fee2e2',
    borderColor: '#fecaca',
    color: '#991b1b'
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 130px',
    gap: 8
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
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
    minWidth: 0,
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
    gap: 8,
    flexWrap: 'wrap'
  },
  actionLeft: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap'
  },
  actionRight: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap'
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 11px',
    fontSize: 12,
    fontWeight: 900
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 11px',
    fontSize: 12,
    fontWeight: 900
  },
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  cancelButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  message: {
    border: '1px solid',
    borderRadius: 14,
    padding: 11,
    fontSize: 13,
    fontWeight: 850
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 620,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 86px 150px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  row: {
    minWidth: 620,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 86px 150px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
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
    fontSize: 11,
    fontWeight: 700,
    color: '#6b7280',
    overflowWrap: 'anywhere'
  },
  choiceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 62,
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 950
  },
  roleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 900,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  },
  bottomSpace: {
    height: 20
  }
}