'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type GroupItem = {
  id: string
  name: string
}

type Person = {
  id: string
  meno: string
  priezvisko: string
  fullName: string
  email: string
  telefon: string
  typStravy: string
  qrCode: string
  aktivny: string
  periods: Array<{
    id: string
    valid_from: string
    valid_to: string | null
  }>
  entitlements: Array<{
    datum: string
    obed: boolean
    vecera: boolean
  }>
  lunchClaims: number
  dinnerClaims: number
}

function normalizeText(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export default function UpravaBrigadnikovClient({
  groups,
  defaultFrom,
  defaultTo,
  actorName
}: {
  groups: GroupItem[]
  defaultFrom: string
  defaultTo: string
  actorName: string
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id || '')
  const [people, setPeople] = useState<Person[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [validFrom, setValidFrom] = useState(defaultFrom)
  const [validTo, setValidTo] = useState(defaultTo)
  const [obed, setObed] = useState(true)
  const [vecera, setVecera] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [activeAction, setActiveAction] = useState('')

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedGroup = groups.find(group => group.id === groupId)

  const filteredPeople = useMemo(() => {
    const query = normalizeText(search)

    if (!query) return people

    return people.filter(person => {
      return [
        person.fullName,
        person.email,
        person.telefon,
        person.typStravy,
        person.qrCode
      ].some(value => normalizeText(value || '').includes(query))
    })
  }, [people, search])

  const selectedPeople = useMemo(() => {
    return people.filter(person => selectedSet.has(person.id))
  }, [people, selectedSet])

  const loadPeople = async () => {
    if (!groupId) return

    setLoading(true)
    setMessage('')
    setMessageType('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: groupId,
        validFrom,
        validTo
      })
      const res = await fetch(`/api/uprava-brigadnikov/people?${params.toString()}`)
      const json = await res.json().catch(() => ({ error: 'Server vratil neplatnu odpoved.' }))

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa nacitat ludi.')
        setMessageType('error')
        setPeople([])
        setSelectedIds([])
        return
      }

      setPeople(json.people || [])
      setSelectedIds(current => current.filter(id => (json.people || []).some((person: Person) => person.id === id)))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      setMessageType('error')
      setPeople([])
      setSelectedIds([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPeople()
  }, [groupId])

  const buttonStyle = (base: React.CSSProperties, action: string, disabled = false) => ({
    ...base,
    ...(activeAction === action ? styles.buttonPressed : {}),
    opacity: disabled ? 0.56 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  })

  const togglePerson = (id: string) => {
    setSelectedIds(current => (
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id]
    ))
  }

  const selectVisible = () => {
    setSelectedIds(current => Array.from(new Set([...current, ...filteredPeople.map(person => person.id)])))
  }

  const clearSelection = () => {
    setSelectedIds([])
  }

  const submit = async (mode: 'SET' | 'CLEAR') => {
    if (!groupId) {
      setMessage('Chyba registracna skupina.')
      setMessageType('error')
      return
    }

    if (selectedIds.length === 0) {
      setMessage('Najprv oznac aspon jednu osobu.')
      setMessageType('error')
      return
    }

    if (!validFrom || !validTo || validTo < validFrom) {
      setMessage('Zadaj platne datumy od/do.')
      setMessageType('error')
      return
    }

    if (mode === 'SET' && !obed && !vecera) {
      setMessage('Vyber obed alebo veceru.')
      setMessageType('error')
      return
    }

    const action = mode === 'SET' ? 'save' : 'clear'
    setSaving(true)
    setActiveAction(action)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/uprava-brigadnikov/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: groupId,
          userIds: selectedIds,
          validFrom,
          validTo,
          mode,
          obed,
          vecera
        })
      })
      const json = await res.json().catch(() => ({ error: 'Server vratil neplatnu odpoved.' }))

      if (!res.ok || json.error) {
        setMessage(json.error || 'Ulozenie zlyhalo.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Zmeny boli ulozene.')
      setMessageType('ok')
      await loadPeople()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
      setMessageType('error')
    } finally {
      setSaving(false)
      setActiveAction('')
    }
  }

  return (
    <main className="brigadnici-page" style={styles.page}>
      <style>{`
        .brigadnici-page button,
        .brigadnici-page a[href],
        .brigadnici-page select,
        .brigadnici-page input {
          touch-action: manipulation;
        }

        .brigadnici-page button,
        .brigadnici-page a[href] {
          cursor: pointer;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .brigadnici-page button:not(:disabled):active,
        .brigadnici-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @media (max-width: 720px) {
          .brigadnici-page { padding: 10px !important; }
          .brigadnici-card { padding: 10px !important; border-radius: 8px !important; }
          .brigadnici-header { padding: 14px !important; }
          .brigadnici-title { font-size: 25px !important; }
          .brigadnici-grid { grid-template-columns: 1fr !important; }
          .brigadnici-actions { grid-template-columns: 1fr 1fr !important; }
          .brigadnici-person-row { grid-template-columns: 32px 1fr !important; }
          .brigadnici-person-meta { grid-column: 2 !important; }
        }
      `}</style>

      <section className="brigadnici-card" style={styles.card}>
        <header className="brigadnici-header" style={styles.header}>
          <div>
            <div style={styles.kicker}>Registracne skupiny</div>
            <h1 className="brigadnici-title" style={styles.title}>Úprava brigádnikov</h1>
            <p style={styles.subtitle}>
              Nastav naroky na stravu. Zaradenie do tvojej registracnej skupiny sa upravi podla zadaneho obdobia.
            </p>
          </div>

          <Link href="/dashboard" style={styles.homeButton}>
            Domov
          </Link>
        </header>

        <div className="brigadnici-grid" style={styles.settingsGrid}>
          <label style={styles.field}>
            <span>Registracna skupina</span>
            <select
              value={groupId}
              onChange={event => {
                setGroupId(event.target.value)
                setSelectedIds([])
              }}
              style={styles.input}
              disabled={groups.length <= 1 || loading || saving}
            >
              {groups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>

          <label style={styles.field}>
            <span>Od</span>
            <input type="date" value={validFrom} onChange={event => setValidFrom(event.target.value)} style={styles.input} />
          </label>

          <label style={styles.field}>
            <span>Do</span>
            <input type="date" value={validTo} onChange={event => setValidTo(event.target.value)} style={styles.input} />
          </label>

          <label style={styles.field}>
            <span>Hladat</span>
            <input value={search} onChange={event => setSearch(event.target.value)} style={styles.input} placeholder="Meno, email, telefon" />
          </label>
        </div>

        <div style={styles.claimBox}>
          <label style={styles.checkCard}>
            <input type="checkbox" checked={obed} onChange={event => setObed(event.target.checked)} />
            <span>Obed</span>
          </label>
          <label style={styles.checkCard}>
            <input type="checkbox" checked={vecera} onChange={event => setVecera(event.target.checked)} />
            <span>Vecera</span>
          </label>
          <button type="button" style={buttonStyle(styles.lightButton, 'reload', loading || saving)} onClick={loadPeople} disabled={loading || saving}>
            Obnovit
          </button>
        </div>

        <div style={styles.summary}>
          <b>{selectedGroup?.name || '-'}</b>
          <span>Prihlaseny: {actorName || '-'}</span>
          <span>Ludi: {people.length}</span>
          <span>Oznacenych: {selectedIds.length}</span>
        </div>

        {message && (
          <div style={{
            ...styles.message,
            background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
            borderColor: messageType === 'ok' ? '#86efac' : '#fecaca',
            color: messageType === 'ok' ? '#166534' : '#991b1b'
          }}>
            {message}
          </div>
        )}

        <div className="brigadnici-actions" style={styles.actionBar}>
          <button type="button" style={buttonStyle(styles.lightButton, 'select-visible', filteredPeople.length === 0 || saving)} onClick={selectVisible} disabled={filteredPeople.length === 0 || saving}>
            Oznacit zobrazene
          </button>
          <button type="button" style={buttonStyle(styles.lightButton, 'clear-selected', selectedIds.length === 0 || saving)} onClick={clearSelection} disabled={selectedIds.length === 0 || saving}>
            Zrusit oznacenie
          </button>
          <button type="button" style={buttonStyle(styles.primaryButton, 'save', selectedIds.length === 0 || saving)} onClick={() => void submit('SET')} disabled={selectedIds.length === 0 || saving}>
            {saving && activeAction === 'save' ? 'Ukladam...' : 'Ulozit naroky'}
          </button>
          <button type="button" style={buttonStyle(styles.dangerButton, 'clear', selectedIds.length === 0 || saving)} onClick={() => void submit('CLEAR')} disabled={selectedIds.length === 0 || saving}>
            {saving && activeAction === 'clear' ? 'Mazem...' : 'Vymazat naroky'}
          </button>
        </div>

        <section style={styles.peopleBox}>
          {loading ? (
            <div style={styles.empty}>Nacitavam ludi...</div>
          ) : filteredPeople.length === 0 ? (
            <div style={styles.empty}>V tejto skupine nie su ziadni ludia alebo filter nic nenasiel.</div>
          ) : (
            filteredPeople.map(person => (
              <label key={person.id} className="brigadnici-person-row" style={{
                ...styles.personRow,
                ...(selectedSet.has(person.id) ? styles.personRowSelected : {})
              }}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(person.id)}
                  onChange={() => togglePerson(person.id)}
                  style={styles.personCheckbox}
                />

                <span style={styles.personMain}>
                  <b>{person.fullName || 'Bez mena'}</b>
                  <small>{person.email || '-'} {person.telefon ? `· ${person.telefon}` : ''}</small>
                </span>

                <span className="brigadnici-person-meta" style={styles.personMeta}>
                  <b>{person.typStravy || '-'}</b>
                  <small>Obedy: {person.lunchClaims} · Vecere: {person.dinnerClaims}</small>
                </span>
              </label>
            ))
          )}
        </section>

        {selectedPeople.length > 0 && (
          <div style={styles.selectedPreview}>
            {selectedPeople.slice(0, 8).map(person => person.fullName).join(', ')}
            {selectedPeople.length > 8 ? ` a dalsich ${selectedPeople.length - 8}` : ''}
          </div>
        )}
      </section>
    </main>
  )
}

