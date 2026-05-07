'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'

type Member = {
  id: string
  userId: string
  role: string
  fullName: string
  email: string
  telefon: string
  typStravy: string
  qrCode: string
  isMe: boolean
}

type Invite = {
  id: string
  email: string
  status: string
  created_at: string
}

type Props = {
  group: {
    id: string
    name: string
  }
  myRole: string
  members: Member[]
  invites: Invite[]
  canManage: boolean
  canInvite: boolean
  canIssue: boolean
}

export default function GroupDetailClient({
  group,
  myRole,
  members,
  invites,
  canManage,
  canInvite,
  canIssue
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bulkRole, setBulkRole] = useState('MEMBER')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [cancelInviteId, setCancelInviteId] = useState('')

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    return members
      .filter(member => {
        if (!q) return true

        return (
          member.fullName.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q) ||
          member.telefon.toLowerCase().includes(q) ||
          member.role.toLowerCase().includes(q) ||
          member.qrCode.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))
  }, [members, search])

  const selectableMembers = filteredMembers.filter(member => !member.isMe)
  const allSelected =
    selectableMembers.length > 0 &&
    selectableMembers.every(member => selected.includes(member.id))

  const setStatus = (text: string, type: 'ok' | 'error') => {
    setMessage(text)
    setMessageType(type)
  }

  const toggleMember = (memberId: string) => {
    setSelected(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    )
  }

  const toggleAll = () => {
    if (allSelected) {
      setSelected([])
      return
    }

    setSelected(selectableMembers.map(member => member.id))
  }

  const memberAction = async (memberIds: string[], action: 'ROLE' | 'REMOVE', role?: string) => {
    setMessage('')
    setMessageType('')

    if (!memberIds.length) {
      setStatus('Nie je vybraný žiadny člen.', 'error')
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
      let json: { error?: string; message?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Úprava členov sa nepodarila.', 'error')
        return
      }

      setSelected([])
      setStatus(json.message || 'Zmeny boli uložené.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setLoading(false)
    }
  }

  const sendInvite = async () => {
    setMessage('')
    setMessageType('')

    if (!inviteEmail.trim()) {
      setStatus('Zadaj e-mail pozývanej osoby.', 'error')
      return
    }

    setInviteLoading(true)

    try {
      const res = await fetch('/api/group/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), groupId: group.id })
      })

      const text = await res.text()
      let json: { error?: string; message?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Pozvánku sa nepodarilo odoslať.', 'error')
        return
      }

      setInviteEmail('')
      setStatus(json.message || 'Pozvánka bola odoslaná.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setInviteLoading(false)
    }
  }

  const cancelInvite = async (inviteId: string) => {
    if (!confirm('Naozaj zrušiť túto pozvánku?')) return

    setCancelInviteId(inviteId)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/group/invite/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId })
      })

      const json: { error?: string } = await res.json()

      if (!res.ok || json.error) {
        setStatus(json.error || 'Pozvánku sa nepodarilo zrušiť.', 'error')
        return
      }

      setStatus('Pozvánka bola zrušená.', 'ok')
      router.refresh()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setCancelInviteId('')
    }
  }

  const leaveGroup = async () => {
    if (!confirm('Naozaj chceš opustiť túto skupinu?')) return

    setLeaving(true)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch('/api/group/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id })
      })

      const text = await res.text()
      let json: { error?: string } = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setStatus('Server vrátil neplatnú odpoveď.', 'error')
        return
      }

      if (!res.ok || json.error) {
        setStatus(json.error || 'Skupinu sa nepodarilo opustiť.', 'error')
        return
      }

      router.push('/dashboard/groups')
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus('Chyba spojenia so serverom: ' + text, 'error')
    } finally {
      setLeaving(false)
    }
  }

  return (
    <main style={styles.screen}>
      <header style={styles.mobileHeader}>
        <div>
          <div style={styles.breadcrumb}>Prehľad / Skupiny / Detail</div>
          <h1 style={styles.title}>{group.name}</h1>
          <p style={styles.subtitle}>Členovia, pozvánky a výdaj pre túto skupinu.</p>
        </div>

        <Link href="/dashboard/groups" style={styles.closeButton}>
          Skupiny
        </Link>
      </header>

      <section style={styles.modeBar}>
        <div style={styles.modeMain}>
          <b>Správa skupiny</b>
          <span>Tvoja rola: {myRole}</span>
        </div>

        <div style={styles.modeStatus}>
          <strong>{members.length}</strong>
          <small>členov</small>
        </div>
      </section>

      <section style={styles.actionBar}>
        <div style={styles.actionLeft}>
          {canIssue && (
            <Link href={`/dashboard/groups/${group.id}/issue`} style={styles.confirmButton}>
              Hromadný výdaj
            </Link>
          )}

          {canManage && (
            <Link href={`/dashboard/groups/${group.id}/add-by-qr`} style={styles.qrButton}>
              Pridať cez QR
            </Link>
          )}

          {canManage && (
            <Link href="/dashboard/groups" style={styles.lightButton}>
              Presun členov
            </Link>
          )}
        </div>

        <button
          type="button"
          style={{
            ...styles.cancelButton,
            opacity: leaving ? 0.6 : 1
          }}
          onClick={leaveGroup}
          disabled={leaving}
        >
          {leaving ? 'Odchádzam...' : 'Opustiť skupinu'}
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

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeaderRow}>
            <b>Členovia</b>
            {canManage && (
              <button
                type="button"
                style={styles.tinyButton}
                onClick={toggleAll}
                disabled={loading || selectableMembers.length === 0}
              >
                {allSelected ? 'Zrušiť výber' : 'Označiť'}
              </button>
            )}
          </div>

          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Hľadať podľa mena, e-mailu, telefónu alebo QR..."
            style={styles.searchInput}
          />

          {canManage && selected.length > 0 && (
            <div style={styles.bulkBar}>
              <span>Vybraných: <b>{selected.length}</b></span>

              <select
                value={bulkRole}
                onChange={event => setBulkRole(event.target.value)}
                style={styles.select}
                disabled={loading}
              >
                <option value="MEMBER">MEMBER</option>
                <option value="POVERENY">POVERENY</option>
                <option value="MANAGER">MANAGER</option>
              </select>

              <button
                type="button"
                style={styles.qrButton}
                onClick={() => memberAction(selected, 'ROLE', bulkRole)}
                disabled={loading}
              >
                Zmeniť rolu
              </button>

              <button
                type="button"
                style={styles.cancelButton}
                onClick={() => {
                  if (confirm(`Odobrať ${selected.length} členov zo skupiny?`)) {
                    memberAction(selected, 'REMOVE')
                  }
                }}
                disabled={loading}
              >
                Odobrať
              </button>
            </div>
          )}
        </div>

        {canInvite && (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Pozvať do skupiny</div>

            <div style={styles.inviteRow}>
              <input
                value={inviteEmail}
                onChange={event => setInviteEmail(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    sendInvite()
                  }
                }}
                placeholder="E-mail člena"
                style={styles.searchInput}
                disabled={inviteLoading}
              />

              <button
                type="button"
                style={{
                  ...styles.confirmButton,
                  opacity: inviteLoading ? 0.6 : 1
                }}
                onClick={sendInvite}
                disabled={inviteLoading}
              >
                {inviteLoading ? 'Posielam...' : 'Pozvať'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div />
          <div>Osoba</div>
          <div>Jedlo</div>
          <div>Rola</div>
          <div>QR</div>
          <div>Akcie</div>
        </div>

        {filteredMembers.length === 0 ? (
          <div style={styles.emptyState}>Nenašli sa žiadni členovia.</div>
        ) : (
          filteredMembers.map(member => (
            <div key={member.id} style={styles.row}>
              <div style={styles.checkCell}>
                {canManage && (
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={selected.includes(member.id)}
                    disabled={member.isMe || loading}
                    onChange={() => toggleMember(member.id)}
                  />
                )}
              </div>

              <div style={styles.personCell}>
                <div style={styles.personName}>
                  {member.fullName}{member.isMe ? ' (ty)' : ''}
                </div>
                <div style={styles.personMeta}>
                  {member.email || '-'}{member.telefon ? ` · ${member.telefon}` : ''}
                </div>
              </div>

              <div>
                <span
                  style={{
                    ...styles.choiceBadge,
                    background:
                      member.typStravy === 'MASO'
                        ? '#111827'
                        : member.typStravy === 'VEGE'
                          ? '#dcfce7'
                          : '#fef3c7',
                    color:
                      member.typStravy === 'MASO'
                        ? '#fff'
                        : member.typStravy === 'VEGE'
                          ? '#166534'
                          : '#92400e'
                  }}
                >
                  {member.typStravy || 'NEZADANÉ'}
                </span>
              </div>

              <div>
                {canManage && !member.isMe ? (
                  <select
                    value={member.role}
                    onChange={event => memberAction([member.id], 'ROLE', event.target.value)}
                    style={styles.smallSelect}
                    disabled={loading}
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="POVERENY">POVERENY</option>
                    <option value="MANAGER">MANAGER</option>
                  </select>
                ) : (
                  <span style={styles.roleBadge}>{member.role}</span>
                )}
              </div>

              <div>
                <span style={styles.sourceBadge}>{member.qrCode || '-'}</span>
              </div>

              <div>
                {canManage && !member.isMe && (
                  <button
                    type="button"
                    style={styles.lightButton}
                    onClick={() => {
                      if (confirm('Odobrať tohto člena zo skupiny?')) {
                        memberAction([member.id], 'REMOVE')
                      }
                    }}
                    disabled={loading}
                  >
                    Odobrať
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      {canInvite && invites.length > 0 && (
        <section style={styles.panel}>
          <div style={styles.panelTitle}>Odoslané pozvánky</div>

          <div style={styles.inviteList}>
            {invites.map(invite => (
              <div key={invite.id} style={styles.inviteItem}>
                <div>
                  <b>{invite.email}</b>
                  <span>Čaká na potvrdenie</span>
                </div>

                <button
                  type="button"
                  style={styles.lightButton}
                  onClick={() => cancelInvite(invite.id)}
                  disabled={cancelInviteId === invite.id}
                >
                  {cancelInviteId === invite.id ? 'Ruším...' : 'Zrušiť'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!canManage && myRole === 'MEMBER' && (
        <section style={styles.message}>
          Ako člen skupiny môžeš vidieť členov a opustiť skupinu. Správu členov,
          pozvánky a hromadný výdaj rieši poverená osoba alebo manažér.
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  screen: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 10,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
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
  subtitle: {
    margin: '5px 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
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
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
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
  topGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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
    fontWeight: 900,
    cursor: 'pointer'
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
  inviteRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8
  },
  bulkBar: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 13,
    fontWeight: 850
  },
  select: {
    minWidth: 130,
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '10px 10px',
    fontSize: 13,
    fontWeight: 800,
    background: '#fff',
    color: '#111827'
  },
  smallSelect: {
    maxWidth: 118,
    border: '1px solid #d1d5db',
    borderRadius: 999,
    padding: '6px 7px',
    fontSize: 10,
    fontWeight: 900,
    background: '#fff',
    color: '#111827'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 11px',
    fontSize: 12,
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  qrButton: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
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
    textDecoration: 'none',
    cursor: 'pointer'
  },
  cancelButton: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
  },
  message: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 11,
    fontSize: 13,
    fontWeight: 850,
    background: '#fff'
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto',
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  tableHeader: {
    minWidth: 860,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 92px 130px 120px 100px',
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
    minWidth: 860,
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) 92px 130px 120px 100px',
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
  sourceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
    background: '#eef2ff',
    color: '#3730a3'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  },
  inviteList: {
    display: 'grid',
    gap: 8
  },
  inviteItem: {
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  }
}
