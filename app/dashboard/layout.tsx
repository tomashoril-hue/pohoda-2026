import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'

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

  return children
}
