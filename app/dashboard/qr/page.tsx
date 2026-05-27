import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import QrClient from './QrClient'

export default async function QrPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const qrCode = user.qr_code || ''
  let qrKind: 'NONE' | 'DATABASE' | 'WRISTBAND' = qrCode ? 'WRISTBAND' : 'NONE'

  if (qrCode) {
    const { data: poolQr } = await supabaseServer
      .from('qr_codes')
      .select('id')
      .eq('code', qrCode)
      .maybeSingle()

    qrKind = poolQr ? 'DATABASE' : 'WRISTBAND'
  }

  return (
    <QrClient
      meno={user.meno || ''}
      priezvisko={user.priezvisko || ''}
      email={user.email || ''}
      qrCode={qrCode}
      qrKind={qrKind}
    />
  )
}
