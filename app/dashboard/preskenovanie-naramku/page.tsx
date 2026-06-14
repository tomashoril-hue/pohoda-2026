import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import PreskenovanieNaramkuClient from './PreskenovanieNaramkuClient'

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export default async function PreskenovanieNaramkuPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUseWristbandKiosk) {
    redirect('/dashboard')
  }

  return (
    <PreskenovanieNaramkuClient
      actorName={fullName(user) || user.email || 'Kiosk'}
      isAdmin={access.isAdmin}
    />
  )
}
