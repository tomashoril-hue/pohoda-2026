'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { CSSProperties } from 'react'

type GroupItem = {
  id: string
  name: string
  role: string
  membersCount: number
  canManage: boolean
  canIssue: boolean
}

type MemberItem = {
  id: string
  groupId: string
  userId: string
  role: string
  fullName: string
  email: string
  telefon: string
  typStravy: string
  qrCode: string
}

export default function GroupsClient({
  groups,
  members
}: {
  groups: GroupItem[]
  members: MemberItem[]
}) {
  const router = useRouter()

  const manageableGroups = groups.filter(group => group.canManage)

  const [modalOpen, setModalOpen] = useState(false)
  const [sourceGroupId, setSourceGroupId] = useState(manageableGroups[0]?.id || '')
  const [targetGroupId, setTargetGroupId] = useState(
    manageableGroups.find(group => group.id !== manageableGroups[0]?.id)?.id || ''
  )
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')

  const sourceGroup = groups.find(group => group.id === sourceGroupId) || null
  const targetGroup = groups.find(group => group.id === targetGroupId) || null

  const sourceMembers = useMemo(() => {
    const q = search.trim().toLowerCase()

    return members
      .filter(member => member.groupId === sourceGroupId)
      .filter(member => {
        const role = String(member.role || '').toUpperCase()
        return role !== 'MANAGER' && role !== 'OWNER'
      })
      .filter(member => {
        if (!q) return true

        return (
          member.fullName.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q) ||
          member.telefon.toLowerCase().includes(q) ||
          member.qrCode.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))
  }, [members, sourceGroupId, search])

  const openMoveModal = (groupId?: string) => {
    const initialSource = groupId || manageableGroups[0]?.id || ''
    const initialTarget = manageableGroups.find(group => group.id !== initialSource)?.id || ''

    setSourceGroupId(initialSource)
    setTargetGroupId(initialTarget)
    setSelectedUserIds([])
    setSearch('')
    setMessage('')
    setMessageType('')
    setModalOpen(true)
  }

  const closeMoveModal = () => {
    if (loading) return

    setModalOpen(false)
    setSelectedUserIds([])
    setSearch('')
    setMessage('')
    setMessageType('')
  }

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const selectAllVisible = () => {
    const visibleIds = sourceMembers.map(member => member.userId)

    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every(id => selectedUserIds.includes(id))

    if (allSelected) {
      setSelectedUserIds(prev => prev.filter(id => !visibleIds.includes(id)))
      return
    }

    setSelectedUserIds(prev => Array.from(new Set([...prev, ...visibleIds])))
  }

  const handleSourceChange = (value: string) => {
    setSourceGroupId(value)
    setSelectedUserIds([])
    setSearch('')

    if (targetGroupId === value) {
      const nextTarget = manageableGroups.find(group => group.id !== value)?.id || ''
      setTargetGroupId(nextTarget)
    }
  }

  const moveMembers = async () => {
    setMessage('')
    setMessageType('')

    if (!sourceGroupId || !targetGroupId) {
      setMessage('Vyber zdrojovú aj cieľovú skupinu.')
      setMessageType('error')
      return
    }

    if (sourceGroupId === targetGroupId) {
      setMessage('Zdrojová a cieľová skupina nemôžu byť rovnaké.')
      setMessageType('error')
      return
    }

    if (!selectedUserIds.length) {
      setMessage('Označ aspoň jedného člena.')
      setMessageType('error')
      return
    }

    const confirmText =
      `Presunúť ${selectedUserIds.length} členov zo skupiny "${sourceGroup?.name || ''}" do skupiny "${targetGroup?.name || ''}"?\n\n` +
      'Ak sú v aktívnej príprave pôvodnej skupiny, zobrazia sa tam ako PRESUNUTÝ.'

    if (!confirm(confirmText)) return

    setLoading(true)

    try {
      const res = await fetch('/api/groups/move-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceGroupId,
          targetGroupId,
          userIds: selectedUserIds
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
        setMessage(json.error || 'Presun sa nepodaril.')
        setMessageType('error')
        return
      }

      setMessage(json.message || 'Členovia boli presunutí.')
      setMessageType('ok')
      setSelectedUserIds([])

      setTimeout(() => {
        setModalOpen(false)
        router.refresh()
      }, 650)
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Dashboard / Skupiny</div>
          <h1 style={styles.title}>Moje skupiny</h1>
          <p style={styles.subtitle}>
            Prehľad skupín, rýchly výdaj a presun členov.
          </p>
        </div>

        <div style={styles.headerActions}>
          <Link href="/dashboard/groups/create" style={styles.greenButton}>
            Vytvoriť skupinu
          </Link>

          {manageableGroups.length >= 2 && (
            <button
              type="button"
              style={styles.blueButton}
              onClick={() => openMoveModal()}
            >
              Presun členov
            </button>
          )}

          <a href="/dashboard" style={styles.darkButton}>
            Dashboard
          </a>
        </div>
      </header>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <b>{groups.length}</b>
          <span>Skupín</span>
        </div>

        <div style={styles.summaryCard}>
          <b>{members.length}</b>
          <span>Členov spolu</span>
        </div>

        <div style={styles.summaryCardGreen}>
          <b>{groups.filter(group => group.canIssue).length}</b>
          <span>Výdaj</span>
        </div>

        <div style={styles.summaryCardBlue}>
          <b>{manageableGroups.length}</b>
          <span>Správa</span>
        </div>
      </section>

      {groups.length === 0 ? (
        <section style={styles.emptyBox}>
          Zatiaľ nie si v žiadnej skupine.
        </section>
      ) : (
        <section style={styles.groupsGrid}>
          {groups.map(group => (
            <article key={group.id} style={styles.groupCard}>
              <div style={styles.groupMain}>
                <div>
                  <h2 style={styles.groupName}>{group.name}</h2>

                  <div style={styles.groupMeta}>
                    <span style={styles.roleBadge}>{group.role}</span>
                    <span>{group.membersCount} členov</span>
                  </div>
                </div>

                <div style={styles.groupCount}>
                  {group.membersCount}
                </div>
              </div>

              <div style={styles.groupActions}>
                <a
                  href={`/dashboard/groups/${group.id}`}
                  style={styles.lightButton}
                >
                  Detail
                </a>

                {group.canIssue && (
                  <a
                    href={`/dashboard/groups/${group.id}/issue`}
                    style={styles.greenButton}
                  >
                    Hromadný výdaj
                  </a>
                )}

                {group.canManage && manageableGroups.length >= 2 && (
                  <button
                    type="button"
                    style={styles.blueButton}
                    onClick={() => openMoveModal(group.id)}
                  >
                    Presun členov
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {modalOpen && (
        <div style={styles.modalOverlay} onClick={closeMoveModal}>
          <div style={styles.modal} onClick={event => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <b>Presun členov</b>
                <span>Vyber členov zo zdrojovej skupiny a presuň ich do druhej skupiny.</span>
              </div>

              <button
                type="button"
                onClick={closeMoveModal}
                disabled={loading}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            <div style={styles.modalGrid}>
              <label style={styles.field}>
                <span>Zo skupiny</span>
                <select
                  value={sourceGroupId}
                  onChange={event => handleSourceChange(event.target.value)}
                  style={styles.input}
                  disabled={loading}
                >
                  {manageableGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.field}>
                <span>Do skupiny</span>
                <select
                  value={targetGroupId}
                  onChange={event => setTargetGroupId(event.target.value)}
                  style={styles.input}
                  disabled={loading}
                >
                  <option value="">Vyber cieľ</option>
                  {manageableGroups
                    .filter(group => group.id !== sourceGroupId)
                    .map(group => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div style={styles.searchRow}>
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Hľadať člena..."
                style={styles.searchInput}
                disabled={loading}
              />

              <button
                type="button"
                onClick={selectAllVisible}
                style={styles.lightButton}
                disabled={loading || sourceMembers.length === 0}
              >
                Označiť
              </button>
            </div>

            <div style={styles.memberList}>
              {sourceMembers.length === 0 ? (
                <div style={styles.emptySmall}>
                  V tejto skupine nie sú presunuteľní členovia.
                </div>
              ) : (
                sourceMembers.map(member => {
                  const checked = selectedUserIds.includes(member.userId)

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleUser(member.userId)}
                      style={{
                        ...styles.memberRow,
                        background: checked ? '#ecfdf5' : '#fff',
                        borderColor: checked ? '#22c55e' : '#e5e7eb'
                      }}
                      disabled={loading}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        style={styles.checkbox}
                      />

                      <div style={styles.memberText}>
                        <b>{member.fullName}</b>
                        <span>
                          {member.email || '-'}
                          {member.telefon ? ` · ${member.telefon}` : ''}
                        </span>
                      </div>

                      <span style={styles.choiceBadge}>
                        {member.typStravy || '—'}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div style={styles.modalFooter}>
              <div style={styles.selectedInfo}>
                Vybraných: <b>{selectedUserIds.length}</b>
              </div>

              <button
                type="button"
                onClick={moveMembers}
                disabled={loading || selectedUserIds.length === 0}
                style={{
                  ...styles.greenButton,
                  opacity: loading || selectedUserIds.length === 0 ? 0.55 : 1
                }}
              >
                {loading ? 'Presúvam...' : 'Presunúť'}
              </button>
            </div>

            {message && (
              <div
                style={{
                  ...styles.message,
                  background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
                  color: messageType === 'ok' ? '#166534' : '#991b1b',
                  borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
                }}
              >
                {message}
              </div>
            )}
          </div>
        </div>
      )}
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
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
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
  groupsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 10
  },
  groupCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 14,
    display: 'grid',
    gap: 14,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  groupMain: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start'
  },
  groupName: {
    margin: 0,
    fontSize: 19,
    fontWeight: 950,
    lineHeight: 1.15
  },
  groupMeta: {
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  roleBadge: {
    background: '#111827',
    color: '#fff',
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950
  },
  groupCount: {
    minWidth: 42,
    height: 42,
    borderRadius: 14,
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950
  },
  groupActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
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
  greenButton: {
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
  blueButton: {
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
  emptyBox: {
    background: '#ffedd5',
    color: '#9a3412',
    border: '1px solid #fdba74',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.55)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  modal: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 20,
    padding: 14,
    boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
    display: 'grid',
    gap: 12
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
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
  modalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10
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
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 13,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  searchRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 8
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 14,
    fontWeight: 800,
    outline: 'none'
  },
  memberList: {
    display: 'grid',
    gap: 7,
    maxHeight: 320,
    overflow: 'auto',
    paddingRight: 2
  },
  memberRow: {
    width: '100%',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    textAlign: 'left',
    color: '#111827',
    cursor: 'pointer'
  },
  checkbox: {
    width: 18,
    height: 18
  },
  memberText: {
    minWidth: 0,
    display: 'grid',
    gap: 2
  },
  choiceBadge: {
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 950,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center'
  },
  selectedInfo: {
    fontSize: 13,
    fontWeight: 850,
    color: '#374151'
  },
  emptySmall: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850,
    color: '#6b7280'
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  }
}
