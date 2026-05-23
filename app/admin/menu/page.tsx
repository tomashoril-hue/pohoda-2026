import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import AdminMenuClient from './AdminMenuClient'

function todayBratislavaIsoDate() {
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

export default async function AdminMenuPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'MANAGER')
    .limit(1)
    .maybeSingle()

  if (!membership) redirect('/menu')

  const today = todayBratislavaIsoDate()

  const endDate = new Date(today + 'T12:00:00')
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
