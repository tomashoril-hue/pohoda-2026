import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canUseGroupIssue } from '@/lib/registrationGroupManagers'
import SkupinovyVydajClient from './SkupinovyVydajClient'

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

export default async function SkupinovyVydajPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  const allowed = await canUseGroupIssue(user.id, access)

  if (!allowed) {
    redirect('/dashboard')
  }

  return <SkupinovyVydajClient initialDate={todayIsoDate()} />
}
