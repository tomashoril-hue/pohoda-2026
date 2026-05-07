import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export default async function GroupsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select(`
      group_id,
      role,
      created_at,
      groups (
        id,
        name,
        created_at
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <h1 style={styles.title}>Moje skupiny</h1>
          <div style={styles.errorBox}>{error.message}</div>
        </section>
      </main>
    )
  }

  const groups = (memberships || []).map((membership: any) => {
    const group = Array.isArray(membership.groups)
      ? membership.groups[0]
      : membership.groups

    return {
      id: group?.id || membership.group_id,
      name: group?.name || 'Skupina bez názvu',
      role: String(membership.role || '').toUpperCase(),
      createdAt: group?.created_at || membership.created_at
    }
  })

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Dashboard / Skupiny</div>
          <h1 style={styles.title}>Moje skupiny</h1>
        </div>

        <a href="/dashboard" style={styles.backButton}>
          Späť
        </a>
      </header>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.cardTitle}>Výber skupiny</div>
            <div style={styles.cardSubtitle}>
              Vyber skupinu, s ktorou chceš pracovať.
            </div>
          </div>

          <div style={styles.countBadge}>
            {groups.length}
          </div>
        </div>

        {groups.length === 0 ? (
          <div style={styles.emptyBox}>
            Zatiaľ nie si v žiadnej skupine.
          </div>
        ) : (
          <div style={styles.groupGrid}>
            {groups.map((group: any) => {
              const canManage =
                group.role === 'MANAGER' ||
                group.role === 'OWNER'

              const canIssue =
                group.role === 'MANAGER' ||
                group.role === 'POVERENY' ||
                group.role === 'OWNER'

              return (
                <article key={group.id} style={styles.groupCard}>
                  <div style={styles.groupTop}>
                    <div>
                      <h2 style={styles.groupName}>{group.name}</h2>
                      <div style={styles.roleBadge}>{group.role}</div>
                    </div>
                  </div>

                  <div style={styles.actions}>
                    <a
                      href={`/dashboard/groups/${group.id}`}
                      style={styles.darkButton}
                    >
                      Detail skupiny
                    </a>

                    {canIssue && (
                      <a
                        href={`/dashboard/groups/${group.id}/issue`}
                        style={styles.greenButton}
                      >
                        Hromadný výdaj
                      </a>
                    )}

                    {canManage && (
                      <a
                        href={`/dashboard/groups/${group.id}`}
                        style={styles.lightButton}
                      >
                        Správa členov
                      </a>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
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
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    boxShadow: '0 6px 20px rgba(0,0,0,0.04)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 950
  },
  cardSubtitle: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280'
  },
  countBadge: {
    minWidth: 42,
    height: 42,
    borderRadius: 14,
    background: '#dbeafe',
    color: '#1d4ed8',
    border: '1px solid #93c5fd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950
  },
  groupGrid: {
    display: 'grid',
    gap: 10
  },
  groupCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    background: '#f9fafb',
    display: 'grid',
    gap: 12
  },
  groupTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10
  },
  groupName: {
    margin: 0,
    fontSize: 18,
    fontWeight: 950
  },
  roleBadge: {
    display: 'inline-flex',
    marginTop: 7,
    background: '#111827',
    color: '#fff',
    borderRadius: 999,
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 950
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
  },
  darkButton: {
    background: '#111827',
    color: '#fff',
    borderRadius: 12,
    padding: '10px 11px',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 950
  },
  greenButton: {
    background: '#22c55e',
    color: '#052e16',
    border: '1px solid #16a34a',
    borderRadius: 12,
    padding: '10px 11px',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 950
  },
  lightButton: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '10px 11px',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 950
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
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  }
}