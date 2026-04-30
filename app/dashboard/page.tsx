import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import DashboardInvites from './DashboardInvites'

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: memberships } = await supabaseServer
    .from('group_members')
    .select(`
      role,
      group_id,
      groups (
        id,
        name
      )
    `)
    .eq('user_id', user.id)

  const { data: pendingInvites } = await supabaseServer
    .from('group_invites')
    .select(`
      id,
      email,
      status,
      created_at,
      groups (
        id,
        name
      )
    `)
    .eq('email', String(user.email || '').toLowerCase())
    .eq('status', 'PENDING')
    .order('created_at', { ascending: false })

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Moja aplikácia</div>

        <div style={styles.titleRow}>
          <div>
            <h1 style={styles.title}>Vitaj</h1>

            <p style={styles.name}>
              {user.meno} {user.priezvisko}
            </p>
          </div>

          <a href="/logout" style={styles.logoutCircle} title="Odhlásiť sa">
            ⏻
          </a>
        </div>

        <div style={styles.infoBox}>
          <p><b>E-mail:</b> {user.email}</p>
          <p><b>QR kód:</b> {user.qr_code || '-'}</p>
          <p><b>Typ stravy:</b> {user.typ_stravy || user.typStravy || '-'}</p>
        </div>

        <div style={styles.menuGrid}>
          <a href="/menu" style={styles.menuButton}>Výber stravy</a>
          <a href="/dashboard/qr" style={styles.menuButton}>Môj QR kód</a>
          <a href="/dashboard/group/create" style={styles.menuButtonPink}>Vytvoriť skupinu</a>
          <a href="/admin/menu" style={styles.menuButtonGreen}>Admin menu</a>
        </div>

        <div style={styles.groupsBox}>
          <h2 style={styles.groupsTitle}>Moje skupiny</h2>

          {!memberships || memberships.length === 0 ? (
            <>
              <div style={styles.emptyGroup}>
                Zatiaľ nie si v žiadnej skupine.
              </div>

              <DashboardInvites invites={pendingInvites || []} />
            </>
          ) : (
            <div style={styles.groupsList}>
              {memberships.map((m: any) => {
                const group = Array.isArray(m.groups) ? m.groups[0] : m.groups
                const isManager = m.role === 'OWNER' || m.role === 'MANAGER'

                return (
                  <div key={m.group_id} style={styles.groupCard}>
                    <div>
                      <div style={styles.groupName}>
                        {group?.name || 'Skupina bez názvu'}
                      </div>

                      <div style={styles.roleBadge}>
                        {m.role}
                      </div>
                    </div>

                    <div style={styles.groupActions}>
                      <a href="/dashboard/group" style={styles.smallButton}>
                        Detail
                      </a>

                      {isManager && (
                        <a
                          href={`/groups/${m.group_id}/add-by-qr`}
                          style={styles.smallButtonGreen}
                        >
                          Pridať cez QR
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  card: {
    maxWidth: 760,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16
  },
  logoutCircle: {
    width: 54,
    height: 54,
    minWidth: 54,
    borderRadius: '50%',
    background: '#ff3b30',
    color: '#fff',
    border: '3px solid #000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 900,
    textDecoration: 'none',
    boxShadow: '4px 4px 0 #000'
  },
  title: {
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  name: {
    fontSize: 26,
    fontWeight: 900,
    marginTop: 10
  },
  infoBox: {
    marginTop: 24,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18,
    fontSize: 18,
    fontWeight: 700
  },
  menuGrid: {
    marginTop: 28,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14
  },
  menuButton: {
    display: 'block',
    textAlign: 'center',
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  menuButtonPink: {
    display: 'block',
    textAlign: 'center',
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  menuButtonGreen: {
    display: 'block',
    textAlign: 'center',
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 18px',
    fontSize: 17,
    fontWeight: 900,
    textDecoration: 'none'
  },
  groupsBox: {
    marginTop: 30,
    border: '3px solid #000',
    borderRadius: 24,
    padding: 18,
    background: '#fff'
  },
  groupsTitle: {
    margin: '0 0 14px 0',
    fontSize: 28,
    fontWeight: 900
  },
  emptyGroup: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontWeight: 900
  },
  groupsList: {
    display: 'grid',
    gap: 14
  },
  groupCard: {
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16,
    background: '#fff',
    display: 'grid',
    gap: 14
  },
  groupName: {
    fontSize: 22,
    fontWeight: 900
  },
  roleBadge: {
    display: 'inline-block',
    marginTop: 8,
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '6px 12px',
    fontWeight: 900,
    fontSize: 13
  },
  groupActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10
  },
  smallButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  },
  smallButtonGreen: {
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  },
  smallButtonPink: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    textDecoration: 'none'
  }
}