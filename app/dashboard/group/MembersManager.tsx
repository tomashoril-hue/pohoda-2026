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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [bulkRole, setBulkRole] = useState('MEMBER')
  const [search, setSearch] = useState('')
  const [openMemberId, setOpenMemberId] = useState<string | null>(null)

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

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) return normalizedMembers

    return normalizedMembers.filter(member => {
      const meno = String(member.user?.meno || '').toLowerCase()
      const priezvisko = String(member.user?.priezvisko || '').toLowerCase()
      const email = String(member.user?.email || '').toLowerCase()
      const telefon = String(member.user?.telefon || '').toLowerCase()
      const role = String(member.role || '').toLowerCase()
      const fullName = `${meno} ${priezvisko}`.trim()

      return (
        meno.includes(q) ||
        priezvisko.includes(q) ||
        email.includes(q) ||
        telefon.includes(q) ||
        role.includes(q) ||
        fullName.includes(q)
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
      setOpenMemberId(null)
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

  const showSearch = normalizedMembers.length > 10

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
        <div style={styles.searchWrap}>
          <input
            style={styles.searchInput}
            placeholder="Hľadať podľa mena, e-mailu, telefónu..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
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
        <p style={styles.subtitle}>
          {search.trim()
            ? 'Nenašli sa žiadni členovia podľa zadaného filtra.'
            : 'V skupine zatiaľ nie sú žiadni členovia.'}
        </p>
      )}

      <div style={styles.list}>
        {filteredMembers.map(member => {
          const fullName = `${member.user?.meno || ''} ${member.user?.priezvisko || ''}`.trim()
          const isOpen = openMemberId === member.id

          return (
            <div key={member.id} style={styles.memberCard}>
              <div
                style={{
                  ...styles.memberRow,
                  gridTemplateColumns: canEdit
                    ? '32px minmax(0, 1fr) auto'
                    : 'minmax(0, 1fr) auto'
                }}
              >
                {canEdit && (
                  <div style={styles.leftCol}>
                    <input
                      type="checkbox"
                      checked={selected.includes(member.id)}
                      disabled={member.isMe || loading}
                      onChange={() => toggleOne(member.id)}
                      style={styles.checkbox}
                    />
                  </div>
                )}

                <div style={styles.centerCol}>
                  <div style={styles.memberName}>
                    {fullName || 'Bez mena'}
                    {member.isMe ? ' (vy)' : ''}
                  </div>

                  <button
                    type="button"
                    style={styles.detailLink}
                    onClick={() =>
                      setOpenMemberId(prev => (prev === member.id ? null : member.id))
                    }
                  >
                    {isOpen ? 'Skryť detail' : 'Zobraziť detail'}
                  </button>
                </div>

                <div style={styles.rightCol}>
                  {canEdit ? (
                    <select
                      style={styles.roleBadgeSelect}
                      value={member.role}
                      disabled={loading}
                      onChange={e => singleAction(member.id, 'ROLE', e.target.value)}
                    >
                      <option value="MEMBER">MEMBER</option>
                      <option value="MANAGER">MANAGER</option>
                      <option value="OWNER">OWNER</option>
                    </select>
                  ) : (
                    <div style={styles.roleBadgeStatic}>{member.role}</div>
                  )}
                </div>
              </div>

              {isOpen && (
                <div
                  style={{
                    ...styles.detailCard,
                    marginLeft: canEdit ? 46 : 0
                  }}
                >
                  <div style={styles.detailGrid}>
                    <div>
                      <div style={styles.detailLabel}>Meno</div>
                      <div style={styles.detailValue}>{member.user?.meno || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>Priezvisko</div>
                      <div style={styles.detailValue}>{member.user?.priezvisko || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>E-mail</div>
                      <div style={styles.detailValue}>{member.user?.email || '-'}</div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>Telefón</div>
                      <div style={styles.detailValue}>{member.user?.telefon || '-'}</div>
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
                        Odobrať
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
  searchWrap: {
    marginTop: 16
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 18,
    padding: '14px 16px',
    fontSize: 16,
    fontWeight: 700,
    outline: 'none',
    color: '#000',
    background: '#fff'
  },
  list: {
    marginTop: 16,
    display: 'grid',
    gap: 12
  },
  memberCard: {
    borderTop: '4px solid #000',
    paddingTop: 14
  },
  memberRow: {
    display: 'grid',
    gap: 14,
    alignItems: 'center'
  },
  leftCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  centerCol: {
    minWidth: 0
  },
  rightCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end'
  },
  checkbox: {
    width: 22,
    height: 22
  },
  memberName: {
    fontSize: 19,
    fontWeight: 950,
    lineHeight: 1.15,
    overflowWrap: 'anywhere'
  },
  detailLink: {
    marginTop: 8,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: '#666',
    fontWeight: 800,
    fontSize: 15,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  detailCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: '#f7f7f7',
    border: '2px solid #d9d9d9'
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: 900,
    textTransform: 'uppercase',
    opacity: 0.7,
    marginBottom: 4
  },
  detailValue: {
    fontSize: 16,
    fontWeight: 800,
    overflowWrap: 'anywhere'
  },
  detailActions: {
    marginTop: 14,
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10
  },
  roleBadgeSelect: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 16px',
    fontWeight: 900,
    background: '#f25be6',
    color: '#000',
    minWidth: 130
  },
  roleBadgeStatic: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 16px',
    fontWeight: 900,
    background: '#f25be6',
    color: '#000',
    minWidth: 130,
    textAlign: 'center'
  },
  select: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 12px',
    fontWeight: 900,
    background: '#fff',
    color: '#000'
  },
  smallButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 900
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
    padding: '9px 14px',
    fontWeight: 900
  },
  removeButton: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '9px 14px',
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