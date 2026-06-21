import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import OfflineRezimClient from './OfflineRezimClient'

export default async function OfflineRezimPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUseOfflineIssue) {
    redirect('/dashboard')
  }

  return (
    <OfflineRezimClient
      canPrepareOfflineIssue={access.canPrepareOfflineIssue}
      preparedByName={`${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || 'Admin'}
    />
  )
}
