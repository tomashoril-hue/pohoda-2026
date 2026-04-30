'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function MembersManager({
  members,
  myRole,
  myUserId
}: {
  members: any[]
  myRole: string
  myUserId: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [bulkRole, setBulkRole] = useState('MEMBER')

  const canEdit = myRole === 'OWNER'

  const normalizedMembers = useMemo(() => {
    return members.map(member => {
      const memberUser = Array.isArray(member.users)
        ? member.users[0]
        : member.users

      return {
        ...member,
        user: memberUser,
        isMe: member.user_id === myUserId || memberUser?.id === myUserId
      }
    })
  }, [members, myUserId])

  const showSearch = normalizedMembers.length > 10

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return normalizedMembers

    return normalizedMembers.filter(member => {
      const meno = `${member.user?.meno || ''} ${member.user?.priezvisko || ''}`.toLowerCase()
      const email = String(member.user?.email || '').toLowerCase()
      const telefon = String(member.user?.telefon || '').toLowerCase()
      const role = String(member.role || '').toLowerCase()

      return (
        meno.includes(q) ||
        email.includes(q) ||
        telefon.includes(q) ||
        role.includes(q)
      )
    })
  }, [normalizedMembers, search])

  const selectableMembers = filteredMembers.filter(m => !m.isMe)

  const allSelected =
    selectableMembers.length > 0 &&
    selectableMembers.every(m => selected.includes(m.id))

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

    setSelected(selectableMembers.map(m => m.id))
  }

  const toggleExpanded = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  const bulkAction = async (memberIds: string[], action: string, role?: string) => {
    setMessage('')

    if (!memberIds.length) {
      setMessage('Nie sú vybraní žiadni členovia.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/group/member/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberIds, action, role })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa upraviť členov.')
        return
      }

      setSelected([])
      setExpandedId(null)
      router.refresh()
    } catch (err: any) {
      setMessage('Chyba: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const singleAction = async (memberId: string, action: string, role?: string) => {
    await bulkAction([memberId], action, role)
  }

  return (
    <div style={styles.membersBox}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.sectionTitle}>Členovia skupiny</h2>
          <p style={styles.counter}>
            Počet členov: {normalizedMembers.length}
            {showSearch && search.trim() ? ` / zobrazené: ${filteredMembers.length}` : ''}
          </p>
        </div>

        {canEdit && (
          <button
            style={{
              ...styles.smallButton,
              opacity: loading ? 0.65 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
            onClick={toggleAll}
            disabled={loading}
          >
            {allSelected ? 'Zrušiť výber' : 'Označiť všetkých'}
          </button>
        )}
      </div>

      {showSearch && (
        <input
          style={styles.searchInput}
          placeholder="Hľadať podľa mena, e-mailu, telefónu alebo roly"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}

      {message && <div style={styles.error}>{message}</div>}

      {canEdit && selected.length > 0 && (
        <div style={styles.bulkBox}>
          <b>Vybraní členovia: {selected.length}</b>

          <div style={styles.bulkActions}>
            <select
              style={styles.select}
              value={bulkRole}
              onChange={e => setBulkRole(e.target.value)}
              disabled={loading}
            >
              <option value="MEMBER">MEMBER</option>
              <option value="MANAGER">MANAGER</option>
              <option value="OWNER">OWNER</option>
            </select>

            <button
              style={{
                ...styles.primaryButton,
                opacity: loading ? 0.65 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              disabled={loading}
              onClick={() => bulkAction(selected, 'ROLE', bulkRole)}
            >
              Zmeniť rolu
            </button>

            <button
              style={{
                ...styles.removeButton,
                opacity: loading ? 0.65 : 1,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              disabled={loading}
              onClick={() => {
                if (confirm(`Naozaj chcete odobrať ${selected.length} členov zo skupiny?`)) {
                  bulkAction(selected, 'REMOVE')
                }
              }}
            >
              Odobrať vybraných
            </button>
          </div>
        </div>
      )}

      {!filteredMembers.length && (
        <p style={styles.subtitle}>Nenašli sa žiadni členovia.</p>
      )}

      <div style={styles.membersList}>
        {filteredMembers.map(member => {
          const fullName = `${member.user?.meno || ''} ${member.user?.priezvisko || ''}`.trim()
          const isExpanded = expandedId === member.id

          return (
            <div key={member.id} style={styles.memberItem}>
              <div style={styles.memberSummary}>
                {canEdit && (
                  <input
                    type="checkbox"
                    checked={selected.includes(member.id)}
                    disabled={member.isMe || loading}
                    onChange={() => toggleOne(member.id)}
                    onClick={e => e.stopPropagation()}
                    style={styles.checkbox}
                  />
                )}

                <button
                  type="button"
                  style={styles.nameButton}
                  onClick={() => toggleExpanded(member.id)}
                >
                  <span style={styles.memberName}>
                    {fullName || 'Bez mena'}
                    {member.isMe ? ' (vy)' : ''}
                  </span>

                  <span style={styles.memberHint}>
                    {isExpanded ? 'Skryť detail' : 'Zobraziť detail'}
                  </span>
                </button>

                <div style={styles.rolePill}>
                  {member.role}
                </div>
              </div>

              {isExpanded && (
                <div style={styles.detailBox}>
                  <div style={styles.detailGrid}>
                    <div>
                      <div style={styles.label}>Meno a priezvisko</div>
                      <div style={styles.value}>{fullName || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.label}>E-mail</div>
                      <div style={styles.valueBreak}>{member.user?.email || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.label}>Telefón</div>
                      <div style={styles.value}>{member.user?.telefon || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.label}>Rola</div>

                      <select
                        style={styles.select}
                        value={member.role}
                        disabled={!canEdit || loading}
                        onChange={e => singleAction(member.id, 'ROLE', e.target.value)}
                      >
                        <option value="MEMBER">MEMBER</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="OWNER">OWNER</option>
                      </select>
                    </div>
                  </div>

                  {canEdit && (
                    <div style={styles.detailActions}>
                      <button
                        style={{
                          ...styles.removeButton,
                          opacity: member.isMe || loading ? 0.45 : 1,
                          cursor: member.isMe || loading ? 'not-allowed' : 'pointer'
                        }}
                        disabled={member.isMe || loading}
                        onClick={() => {
                          if (confirm('Naozaj chcete odobrať tohto člena zo skupiny?')) {
                            singleAction(member.id, 'REMOVE')
                          }
                        }}
                      >
                        Odobrať člena
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  membersBox: {
    marginTop: 24,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  sectionTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 950
  },
  counter: {
    margin: '6px 0 0',
    fontWeight: 800
  },
  subtitle: {
    fontSize: 18,
    fontWeight: 700
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 16,
    border: '3px solid #000',
    borderRadius: 18,
    padding: '13px 15px',
    fontSize: 16,
    outline: 'none',
    background: '#fff',
    color: '#000',
    fontWeight: 800
  },
  membersList: {
    marginTop: 16,
    display: 'grid',
    gap: 0,
    borderTop: '3px solid #000'
  },
  memberItem: {
    borderBottom: '3px solid #000',
    padding: '14px 0'
  },
  memberSummary: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 12
  },
  checkbox: {
    width: 22,
    height: 22,
    minWidth: 22
  },
  nameButton: {
    border: 0,
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    minWidth: 0,
    cursor: 'pointer',
    color: '#000'
  },
  memberName: {
    display: 'block',
    fontSize: 19,
    fontWeight: 950,
    lineHeight: 1.15,
    overflowWrap: 'anywhere'
  },
  memberHint: {
    display: 'block',
    marginTop: 4,
    fontSize: 13,
    fontWeight: 800,
    opacity: 0.65
  },
  rolePill: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 12px',
    fontWeight: 950,
    fontSize: 14,
    whiteSpace: 'nowrap'
  },
  detailBox: {
    marginTop: 14,
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    boxShadow: '5px 5px 0 #f25be6'
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  label: {
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    opacity: 0.65,
    marginBottom: 4
  },
  value: {
    fontSize: 16,
    fontWeight: 900
  },
  valueBreak: {
    fontSize: 16,
    fontWeight: 900,
    overflowWrap: 'anywhere'
  },
  detailActions: {
    marginTop: 16,
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10
  },
  select: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    background: '#fff',
    color: '#000',
    fontSize: 15,
    maxWidth: '100%'
  },
  smallButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 900,
    fontSize: 15
  },
  bulkBox: {
    marginTop: 16,
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14
  },
  bulkActions: {
    marginTop: 12,
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap'
  },
  primaryButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900
  },
  removeButton: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900
  },
  error: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    fontWeight: 900,
    marginTop: 14
  }
}