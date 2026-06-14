import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
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

  return children
}
