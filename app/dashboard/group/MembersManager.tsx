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

  const selectableMembers = normalizedMembers.filter(m => !m.isMe)

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
          <p style={styles.counter}>Počet členov: {normalizedMembers.length}</p>
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

      {!normalizedMembers.length && (
        <p style={styles.subtitle}>V skupine zatiaľ nie sú žiadni členovia.</p>
      )}

      <div style={styles.scrollBox}>
        {normalizedMembers.map(member => {
          const fullName = `${member.user?.meno || ''} ${member.user?.priezvisko || ''}`.trim()

          return (
            <div key={member.id} style={styles.memberRow}>
              {canEdit && (
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  disabled={member.isMe || loading}
                  onChange={() => toggleOne(member.id)}
                  style={styles.checkbox}
                />
              )}

              <div style={styles.memberInfo}>
                <div style={styles.memberName}>
                  {fullName || 'Bez mena'}
                  {member.isMe ? ' (vy)' : ''}
                </div>

                <div style={styles.memberEmail}>
                  {member.user?.email || '-'}
                </div>
              </div>

              <div style={styles.actions}>
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

                {canEdit && (
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
  scrollBox: {
    maxHeight: 430,
    overflowY: 'auto',
    paddingRight: 8,
    marginTop: 14
  },
  memberRow: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
    borderBottom: '2px solid #000'
  },
  checkbox: {
    width: 20,
    height: 20
  },
  memberInfo: {
    minWidth: 0
  },
  memberName: {
    fontSize: 17,
    fontWeight: 900
  },
  memberEmail: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: 700,
    wordBreak: 'break-all'
  },
  actions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  select: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 12px',
    fontWeight: 900,
    background: '#fff'
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