const buttonBase: React.CSSProperties = {
  minHeight: 38,
  borderRadius: 6,
  padding: '0 12px',
  fontSize: 13,
  fontWeight: 900,
  fontFamily: 'Arial, Helvetica, sans-serif',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
  boxSizing: 'border-box'
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#f3f4f6',
    padding: 14,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
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
  header: {
    background: '#111827',
    color: '#fff',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  kicker: {
    fontSize: 12,
    fontWeight: 950,
    color: '#86efac'
  },
  title: {
    margin: '4px 0 0 0',
    fontSize: 30,
    lineHeight: 1.05,
    fontWeight: 950
  },
  subtitle: {
    margin: '8px 0 0 0',
    maxWidth: 640,
    fontSize: 13,
    fontWeight: 750,
    color: '#d1d5db',
    lineHeight: 1.35
  },
  homeButton: {
    ...buttonBase,
    background: '#fff',
    color: '#111827',
    border: '1px solid #e5e7eb'
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 1.4fr) repeat(3, minmax(140px, 1fr))',
    gap: 8
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 12,
    fontWeight: 900,
    color: '#334155'
  },
  input: {
    minHeight: 38,
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    padding: '0 10px',
    fontSize: 14,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    boxSizing: 'border-box',
    width: '100%'
  },
  claimBox: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  checkCard: {
    minHeight: 38,
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    padding: '0 12px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 900,
    background: '#f8fafc',
    color: '#111827'
  },
  summary: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 14px',
    alignItems: 'center',
    background: '#f8fafc',
    fontSize: 13,
    fontWeight: 800,
    color: '#334155'
  },
  message: {
    border: '1px solid',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    fontWeight: 850
  },
  actionBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8
  },
  primaryButton: {
    ...buttonBase,
    border: '1px solid #15803d',
    background: '#16a34a',
    color: '#fff'
  },
  lightButton: {
    ...buttonBase,
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#111827'
  },
  dangerButton: {
    ...buttonBase,
    border: '1px solid #fecaca',
    background: '#fee2e2',
    color: '#991b1b'
  },
  buttonPressed: {
    transform: 'scale(0.98)',
    filter: 'brightness(0.96)'
  },
  peopleBox: {
    display: 'grid',
    gap: 6,
    maxHeight: 520,
    overflow: 'auto',
    paddingRight: 3,
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch'
  },
  personRow: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(220px, 1fr) 180px',
    gap: 10,
    alignItems: 'center',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 9,
    background: '#fff',
    cursor: 'pointer'
  },
  personRowSelected: {
    borderColor: '#86efac',
    background: '#f0fdf4'
  },
  personCheckbox: {
    width: 18,
    height: 18
  },
  personMain: {
    display: 'grid',
    gap: 3,
    fontSize: 14,
    fontWeight: 850
  },
  personMeta: {
    display: 'grid',
    gap: 3,
    fontSize: 12,
    fontWeight: 850,
    color: '#64748b'
  },
  empty: {
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    background: '#f8fafc',
    padding: 14,
    fontSize: 13,
    fontWeight: 850,
    color: '#64748b',
    textAlign: 'center'
  },
  selectedPreview: {
    borderRadius: 8,
    background: '#111827',
    color: '#fff',
    padding: 10,
    fontSize: 12,
    fontWeight: 850,
    lineHeight: 1.35
  }
}
