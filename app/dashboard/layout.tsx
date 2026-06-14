import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getSessionUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { hasAcceptedCurrentPrivacyConsent } from '@/lib/privacyConsent'

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()

  if (!user) {
    redirect('/')
  }

  if (String(user.review_status || 'APPROVED').toUpperCase() !== 'APPROVED') {
    redirect('/pending-approval')
  }

  if (!(await hasAcceptedCurrentPrivacyConsent(user.id))) {
    redirect('/privacy-consent')
  }

  const access = await getGlobalAccess(user.id)
  const pathname = (await headers()).get('x-pohoda-pathname') || ''
  const isOnlyWristbandKiosk =
    access.isWristbandKiosk &&
    access.roles.length > 0 &&
    access.roles.every(role => role === 'WRISTBAND_KIOSK')

  if (isOnlyWristbandKiosk && pathname && pathname !== '/dashboard/preskenovanie-naramku') {
    redirect('/dashboard/preskenovanie-naramku')
  }

  return children
}
