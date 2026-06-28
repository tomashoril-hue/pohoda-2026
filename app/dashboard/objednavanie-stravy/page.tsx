import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { supabaseServer } from '@/lib/supabaseServer'
import SelfOrderingClient from './SelfOrderingClient'

export default async function SelfOrderingPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const access = await getGlobalAccess(user.id)

  if (!access.isSelfOrderingMeal) {
    redirect('/dashboard')
  }

  const menuResult = await supabaseServer
    .from('jedalny_listok')
    .select('datum, typ_jedla, varianta, nazov, popis, poradie')
    .eq('aktivne', true)
    .order('datum', { ascending: true })
    .order('typ_jedla', { ascending: true })
    .order('poradie', { ascending: true })

  if (menuResult.error) throw new Error(menuResult.error.message)

  const menuDates = Array.from(new Set((menuResult.data || []).map((item: any) => item.datum).filter(Boolean)))
  const [entitlementResult, deadlineResult] = await Promise.all([
    menuDates.length > 0
      ? supabaseServer
        .from('user_food_entitlements')
        .select('datum, obed, vecera')
        .eq('user_id', user.id)
        .in('datum', menuDates)
      : Promise.resolve({ data: [], error: null }),
    menuDates.length > 0
      ? supabaseServer
        .from('menu_deadlines')
        .select('datum, typ_jedla, deadline_at, locked')
        .in('datum', menuDates)
      : Promise.resolve({ data: [], error: null })
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
      menu={menuResult.data || []}
      entitlements={entitlementResult.data || []}
      deadlines={deadlineResult.data || []}
    />
  )
}
