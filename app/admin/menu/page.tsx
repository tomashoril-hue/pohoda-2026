import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import AdminMenuClient from './AdminMenuClient'

export default async function AdminMenuPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['OWNER', 'MANAGER'])
    .limit(1)
    .maybeSingle()

  if (!membership) redirect('/menu')

  const today = new Date().toISOString().slice(0, 10)

  const endDate = new Date()
  endDate.setDate(endDate.getDate() + 6)
  const end = endDate.toISOString().slice(0, 10)

  const { data: deadlines } = await supabaseServer
    .from('menu_deadlines')
    .select('*')
    .gte('datum', today)
    .lte('datum', end)
    .order('datum', { ascending: true })
    .order('typ_jedla', { ascending: true })

  return (
    <AdminMenuClient
      today={today}
      deadlines={deadlines || []}
    />
  )
}