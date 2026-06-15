import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import VyberStravyKioskClient from './VyberStravyKioskClient'

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export default async function VyberStravyKioskPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUseMenuKiosk) {
    redirect('/dashboard')
  }

  return (
    <VyberStravyKioskClient
      actorName={fullName(user) || user.email || 'Kiosk'}
      isAdmin={access.isAdmin}
    />
  )
}
