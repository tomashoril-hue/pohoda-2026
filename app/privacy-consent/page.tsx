import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { requestLanguage } from '@/lib/i18nServer'
import { hasAcceptedCurrentPrivacyConsent } from '@/lib/privacyConsent'
import PrivacyConsentClient from './PrivacyConsentClient'

export const dynamic = 'force-dynamic'

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export default async function PrivacyConsentPage() {
  const user = await getSessionUser()

  if (!user) {
    redirect('/login?next=/privacy-consent')
  }

  if (String(user.review_status || 'APPROVED').toUpperCase() !== 'APPROVED') {
    redirect('/pending-approval')
  }

  if (await hasAcceptedCurrentPrivacyConsent(user.id)) {
    redirect('/dashboard')
  }

  const language = await requestLanguage(user)

  return <PrivacyConsentClient language={language} userName={fullName(user)} />
}
