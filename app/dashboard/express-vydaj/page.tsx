import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { canUseGroupIssue, getDelegatedRegistrationGroupIds, getManagedRegistrationGroupIds } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'
import ExpressVydajClient from './ExpressVydajClient'

type RegistrationGroupOption = {
  id: string
  name: string
  accessLabel: string
}

function bratislavaParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
}

function todayIsoDate() {
  const parts = bratislavaParts()
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function currentExpressMeal() {
  const hour = Number(bratislavaParts().find(part => part.type === 'hour')?.value || '0')
  return hour < 16 ? 'OBED' : 'VECERA'
}

async function loadExpressGroups(userId: string, access: { isAdmin: boolean, isPersonalista: boolean }) {
  const privileged = access.isAdmin || access.isPersonalista
  const [managedIds, delegatedIds, groupsResult] = await Promise.all([
    getManagedRegistrationGroupIds(userId),
    getDelegatedRegistrationGroupIds(userId),
    supabaseServer
      .from('registration_groups')
      .select('id, name, active')
      .eq('active', true)
      .order('name', { ascending: true })
  ])

  if (groupsResult.error) throw groupsResult.error

  const allGroups = groupsResult.data || []
  const managedSet = new Set(privileged ? allGroups.map((group: any) => group.id) : managedIds)
  const delegatedSet = new Set(delegatedIds)
  const allowedIds = new Set([...Array.from(managedSet), ...Array.from(delegatedSet)])

  return allGroups
    .filter((group: any) => allowedIds.has(group.id))
    .map((group: any): RegistrationGroupOption => ({
      id: group.id,
      name: group.name || '',
      accessLabel: managedSet.has(group.id) ? 'Manager' : 'Poverený'
    }))
}

export default async function ExpressVydajPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)
  const allowed = await canUseGroupIssue(user.id, access)

  if (!allowed) {
    redirect('/dashboard')
  }

  const groups = await loadExpressGroups(user.id, access)

  if (groups.length === 0) {
    redirect('/dashboard')
  }

  const language = await requestLanguage(user)
  const canSelectDateMeal = access.isAdmin || access.isPersonalista

  return (
    <ExpressVydajClient
      language={language}
      userName={`${user.meno || ''} ${user.priezvisko || ''}`.trim()}
      groups={groups}
      canSelectDateMeal={canSelectDateMeal}
      initialDate={todayIsoDate()}
      initialMeal={currentExpressMeal()}
    />
  )
}
