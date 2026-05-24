import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import ScannerTestClient from './ScannerTestClient'

export default async function ScannerTestPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  return (
    <ScannerTestClient
      actorName={`${user.meno || ''} ${user.priezvisko || ''}`.trim() || user.email || ''}
    />
  )
}
