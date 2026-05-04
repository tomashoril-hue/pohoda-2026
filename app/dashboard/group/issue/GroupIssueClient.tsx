'use client'

import { useMemo, useState } from 'react'
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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    return members.filter(member => {
      const memberChoice = String(member.typStravy || '').toUpperCase()

      const matchesSearch =
        !q ||
        String(member.fullName || '').toLowerCase().includes(q) ||
        String(member.email || '').toLowerCase().includes(q) ||
        String(member.telefon || '').toLowerCase().includes(q)

      const matchesChoice =
        choiceFilter === 'ALL' ||
        (choiceFilter === 'MASO' && memberChoice === 'MASO') ||
        (choiceFilter === 'VEGE' && memberChoice === 'VEGE') ||
        (choiceFilter === 'UNKNOWN' && memberChoice !== 'MASO' && memberChoice !== 'VEGE')

      return matchesSearch && matchesChoice
    })
  }, [members, search, choiceFilter])

  const allFilteredSelected =
    filteredMembers.length > 0 &&
    filteredMembers.every(member => selected.includes(member.userId))

  const selectedMembers = members.filter(member => selected.includes(member.userId))

  const masoCount = members.filter(member => String(member.typStravy || '').toUpperCase() === 'MASO').length
  const vegeCount = members.filter(member => String(member.typStravy || '').toUpperCase() === 'VEGE').length
  const unknownCount = members.filter(member => {
    const choice = String(member.typStravy || '').toUpperCase()
    return choice !== 'MASO' && choice !== 'VEGE'
  }).length

  const toggleOne = (userId: string) => {
    setSelected(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const toggleFiltered = () => {
    if (allFilteredSelected) {
      setSelected(prev =>
        prev.filter(id => !filteredMembers.some(member => member.userId === id))
      )
      return
    }

    setSelected(prev => {
      const next = new Set(prev)
      filteredMembers.forEach(member => next.add(member.userId))
      return Array.from(next)
    })
  }

  const selectAll = () => {
    setSelected(members.map(member => member.userId))
  }

  const clearSelected = () => {
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

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Nastavenie</div>

          <div style={styles.formGrid}>
            <label style={styles.field}>
              <span>Dátum</span>
              <input
                type="date"
                value={datum}
                onChange={e => setDatum(e.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.field}>
              <span>Jedlo</span>
              <select
                value={typJedla}
                onChange={e => setTypJedla(e.target.value)}
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
            <div style={styles.waitNotice}>
              Poverená osoba: príprava bude aktívna až po 15 minútach.
            </div>
          )}
        </div>

        <div style={styles.panel}>
          <div style={styles.panelTitle}>Aktívne prípravy</div>

          {!activeIssues.length ? (
            <div style={styles.emptySmall}>
              Žiadna aktívna príprava.
            </div>
          ) : (
            <div style={styles.activeList}>
              {activeIssues.map((item: any) => (
                <a
                  key={item.id}
                  href={`/dashboard/group/issue/${item.id}`}
                  style={styles.activeIssue}
                >
                  <div>
                    <b>{formatDate(item.datum)} · {mealLabel(item.typ_jedla)}</b>
                    <span>{item.status}</span>
                  </div>

                  {item.valid_after && (
                    <small>{formatDateTime(item.valid_after)}</small>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      <section style={styles.statsGrid}>
        <button type="button" style={styles.statCard} onClick={selectAll}>
          <b>{members.length}</b>
          <span>Členovia</span>
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

        <button type="button" style={{ ...styles.statCard, ...styles.selectedStat }} onClick={() => {}}>
          <b>{selectedMembers.length}</b>
          <span>Vybraní</span>
        </button>
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
        </div>

        {!filteredMembers.length ? (
          <div style={styles.emptyState}>
            Nenašli sa žiadni členovia.
          </div>
        ) : (
          filteredMembers.map(member => {
            const isSelected = selected.includes(member.userId)
            const choice = String(member.typStravy || '').toUpperCase()

            return (
              <div
                key={member.userId}
                style={{
                  ...styles.row,
                  background: isSelected ? '#ecfdf5' : '#fff',
                  borderColor: isSelected ? '#22c55e' : '#e5e7eb'
                }}
                onClick={() => toggleOne(member.userId)}
              >
                <div style={styles.checkCell}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(member.userId)}
                    onClick={e => e.stopPropagation()}
                    style={styles.checkbox}
                  />
                </div>

                <div style={styles.personCell}>
                  <div style={styles.personName}>
                    {member.fullName || 'Bez mena'}
                  </div>

                  <div style={styles.personMeta}>
                    {member.email || '-'}
                    {member.telefon ? ` · ${member.telefon}` : ''}
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
                    {member.role}
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
  panelTitle: {
    fontSize: 13,
    fontWeight: 950,
    marginBottom: 10
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  field: {
    display: 'grid',
    gap: 4,
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 14,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
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
    background: '#fff7ed',
    color: '#9a3412',
    border: '1px solid #fed7aa',
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
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    color: '#111827',
    textDecoration: 'none',
    display: 'grid',
    gap: 3
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
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
    gap: 8,
    flexWrap: 'wrap'
  },
  actionLeft: {
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
    overflow: 'hidden',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 76px',
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
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 82px 76px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer'
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
    color: '#374151'
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