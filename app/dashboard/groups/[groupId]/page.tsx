import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export default async function GroupDetailPage({
  params
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { groupId } = await params

  const { data: myMembership, error: membershipError } = await supabaseServer
    .from('group_members')
    .select(`
      role,
      group_id,
      groups (
        id,
        name
      )
    `)
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError || !myMembership) {
    redirect('/dashboard/groups')
  }

  const myRole = String(myMembership.role || '').toUpperCase()

  const group = Array.isArray(myMembership.groups)
    ? myMembership.groups[0]
    : myMembership.groups

  const canManage =
    myRole === 'MANAGER' ||
    myRole === 'OWNER'

  const canIssue =
    myRole === 'MANAGER' ||
    myRole === 'POVERENY' ||
    myRole === 'OWNER'

  const { data: membersData, error: membersError } = await supabaseServer
    .from('group_members')
    .select(`
      id,
      user_id,
      role,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy,
        qr_code
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  const members = (membersData || []).map((member: any) => {
    const memberUser = Array.isArray(member.users)
      ? member.users[0]
      : member.users

    const fullName = `${memberUser?.meno || ''} ${memberUser?.priezvisko || ''}`.trim()

    return {
      id: member.id,
      userId: member.user_id,
      role: String(member.role || '').toUpperCase(),
      fullName: fullName || memberUser?.email || 'Bez mena',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      typStravy: memberUser?.typ_stravy || '',
      qrCode: memberUser?.qr_code || ''
    }
  })

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Dashboard / Skupiny / Detail</div>
          <h1 style={styles.title}>{group?.name || 'Skupina bez názvu'}</h1>
        </div>

        <a href="/dashboard/groups" style={styles.backButton}>
          Skupiny
        </a>
      </header>

      <section style={styles.modeBar}>
        <div style={styles.modeMain}>
          <b>Detail skupiny</b>
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
            <a
              href={`/dashboard/groups/${groupId}/issue`}
              style={styles.greenButton}
            >
              Hromadný výdaj
            </a>
          )}

          {canManage && (
            <>
              <a
                href={`/dashboard/groups/${groupId}/add-by-qr`}
                style={styles.blueButton}
              >
                Pridať cez QR
              </a>

              <button type="button" style={styles.lightButton}>
                Presun členov
              </button>
            </>
          )}
        </div>
      </section>

      {membersError && (
        <section style={styles.errorBox}>
          {membersError.message}
        </section>
      )}

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div>Osoba</div>
          <div>Jedlo</div>
          <div>Rola</div>
          <div>QR</div>
        </div>

        {!members.length ? (
          <div style={styles.emptyState}>
            V tejto skupine zatiaľ nie sú členovia.
          </div>
        ) : (
          members.map((member: any) => (
            <div key={member.id} style={styles.row}>
              <div style={styles.personCell}>
                <div style={styles.personName}>{member.fullName}</div>
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
                <span style={styles.roleBadge}>{member.role}</span>
              </div>

              <div>
                <span style={styles.qrBadge}>
                  {member.qrCode || '—'}
                </span>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  header: {
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
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 950
  },
  backButton: {
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
  greenButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  blueButton: {
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none'
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
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
    minWidth: 720,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 90px 100px 100px',
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
    minWidth: 720,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 90px 100px 100px',
    gap: 8,
    alignItems: 'center',
    padding: '9px 10px',
    borderBottom: '1px solid #e5e7eb'
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
  qrBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 7px',
    fontSize: 10,
    fontWeight: 900,
    background: '#eef2ff',
    color: '#3730a3',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  }
}