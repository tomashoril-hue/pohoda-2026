'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'

type GroupItem = {
  id: string
  name: string
}

type PersonGroup = {
  id: string
  name: string
  role: string
}

type PersonItem = {
  id: string
  fullName: string
  meno: string
  priezvisko: string
  email: string
  telefon: string
  typStravy: string
  activeQrCount: number
  entitlementDays: number
  lunchClaims: number
  dinnerClaims: number
  mealClaims: number
  groups: PersonGroup[]
}

function foodLabel(value: string) {
  const normalized = String(value || '').toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIÉTA') return 'DIÉTA'

  return 'NEZADANÉ'
}

function rolePriority(person: PersonItem) {
  if (person.groups.some(group => group.role === 'OWNER')) return 0
  if (person.groups.some(group => group.role === 'MANAGER')) return 1
  if (person.groups.some(group => group.role === 'POVERENY')) return 2
  return 3
}

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export default function PersonalistaClient({
  people,
  groups,
  fromDate,
  toDate,
  canManage
}: {
  people: PersonItem[]
  groups: GroupItem[]
  fromDate: string
  toDate: string
  canManage: boolean
}) {
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('ALL')
  const [foodFilter, setFoodFilter] = useState('ALL')
  const [qrFilter, setQrFilter] = useState('ALL')
  const [selectedPersonId, setSelectedPersonId] = useState(people[0]?.id || '')
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createMessage, setCreateMessage] = useState('')
  const [createMessageType, setCreateMessageType] = useState<'ok' | 'error' | ''>('')
  const [createForm, setCreateForm] = useState({
    meno: '',
    priezvisko: '',
    email: '',
    telefon: '',
    typStravy: 'MASO',
    groupIds: [] as string[],
    validFrom: isoDateOffset(0),
    validTo: isoDateOffset(0),
    obed: true,
    vecera: false,
    assignQr: true
  })

  const selectedPerson = people.find(person => person.id === selectedPersonId) || people[0] || null

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase()

    return people
      .filter(person => {
        if (!q) return true

        return (
          person.fullName.toLowerCase().includes(q) ||
          person.email.toLowerCase().includes(q) ||
          person.telefon.toLowerCase().includes(q)
        )
      })
      .filter(person => {
        if (groupFilter === 'ALL') return true
        if (groupFilter === 'UNGROUPED') return person.groups.length === 0
        return person.groups.some(group => group.id === groupFilter)
      })
      .filter(person => {
        if (foodFilter === 'ALL') return true
        return foodLabel(person.typStravy) === foodFilter
      })
      .filter(person => {
        if (qrFilter === 'ALL') return true
        if (qrFilter === 'ACTIVE') return person.activeQrCount > 0
        return person.activeQrCount === 0
      })
      .sort((a, b) => {
        const priority = rolePriority(a) - rolePriority(b)
        if (priority !== 0) return priority

        return a.fullName.localeCompare(b.fullName, 'sk')
      })
  }, [people, search, groupFilter, foodFilter, qrFilter])

  const stats = useMemo(() => {
    const activeQr = people.filter(person => person.activeQrCount > 0).length
    const withoutQr = people.length - activeQr
    const withDiet = people.filter(person => foodLabel(person.typStravy) === 'DIÉTA').length
    const totalClaims = people.reduce((sum, person) => sum + person.mealClaims, 0)
    const totalLunches = people.reduce((sum, person) => sum + person.lunchClaims, 0)
    const totalDinners = people.reduce((sum, person) => sum + person.dinnerClaims, 0)
    const totalDays = people.reduce((sum, person) => sum + person.entitlementDays, 0)

    return {
      activeQr,
      withoutQr,
      withDiet,
      totalClaims,
      totalLunches,
      totalDinners,
      totalDays
    }
  }, [people])

  const updateCreateForm = (key: string, value: any) => {
    setCreateForm(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const toggleCreateGroup = (groupId: string) => {
    setCreateForm(prev => {
      const hasGroup = prev.groupIds.includes(groupId)

      return {
        ...prev,
        groupIds: hasGroup
          ? prev.groupIds.filter(id => id !== groupId)
          : [...prev.groupIds, groupId]
      }
    })
  }

  const resetCreateForm = () => {
    setCreateForm({
      meno: '',
      priezvisko: '',
      email: '',
      telefon: '',
      typStravy: 'MASO',
      groupIds: [] as string[],
      validFrom: isoDateOffset(0),
      validTo: isoDateOffset(0),
      obed: true,
      vecera: false,
      assignQr: true
    })
  }

  const createPerson = async () => {
    setCreateMessage('')
    setCreateMessageType('')

    if (!canManage) {
      setCreateMessage('Nemáš oprávnenie vytvárať osoby.')
      setCreateMessageType('error')
      return
    }

    setCreateLoading(true)

    try {
      const res = await fetch('/api/personalista/people/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm)
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setCreateMessage('Server vrátil neplatnú odpoveď.')
        setCreateMessageType('error')
        return
      }

      if (!res.ok || json.error) {
        setCreateMessage(json.error || 'Osobu sa nepodarilo vytvoriť.')
        setCreateMessageType('error')
        return
      }

      setCreateMessage(json.message || 'Osoba bola vytvorená.')
      setCreateMessageType('ok')
      resetCreateForm()

      setTimeout(() => {
        setCreateOpen(false)
        router.refresh()
      }, 650)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCreateMessage('Chyba spojenia so serverom: ' + message)
      setCreateMessageType('error')
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Prehľad / Personalista</div>
          <h1 style={styles.title}>Personalista</h1>
          <p style={styles.subtitle}>
            Ľudia, skupiny, QR stav a nároky na stravu.
          </p>
        </div>

        <div style={styles.headerActions}>
          <a href="/dashboard/groups" style={styles.lightButton}>
            Skupiny
          </a>

          <a href="/dashboard" style={styles.darkButton}>
            Späť na prehľad
          </a>
        </div>
      </header>

      {!canManage && (
        <section style={styles.warningBox}>
          Na túto obrazovku potrebuješ rolu MANAGER alebo OWNER aspoň v jednej skupine.
        </section>
      )}

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <b>{people.length}</b>
          <span>Ľudí</span>
        </div>

        <div style={styles.summaryCardBlue}>
          <b>{groups.length}</b>
          <span>Skupín</span>
        </div>

        <div style={styles.summaryCardGreen}>
          <b>{stats.activeQr}</b>
          <span>Aktívny QR</span>
        </div>

        <div style={styles.summaryCardOrange}>
          <b>{stats.totalClaims}</b>
          <span>Nároky {fromDate} - {toDate}</span>
          <small>{stats.totalLunches} obed / {stats.totalDinners} večera / {stats.totalDays} dní</small>
        </div>

        <div style={styles.summaryCardPink}>
          <b>{stats.withDiet}</b>
          <span>DIÉTA</span>
        </div>
      </section>

      <section style={styles.actionPanel}>
        <button
          type="button"
          style={{
            ...styles.primaryAction,
            opacity: canManage ? 1 : 0.55,
            cursor: canManage ? 'pointer' : 'not-allowed'
          }}
          disabled={!canManage}
          onClick={() => {
            setCreateOpen(prev => !prev)
            setCreateMessage('')
            setCreateMessageType('')
          }}
        >
          Ručne pridať človeka
        </button>

        <button type="button" style={styles.actionButton} disabled>
          Generovať prázdne QR
        </button>

        <button type="button" style={styles.actionButton} disabled>
          Import Excel/CSV
        </button>

        <button type="button" style={styles.actionButton} disabled>
          Google Sheets
        </button>

        <button type="button" style={styles.actionButton} disabled>
          Tlač QR
        </button>

        <button type="button" style={styles.actionButton} disabled>
          QR/NFC párovanie
        </button>
      </section>

      {createOpen && (
        <section style={styles.createPanel}>
          <div style={styles.createHeader}>
            <div>
              <b>Ručné vytvorenie osoby</b>
              <span>Email aj skupina sú voliteľné. Nárok sa vytvorí pre každý deň vo vybranom období.</span>
            </div>

            <button
              type="button"
              style={styles.closeButton}
              disabled={createLoading}
              onClick={() => {
                setCreateOpen(false)
                setCreateMessage('')
                setCreateMessageType('')
              }}
            >
              ×
            </button>
          </div>

          <div style={styles.createGrid}>
            <label style={styles.field}>
              <span>Meno</span>
              <input
                value={createForm.meno}
                onChange={event => updateCreateForm('meno', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
              />
            </label>

            <label style={styles.field}>
              <span>Priezvisko</span>
              <input
                value={createForm.priezvisko}
                onChange={event => updateCreateForm('priezvisko', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
              />
            </label>

            <label style={styles.field}>
              <span>Email</span>
              <input
                value={createForm.email}
                onChange={event => updateCreateForm('email', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
                inputMode="email"
              />
            </label>

            <label style={styles.field}>
              <span>Telefón</span>
              <input
                value={createForm.telefon}
                onChange={event => updateCreateForm('telefon', event.target.value)}
                style={styles.input}
                disabled={createLoading}
                autoComplete="off"
                inputMode="tel"
              />
            </label>

            <label style={styles.field}>
              <span>Typ stravy</span>
              <select
                value={createForm.typStravy}
                onChange={event => updateCreateForm('typStravy', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              >
                <option value="MASO">MASO</option>
                <option value="VEGE">VEGE</option>
                <option value="DIETA">DIÉTA</option>
              </select>
            </label>

            <label style={styles.field}>
              <span>Od</span>
              <input
                type="date"
                value={createForm.validFrom}
                onChange={event => updateCreateForm('validFrom', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              />
            </label>

            <label style={styles.field}>
              <span>Do</span>
              <input
                type="date"
                value={createForm.validTo}
                onChange={event => updateCreateForm('validTo', event.target.value)}
                style={styles.input}
                disabled={createLoading}
              />
            </label>
          </div>

          <div style={styles.createOptionsGrid}>
            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Skupiny</div>
              <div style={styles.optionHint}>Ak neoznačíš skupinu, osoba vznikne bez skupiny.</div>

              <div style={styles.checkList}>
                {groups.map(group => (
                  <label key={group.id} style={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={createForm.groupIds.includes(group.id)}
                      onChange={() => toggleCreateGroup(group.id)}
                      disabled={createLoading}
                      style={styles.checkbox}
                    />
                    <span>{group.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={styles.optionBox}>
              <div style={styles.optionTitle}>Nárok a identifikácia</div>

              <div style={styles.checkList}>
                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.obed}
                    onChange={event => updateCreateForm('obed', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Obed</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.vecera}
                    onChange={event => updateCreateForm('vecera', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Večera</span>
                </label>

                <label style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={createForm.assignQr}
                    onChange={event => updateCreateForm('assignQr', event.target.checked)}
                    disabled={createLoading}
                    style={styles.checkbox}
                  />
                  <span>Priradiť voľný QR</span>
                </label>
              </div>
            </div>
          </div>

          <div style={styles.createFooter}>
            <button
              type="button"
              style={styles.lightButton}
              disabled={createLoading}
              onClick={resetCreateForm}
            >
              Vyčistiť
            </button>

            <button
              type="button"
              style={{
                ...styles.confirmButton,
                opacity: createLoading ? 0.6 : 1
              }}
              disabled={createLoading}
              onClick={createPerson}
            >
              {createLoading ? 'Ukladám...' : 'Vytvoriť osobu'}
            </button>
          </div>

          {createMessage && (
            <div
              style={{
                ...styles.message,
                background: createMessageType === 'ok' ? '#dcfce7' : '#fee2e2',
                color: createMessageType === 'ok' ? '#166534' : '#991b1b',
                borderColor: createMessageType === 'ok' ? '#86efac' : '#fecaca'
              }}
            >
              {createMessage}
            </div>
          )}
        </section>
      )}

      <section style={styles.layoutGrid}>
        <div style={styles.leftColumn}>
          <section style={styles.toolbar}>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Hľadať meno, email, telefón..."
              style={styles.searchInput}
              autoComplete="off"
            />

            <select
              value={groupFilter}
              onChange={event => setGroupFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky skupiny</option>
              <option value="UNGROUPED">Bez skupiny</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            <select
              value={foodFilter}
              onChange={event => setFoodFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetka strava</option>
              <option value="MASO">MASO</option>
              <option value="VEGE">VEGE</option>
              <option value="DIÉTA">DIÉTA</option>
              <option value="NEZADANÉ">NEZADANÉ</option>
            </select>

            <select
              value={qrFilter}
              onChange={event => setQrFilter(event.target.value)}
              style={styles.select}
            >
              <option value="ALL">Všetky QR</option>
              <option value="ACTIVE">Aktívny QR</option>
              <option value="MISSING">Bez QR</option>
            </select>
          </section>

          <section style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <span>Osoba</span>
              <span>Skupiny</span>
              <span>Strava</span>
              <span>QR</span>
              <span>Nároky</span>
            </div>

            {filteredPeople.length === 0 ? (
              <div style={styles.emptyState}>
                Nenašli sa žiadni ľudia.
              </div>
            ) : (
              filteredPeople.map(person => {
                const selected = selectedPerson?.id === person.id

                return (
                  <button
                    key={person.id}
                    type="button"
                    style={{
                      ...styles.personRow,
                      background: selected ? '#eff6ff' : '#fff',
                      borderColor: selected ? '#93c5fd' : '#e5e7eb'
                    }}
                    onClick={() => setSelectedPersonId(person.id)}
                  >
                    <div style={styles.personCell}>
                      <b>{person.fullName}</b>
                      <span>
                        {person.email || '-'}
                        {person.telefon ? ` · ${person.telefon}` : ''}
                      </span>
                    </div>

                    <div style={styles.groupBadges}>
                      {person.groups.length === 0 && (
                        <span style={styles.groupBadge}>
                          Bez skupiny
                        </span>
                      )}

                      {person.groups.slice(0, 3).map(group => (
                        <span key={`${person.id}-${group.id}`} style={styles.groupBadge}>
                          {group.name}
                        </span>
                      ))}

                      {person.groups.length > 3 && (
                        <span style={styles.moreBadge}>+{person.groups.length - 3}</span>
                      )}
                    </div>

                    <div>
                      <span style={styles.foodBadge}>
                        {foodLabel(person.typStravy)}
                      </span>
                    </div>

                    <div>
                      <span
                        style={{
                          ...styles.qrBadge,
                          background: person.activeQrCount > 0 ? '#dcfce7' : '#fee2e2',
                          color: person.activeQrCount > 0 ? '#166534' : '#991b1b'
                        }}
                      >
                        {person.activeQrCount > 0 ? 'AKTÍVNY' : 'CHÝBA'}
                      </span>
                    </div>

                    <div style={styles.claimCell}>
                      <b>{person.mealClaims}</b>
                      <span>{person.lunchClaims} O / {person.dinnerClaims} V</span>
                      <span>{person.entitlementDays} dní</span>
                    </div>
                  </button>
                )
              })
            )}
          </section>
        </div>

        <aside style={styles.detailPanel}>
          {selectedPerson ? (
            <>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.detailSmall}>Detail osoby</div>
                  <h2 style={styles.detailTitle}>{selectedPerson.fullName}</h2>
                </div>

                <span style={styles.foodBadge}>
                  {foodLabel(selectedPerson.typStravy)}
                </span>
              </div>

              <div style={styles.detailRows}>
                <div style={styles.detailRow}>
                  <span>Email</span>
                  <b>{selectedPerson.email || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Telefón</span>
                  <b>{selectedPerson.telefon || '-'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>QR</span>
                  <b>{selectedPerson.activeQrCount > 0 ? 'Aktívny' : 'Chýba'}</b>
                </div>

                <div style={styles.detailRow}>
                  <span>Nároky</span>
                  <b>{selectedPerson.mealClaims} jedál / {selectedPerson.entitlementDays} dní</b>
                  <small>{selectedPerson.lunchClaims} obed / {selectedPerson.dinnerClaims} večera</small>
                </div>
              </div>

              <div style={styles.sectionTitle}>Skupiny</div>

              <div style={styles.detailGroups}>
                {selectedPerson.groups.length === 0 && (
                  <div style={styles.detailGroupRow}>
                    <b>Bez skupiny</b>
                    <span>-</span>
                  </div>
                )}

                {selectedPerson.groups.map(group => (
                  <div key={group.id} style={styles.detailGroupRow}>
                    <b>{group.name}</b>
                    <span>{group.role || 'MEMBER'}</span>
                  </div>
                ))}
              </div>

              <div style={styles.sectionTitle}>Akcie</div>

              <div style={styles.detailActions}>
                <button type="button" style={styles.actionButton} disabled>
                  Zmeniť stravu
                </button>

                <button type="button" style={styles.actionButton} disabled>
                  Upraviť nároky
                </button>

                <button type="button" style={styles.actionButton} disabled>
                  Vymeniť QR
                </button>

                <button type="button" style={styles.actionButton} disabled>
                  Priradiť NFC
                </button>
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              Vyber osobu zo zoznamu.
            </div>
          )}
        </aside>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
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
    fontSize: 26,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  warningBox: {
    background: '#ffedd5',
    color: '#9a3412',
    border: '1px solid #fdba74',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardBlue: {
    background: '#eff6ff',
    border: '1px solid #93c5fd',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#1d4ed8',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardGreen: {
    background: '#ecfdf5',
    border: '1px solid #86efac',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#166534',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardOrange: {
    background: '#fff7ed',
    border: '1px solid #fdba74',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#9a3412',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  summaryCardPink: {
    background: '#fdf2f8',
    border: '1px solid #f9a8d4',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3,
    color: '#9d174d',
    boxShadow: '0 5px 16px rgba(0,0,0,0.04)'
  },
  actionPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  layoutGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    gap: 12,
    alignItems: 'start'
  },
  leftColumn: {
    minWidth: 0,
    display: 'grid',
    gap: 10
  },
  toolbar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 8,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 16,
    fontWeight: 800,
    outline: 'none',
    background: '#fff',
    color: '#111827'
  },
  select: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 16,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 850,
    display: 'grid',
    gridTemplateColumns: 'minmax(210px, 1.3fr) minmax(180px, 1fr) 92px 88px 92px',
    gap: 10,
    alignItems: 'center',
    padding: '10px 12px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  personRow: {
    width: '100%',
    minWidth: 850,
    border: '0 solid #e5e7eb',
    borderBottomWidth: 1,
    padding: '10px 12px',
    display: 'grid',
    gridTemplateColumns: 'minmax(210px, 1.3fr) minmax(180px, 1fr) 92px 88px 92px',
    gap: 10,
    alignItems: 'center',
    textAlign: 'left',
    color: '#111827',
    cursor: 'pointer'
  },
  personCell: {
    minWidth: 0,
    display: 'grid',
    gap: 3
  },
  groupBadges: {
    minWidth: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5
  },
  groupBadge: {
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    borderRadius: 999,
    padding: '5px 8px',
    background: '#f3f4f6',
    color: '#374151',
    fontSize: 10,
    fontWeight: 900
  },
  moreBadge: {
    borderRadius: 999,
    padding: '5px 8px',
    background: '#111827',
    color: '#fff',
    fontSize: 10,
    fontWeight: 900
  },
  foodBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 950,
    background: '#eef2ff',
    color: '#3730a3',
    whiteSpace: 'nowrap'
  },
  qrBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  claimCell: {
    display: 'grid',
    gap: 2,
    fontSize: 11,
    fontWeight: 800,
    color: '#6b7280'
  },
  detailPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  detailSmall: {
    fontSize: 11,
    fontWeight: 900,
    color: '#6b7280'
  },
  detailTitle: {
    margin: '3px 0 0 0',
    fontSize: 20,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  detailRows: {
    display: 'grid',
    gap: 7
  },
  detailRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 3,
    overflowWrap: 'anywhere'
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  detailGroups: {
    display: 'grid',
    gap: 7
  },
  detailGroupRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center'
  },
  detailActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8
  },
  primaryAction: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  createPanel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 12,
    display: 'grid',
    gap: 12,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  createHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10
  },
  createGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',
    gap: 10
  },
  createOptionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: 10
  },
  optionBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'grid',
    gap: 8,
    background: '#f9fafb'
  },
  optionTitle: {
    fontSize: 12,
    fontWeight: 950,
    color: '#374151',
    textTransform: 'uppercase'
  },
  optionHint: {
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  checkList: {
    display: 'grid',
    gap: 7,
    maxHeight: 170,
    overflow: 'auto'
  },
  checkRow: {
    display: 'grid',
    gridTemplateColumns: '22px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 850,
    color: '#111827'
  },
  checkbox: {
    width: 18,
    height: 18
  },
  createFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap'
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 16,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: '#f3f4f6',
    color: '#111827',
    fontSize: 22,
    fontWeight: 900,
    lineHeight: 1,
    cursor: 'pointer'
  },
  confirmButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  actionButton: {
    background: '#f3f4f6',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'not-allowed',
    opacity: 0.65
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    border: 0,
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  }
}
