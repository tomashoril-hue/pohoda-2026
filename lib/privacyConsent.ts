import { supabaseServer } from '@/lib/supabaseServer'
import { PRIVACY_CONSENT_VERSION } from '@/lib/privacyConsentConfig'

export {
  PRIVACY_CONSENT_TEXT,
  PRIVACY_CONSENT_VERSION,
  PRIVACY_POLICY_URL
} from '@/lib/privacyConsentConfig'

export async function hasAcceptedCurrentPrivacyConsent(userId: string) {
  const { data, error } = await supabaseServer
    .from('user_privacy_consents')
    .select('id')
    .eq('user_id', userId)
    .eq('consent_version', PRIVACY_CONSENT_VERSION)
    .eq('active', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    // Fail open until the migration exists, so deployment cannot lock users out.
    console.error('privacy consent check failed', error.message)
    return true
  }

  return Boolean(data?.id)
}
