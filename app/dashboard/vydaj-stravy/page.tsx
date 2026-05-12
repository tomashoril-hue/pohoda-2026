import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import VydajStravyClient from './VydajStravyClient'

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function defaultMeal() {
  return new Date().getHours() < 15 ? 'OBED' : 'VECERA'
}

export default async function VydajStravyPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  const { data: memberships, error: membershipsError } = await supabaseServer
    .from('group_members')
    .select('group_id, role, groups ( name )')
    .eq('user_id', user.id)

  if (membershipsError) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>{membershipsError.message}</section>
      </main>
    )
  }

  const issueGroupIds = (memberships || [])
    .filter((membership: any) => canIssueForGroupByRole(String(membership.role || '').toUpperCase(), access))
    .map((membership: any) => membership.group_id)

  const canUse = access.canUsePersonalista || issueGroupIds.length > 0

  if (!canUse) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>Nemáš oprávnenie vydávať stravu.</section>
      </main>
    )
  }

  const today = todayIsoDate()

  let issuedQuery = supabaseServer
    .from('vydaj_jedal')
    .select('typ_jedla, status')
    .eq('datum', today)
    .eq('status', 'VYDANE')

  if (!access.canUsePersonalista) {
    issuedQuery = issuedQuery.in('group_id', issueGroupIds)
  }

  const { data: issuedToday } = await issuedQuery

  let activeIssuesQuery = supabaseServer
    .from('hromadne_vydaje')
    .select(`
      id,
      group_id,
      datum,
      typ_jedla,
      status,
      valid_after,
      groups (
        name
      )
    `)
    .eq('datum', today)
    .in('status', ['READY', 'WAITING'])
    .order('typ_jedla', { ascending: true })

  if (!access.canUsePersonalista) {
    activeIssuesQuery = activeIssuesQuery.in('group_id', issueGroupIds)
  }

  const { data: activeIssues } = await activeIssuesQuery

  const counts = {
    obed: (issuedToday || []).filter((row: any) => row.typ_jedla === 'OBED').length,
    vecera: (issuedToday || []).filter((row: any) => row.typ_jedla === 'VECERA').length
  }

  return (
    <VydajStravyClient
      actorName={`${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || ''}
      initialDate={today}
      initialMeal={defaultMeal()}
      initialCounts={counts}
      activeIssues={(activeIssues || []).map((issue: any) => {
        const group = Array.isArray(issue.groups) ? issue.groups[0] : issue.groups

        return {
          id: issue.id,
          groupName: group?.name || 'Skupina bez názvu',
          typJedla: issue.typ_jedla,
          status: issue.status,
          validAfter: issue.valid_after || ''
        }
      })}
    />
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  errorBox: {
    maxWidth: 720,
    margin: '40px auto',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    fontWeight: 850
  }
}
