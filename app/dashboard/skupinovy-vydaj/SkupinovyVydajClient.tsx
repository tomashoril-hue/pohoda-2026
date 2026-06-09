'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type MealType = 'OBED' | 'VECERA'

type RegistrationGroupOption = {
  id: string
  name: string
  canManageDelegates: boolean
  accessLabel: string
}

type Delegate = {
  id: string
  userId: string
  registrationGroupId: string
  name: string
  email: string
  note: string
  createdAt: string
}

type SearchUser = {
  id: string
  name: string
  email: string
}

type Props = {
  initialDate: string
  groups: RegistrationGroupOption[]
  delegatesByGroupId: Record<string, Delegate[]>
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${value}T12:00:00`))
  } catch {
    return value
  }
}

function mealLabel(value: MealType) {
  return value === 'OBED' ? 'Obed' : 'Vecera'
}

export default function SkupinovyVydajClient({ initialDate, groups, delegatesByGroupId }: Props) {
  const [date, setDate] = useState(initialDate)
  const [meal, setMeal] = useState<MealType>('OBED')
  const [confirmed, setConfirmed] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || '')
  const [delegateMap, setDelegateMap] = useState<Record<string, Delegate[]>>(delegatesByGroupId)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [delegateNote, setDelegateNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'ok' | 'error'>('ok')

  const selectedGroup = useMemo(() => {
    return groups.find(group => group.id === selectedGroupId) || null
  }, [groups, selectedGroupId])

  const delegates = selectedGroupId ? delegateMap[selectedGroupId] || [] : []

  function setMessage(message: string, type: 'ok' | 'error' = 'ok') {
    setFeedback(message)
    setFeedbackType(type)
  }

  async function searchUsers(query: string) {
    setSearchQuery(query)
    setSearchResults([])

    if (!selectedGroupId || query.trim().length < 2) return

    setLoading(true)
    setMessage('')

    try {
      const params = new URLSearchParams({
        registrationGroupId: selectedGroupId,
        q: query
      })
      const res = await fetch(`/api/skupinovy-vydaj/delegates/search?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Vyhladavanie zlyhalo.')

      setSearchResults(json.users || [])
    } catch (err: any) {
      setMessage(err?.message || 'Vyhladavanie zlyhalo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function addDelegate(user: SearchUser) {
    if (!selectedGroupId) return

    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/delegates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          registrationGroupId: selectedGroupId,
          note: delegateNote
        })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo pridat.')

      setDelegateMap(current => ({
        ...current,
        [selectedGroupId]: json.delegates || []
      }))
      setSearchQuery('')
      setSearchResults([])
      setDelegateNote('')
      setMessage(json.message || 'Poverena osoba bola pridana.')
    } catch (err: any) {
      setMessage(err?.message || 'Poverenu osobu sa nepodarilo pridat.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function removeDelegate(delegate: Delegate) {
    if (!window.confirm(`Odobrat poverenie pre ${delegate.name}?`)) return

    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/skupinovy-vydaj/delegates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegateId: delegate.id })
      })
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Poverenu osobu sa nepodarilo odobrat.')

      setDelegateMap(current => ({
        ...current,
        [delegate.registrationGroupId]: json.delegates || []
      }))
      setMessage(json.message || 'Poverena osoba bola odobrana.')
    } catch (err: any) {
      setMessage(err?.message || 'Poverenu osobu sa nepodarilo odobrat.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="group-issue-page" style={styles.page}>
      <style>{`
        .group-issue-page button,
        .group-issue-page a[href] {
          cursor: pointer;
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .group-issue-page button:not(:disabled):active,
        .group-issue-page a[href]:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        .group-issue-page button:disabled {
          cursor: wait;
          opacity: 0.7;
        }

        @media (max-width: 720px) {
          .group-issue-page { padding: 12px !important; }
          .group-issue-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .group-issue-title { font-size: 31px !important; }
          .group-issue-actions { grid-template-columns: 1fr !important; }
          .group-issue-top { align-items: stretch !important; flex-direction: column !important; }
          .delegate-row { grid-template-columns: 1fr auto !important; }
        }
      `}</style>

      <section className="group-issue-card" style={styles.card}>
        <div className="group-issue-top" style={styles.topRow}>
          <div>
            <div style={styles.kicker}>Strava</div>
            <h1 className="group-issue-title" style={styles.title}>Skupinovy vydaj</h1>
            <p style={styles.subtitle}>Vyber den, jedlo a registracnu skupinu. Manager tu spravuje aj poverenych ludi.</p>
          </div>

          <Link href="/dashboard" style={styles.backButton}>
            Spat
          </Link>
        </div>

        {groups.length === 0 ? (
          <div style={styles.messageError}>Nemate pridelenu registracnu skupinu pre skupinovy vydaj.</div>
        ) : (
          <>
            <div style={styles.stepBadge}>Krok 1</div>

            <div style={styles.formGrid}>
              <label style={styles.field}>
                <span style={styles.label}>Datum skupinoveho vydaja</span>
                <input
                  type="date"
                  value={date}
                  onChange={event => {
                    setDate(event.target.value)
                    setConfirmed(false)
                  }}
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Registracna skupina</span>
                <select
                  value={selectedGroupId}
                  onChange={event => {
                    setSelectedGroupId(event.target.value)
                    setConfirmed(false)
                    setSearchQuery('')
                    setSearchResults([])
                    setFeedback('')
                  }}
                  style={styles.input}
                >
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name} - {group.accessLabel}
                    </option>
                  ))}
                </select>
              </label>

              <div style={styles.field}>
                <span style={styles.label}>Jedlo</span>
                <div style={styles.segment}>
                  <button
                    type="button"
                    onClick={() => {
                      setMeal('OBED')
                      setConfirmed(false)
                    }}
                    style={{
                      ...styles.segmentButton,
                      ...(meal === 'OBED' ? styles.segmentButtonActive : {})
                    }}
                  >
                    Obed
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMeal('VECERA')
                      setConfirmed(false)
                    }}
                    style={{
                      ...styles.segmentButton,
                      ...(meal === 'VECERA' ? styles.segmentButtonActive : {})
                    }}
                  >
                    Vecera
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.summaryBox}>
              <span style={styles.summaryLabel}>Vybrane</span>
              <b>{selectedGroup?.name || '-'} - {formatDate(date)} - {mealLabel(meal)}</b>
            </div>

            <div className="group-issue-actions" style={styles.actions}>
              <button
                type="button"
                onClick={() => setConfirmed(true)}
                disabled={!date || !selectedGroupId}
                style={styles.primaryButton}
              >
                Pokracovat
              </button>

              <Link href="/dashboard" style={styles.secondaryButton}>
                Zrusit
              </Link>
            </div>

            {confirmed && (
              <div style={styles.message}>
                Tento vyber je pripraveny. Dalsi krok bude vyber ludi zo skupiny, pridanie cez QR a nazov vydaja.
              </div>
            )}

            <section style={styles.delegateBox}>
              <div style={styles.delegateHeader}>
                <div>
                  <h2 style={styles.delegateTitle}>Povereni ludia</h2>
                  <p style={styles.delegateHint}>
                    Povereny clovek bude moct vytvorit skupinovy vydaj pre tuto registracnu skupinu. Vydaj od povereneho bude platny az po 15 minutach.
                  </p>
                </div>
                <span style={styles.countBadge}>{delegates.length}</span>
              </div>

              {!selectedGroup?.canManageDelegates ? (
                <div style={styles.infoBox}>Tuto cast moze menit iba manager registracnej skupiny.</div>
              ) : (
                <>
                  <div style={styles.delegateList}>
                    {delegates.length === 0 ? (
                      <div style={styles.emptyBox}>Zatial nie je povereny nikto.</div>
                    ) : (
                      delegates.map(delegate => (
                        <div className="delegate-row" key={delegate.id} style={styles.delegateRow}>
                          <div style={styles.delegateName}>
                            <b>{delegate.name}</b>
                            {delegate.email && <span>{delegate.email}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDelegate(delegate)}
                            disabled={loading}
                            style={styles.removeButton}
                            title="Odobrat poverenie"
                          >
                            x
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div style={styles.searchBox}>
                    <label style={styles.field}>
                      <span style={styles.label}>Vyhladat osobu</span>
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={event => searchUsers(event.target.value)}
                        placeholder="Meno, priezvisko alebo email"
                        style={styles.input}
                      />
                    </label>

                    <label style={styles.field}>
                      <span style={styles.label}>Poznamka</span>
                      <input
                        type="text"
                        value={delegateNote}
                        onChange={event => setDelegateNote(event.target.value)}
                        placeholder="Volitelne"
                        style={styles.input}
                      />
                    </label>

                    {searchResults.length > 0 && (
                      <div style={styles.searchResults}>
                        {searchResults.map(user => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => addDelegate(user)}
                            disabled={loading || delegates.some(delegate => delegate.userId === user.id)}
                            style={styles.resultButton}
                          >
                            <b>{user.name}</b>
                            {user.email && <span>{user.email}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {feedback && (
                <div style={feedbackType === 'ok' ? styles.feedbackOk : styles.feedbackError}>
                  {feedback}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: 24,
    color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  card: {
    maxWidth: 960,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 30,
    boxShadow: '12px 12px 0 #000'
  },
  topRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 22
  },
  kicker: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 12px',
    fontWeight: 950,
    fontSize: 12,
    textTransform: 'uppercase'
  },
  title: {
    margin: '14px 0 8px 0',
    fontSize: 44,
    lineHeight: 1,
    fontWeight: 950
  },
  subtitle: {
    margin: 0,
    maxWidth: 620,
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.35
  },
  backButton: {
    background: '#000',
    color: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000',
    whiteSpace: 'nowrap'
  },
  stepBadge: {
    display: 'inline-block',
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '7px 14px',
    fontWeight: 950,
    marginBottom: 14
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 14
  },
  field: {
    display: 'grid',
    gap: 8
  },
  label: {
    fontSize: 13,
    fontWeight: 950
  },
  input: {
    width: '100%',
    minHeight: 50,
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 14,
    padding: '0 13px',
    fontSize: 16,
    fontWeight: 900,
    background: '#fff',
    color: '#000'
  },
  segment: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10
  },
  segmentButton: {
    minHeight: 50,
    border: '3px solid #000',
    borderRadius: 14,
    background: '#fff',
    color: '#000',
    fontSize: 16,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  segmentButtonActive: {
    background: '#56db3f'
  },
  summaryBox: {
    marginTop: 18,
    border: '3px solid #000',
    borderRadius: 18,
    background: '#000',
    color: '#fff',
    padding: 14,
    display: 'grid',
    gap: 4
  },
  summaryLabel: {
    color: '#56db3f',
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  actions: {
    marginTop: 18,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12
  },
  primaryButton: {
    minHeight: 52,
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    fontSize: 16,
    fontWeight: 950,
    boxShadow: '4px 4px 0 #000'
  },
  secondaryButton: {
    minHeight: 52,
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 950,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000'
  },
  message: {
    marginTop: 16,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 950
  },
  messageError: {
    background: '#ffe2e2',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 950
  },
  delegateBox: {
    marginTop: 22,
    border: '3px solid #000',
    borderRadius: 22,
    background: '#fff7d8',
    padding: 16
  },
  delegateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start'
  },
  delegateTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 950
  },
  delegateHint: {
    margin: '6px 0 0 0',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.35
  },
  countBadge: {
    minWidth: 40,
    height: 40,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#56db3f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950
  },
  delegateList: {
    display: 'grid',
    gap: 10,
    marginTop: 14
  },
  delegateRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 10,
    alignItems: 'center',
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 14,
    padding: 10
  },
  delegateName: {
    display: 'grid',
    gap: 3,
    minWidth: 0
  },
  removeButton: {
    width: 38,
    height: 38,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#ff6b6b',
    color: '#000',
    fontSize: 22,
    fontWeight: 950,
    boxShadow: '3px 3px 0 #000'
  },
  emptyBox: {
    background: '#fff',
    border: '3px dashed #000',
    borderRadius: 14,
    padding: 12,
    fontWeight: 900
  },
  infoBox: {
    marginTop: 14,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 14,
    padding: 12,
    fontWeight: 900
  },
  searchBox: {
    marginTop: 14,
    display: 'grid',
    gap: 12
  },
  searchResults: {
    display: 'grid',
    gap: 8
  },
  resultButton: {
    border: '3px solid #000',
    borderRadius: 14,
    background: '#fff',
    color: '#000',
    padding: 11,
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    fontWeight: 900,
    boxShadow: '3px 3px 0 #000'
  },
  feedbackOk: {
    marginTop: 14,
    background: '#dfffd9',
    border: '3px solid #000',
    borderRadius: 14,
    padding: 12,
    fontWeight: 950
  },
  feedbackError: {
    marginTop: 14,
    background: '#ffe2e2',
    border: '3px solid #000',
    borderRadius: 14,
    padding: 12,
    fontWeight: 950
  }
}
