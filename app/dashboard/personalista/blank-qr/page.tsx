import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import BlankQrClient from './BlankQrClient'

export default async function BlankQrPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUsePersonalista) {
    redirect('/dashboard/personalista')
  }

  return <BlankQrClient />
}
