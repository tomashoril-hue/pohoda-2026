import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { todayBratislavaIsoDate } from '@/lib/menuData'
import { supabaseServer } from '@/lib/supabaseServer'
import SelfOrderingClient from './SelfOrderingClient'

function addDaysIso(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function dateRange(start: string, days: number) {
  return Array.from({ length: days }, (_, index) => addDaysIso(start, index))
}

export default async function SelfOrderingPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const access = await getGlobalAccess(user.id)

  if (!access.isSelfOrderingMeal) {
    redirect('/dashboard')
  }

  const today = todayBratislavaIsoDate()
  const orderDates = dateRange(today, 21)
  const endDate = orderDates[orderDates.length - 1]
  const [entitlementResult, deadlineResult] = await Promise.all([
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', user.id)
      .gte('datum', today)
      .lte('datum', endDate),
    supabaseServer
      .from('menu_deadlines')
      .select('datum, typ_jedla, deadline_at, locked')
      .gte('datum', today)
      .lte('datum', endDate)
  ])

  if (entitlementResult.error) throw new Error(entitlementResult.error.message)
  if (deadlineResult.error) throw new Error(deadlineResult.error.message)

  const language = await requestLanguage(user)

  return (
    <SelfOrderingClient
      language={language}
      userName={`${user.meno || ''} ${user.priezvisko || ''}`.trim()}
      defaultFood={user.typ_stravy || ''}
      openedAt={user.self_ordering_opened_at || null}
      completedAt={user.self_ordering_completed_at || null}
      orderDates={orderDates}
      entitlements={entitlementResult.data || []}
      deadlines={deadlineResult.data || []}
    />
  )
}
