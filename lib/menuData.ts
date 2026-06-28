import { supabaseServer } from '@/lib/supabaseServer'

export function todayBratislavaIsoDate() {
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

export async function loadMenuSelectionData(userId: string, days = 6) {
  const today = todayBratislavaIsoDate()
  const endDate = new Date(today + 'T12:00:00')
  endDate.setDate(endDate.getDate() + days)
  const end = endDate.toISOString().slice(0, 10)

  const [menuResult, selectionsResult, deadlinesResult, entitlementsResult] = await Promise.all([
    supabaseServer
      .from('jedalny_listok')
      .select('*')
      .gte('datum', today)
      .lte('datum', end)
      .eq('aktivne', true)
      .order('datum', { ascending: true })
      .order('typ_jedla', { ascending: true })
      .order('poradie', { ascending: true }),
    supabaseServer
      .from('vyber_jedal')
      .select('*')
      .eq('user_id', userId)
      .gte('datum', today)
      .lte('datum', end),
    supabaseServer
      .from('menu_deadlines')
      .select('datum, typ_jedla, deadline_at, locked')
      .gte('datum', today)
      .lte('datum', end),
    supabaseServer
      .from('user_food_entitlements')
      .select('datum, obed, vecera')
      .eq('user_id', userId)
      .gte('datum', today)
      .lte('datum', end)
  ])

  if (menuResult.error) throw new Error(menuResult.error.message)
  if (selectionsResult.error) throw new Error(selectionsResult.error.message)
  if (deadlinesResult.error) throw new Error(deadlinesResult.error.message)
  if (entitlementsResult.error) throw new Error(entitlementsResult.error.message)

  return {
    today,
    menu: menuResult.data || [],
    selections: selectionsResult.data || [],
    deadlines: deadlinesResult.data || [],
    entitlements: entitlementsResult.data || []
  }
}
