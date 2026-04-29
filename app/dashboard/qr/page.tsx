import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import QrClient from './QrClient'

export default async function QrPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  return (
    <QrClient
      meno={user.meno || ''}
      priezvisko={user.priezvisko || ''}
      email={user.email || ''}
      qrCode={user.qr_code || ''}
    />
  )
}