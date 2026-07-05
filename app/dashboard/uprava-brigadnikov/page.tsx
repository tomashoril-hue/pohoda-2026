import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'
import UpravaBrigadnikovClient from './UpravaBrigadnikovClient'

function slovakiaDateIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export default async function UpravaBrigadnikovPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  const canUseAllGroups = access.isAdmin || access.isPersonalista

  if (!canUseAllGroups && !access.isRegistrationGroupAdmin) {
    redirect('/dashboard')
  }

  const managedGroupIds = canUseAllGroups ? [] : await getManagedRegistrationGroupIds(user.id)

  if (!canUseAllGroups && managedGroupIds.length === 0) {
    redirect('/dashboard')
  }

  const groupsQuery = supabaseServer
    .from('registration_groups')
    .select('id, name, active')
    .eq('active', true)
    .order('name', { ascending: true })

  const { data: groups, error } = canUseAllGroups
    ? await groupsQuery
    : await groupsQuery.in('id', managedGroupIds)

  if (error) {
    throw new Error(error.message)
  }

  if (!groups || groups.length === 0) {
    redirect('/dashboard')
  }

  const today = slovakiaDateIso()

  return (
    <UpravaBrigadnikovClient
      groups={(groups || []).map((group: any) => ({ id: group.id, name: group.name }))}
      defaultFrom={today}
      defaultTo={addDaysIso(today, 6)}
      actorName={`${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || ''}
    />
  )
}
