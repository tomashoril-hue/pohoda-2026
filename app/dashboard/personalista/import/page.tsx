import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import ImportClient from './ImportClient'

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export default async function PersonalistaImportPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const globalAccess = await getGlobalAccess(user.id)

  if (!globalAccess.canUsePersonalista) {
    redirect('/dashboard')
  }

  const { data: registrationGroups } = await supabaseServer
    .from('registration_groups')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true })

  return (
    <ImportClient
      registrationGroups={registrationGroups || []}
      fromDate={isoDateOffset(0)}
      toDate={isoDateOffset(0)}
    />
  )
}
