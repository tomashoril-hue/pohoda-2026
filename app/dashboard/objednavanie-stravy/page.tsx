import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { todayBratislavaIsoDate } from '@/lib/menuData'
import { supabaseServer } from '@/lib/supabaseServer'
import SelfOrderingClient from './SelfOrderingClient'

export default async function SelfOrderingPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const access = await getGlobalAccess(user.id)

  if (!access.isSelfOrderingMeal) {
    redirect('/dashboard')
  }

  const today = todayBratislavaIsoDate()
  const [menuResult, entitlementResult, deadlineResult] = await Promise.all([
    supabaseServer
      .from('jedalny_listok')
      .select('datum, typ_jedla, varianta, nazov, popis, poradie')
      .gte('datum', today)
      .eq('aktivne', true)
      .order('datum', { ascending: true })
      .order('typ_jedla', { ascending: true })
      .order('poradie', { ascending: true }),
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', user.id)
      .gte('datum', today),
    supabaseServer
      .from('menu_deadlines')
      .select('datum, typ_jedla, deadline_at, locked')
      .gte('datum', today)
  ])

  if (menuResult.error) throw new Error(menuResult.error.message)
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
      menu={menuResult.data || []}
      entitlements={entitlementResult.data || []}
      deadlines={deadlineResult.data || []}
    />
  )
}
