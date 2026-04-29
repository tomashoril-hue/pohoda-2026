import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import MenuClient from './MenuClient'

export default async function MenuPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const today = new Date().toISOString().slice(0, 10)

  const endDate = new Date()
  endDate.setDate(endDate.getDate() + 6)
  const end = endDate.toISOString().slice(0, 10)

  const { data: menu } = await supabaseServer
    .from('jedalny_listok')
    .select('*')
    .gte('datum', today)
    .lte('datum', end)
    .eq('aktivne', true)
    .order('datum', { ascending: true })
    .order('typ_jedla', { ascending: true })
    .order('poradie', { ascending: true })

  const { data: selections } = await supabaseServer
    .from('vyber_jedal')
    .select('*')
    .eq('user_id', user.id)
    .gte('datum', today)
    .lte('datum', end)

  const { data: deadlines } = await supabaseServer
    .from('menu_deadlines')
    .select('datum, typ_jedla, deadline_at, locked')
    .gte('datum', today)
    .lte('datum', end)

  return (
    <MenuClient
      userId={user.id}
      today={today}
      menu={menu || []}
      selections={selections || []}
      deadlines={deadlines || []}
    />
  )
}