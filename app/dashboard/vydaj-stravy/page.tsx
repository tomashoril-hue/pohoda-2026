import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import VydajStravyClient from './VydajStravyClient'

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('sk-SK', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const year = parts.find(part => part.type === 'year')?.value || ''
  const month = parts.find(part => part.type === 'month')?.value || ''
  const day = parts.find(part => part.type === 'day')?.value || ''

  return `${year}-${month}-${day}`
}

function defaultMeal() {
  const hour = Number(new Intl.DateTimeFormat('sk-SK', {
    timeZone: 'Europe/Bratislava',
    hour: '2-digit',
    hour12: false
  }).format(new Date()))

  return hour < 15 ? 'OBED' : 'VECERA'
}

export default async function VydajStravyPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUseFoodIssue) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>Nemáš oprávnenie vydávať stravu.</section>
      </main>
    )
  }

  const today = todayIsoDate()

  const { data: activeIssues } = await supabaseServer
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

  return (
    <VydajStravyClient
      actorName={`${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || ''}
      initialDate={today}
      initialMeal={defaultMeal()}
      issueMode={access.canAdminFoodIssue ? 'FULL' : 'BASIC'}
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
