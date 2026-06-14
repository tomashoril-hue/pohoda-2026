import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  PRIVACY_CONSENT_TEXT,
  PRIVACY_CONSENT_VERSION,
  PRIVACY_POLICY_URL
} from '@/lib/privacyConsent'
import { supabaseServer } from '@/lib/supabaseServer'

function clientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    if (body?.accepted !== true) {
      return NextResponse.json({ error: 'Potvrdenie je povinne.' }, { status: 400 })
    }

    const { error } = await supabaseServer
      .from('user_privacy_consents')
      .upsert(
        {
          user_id: user.id,
          consent_version: PRIVACY_CONSENT_VERSION,
          privacy_policy_url: PRIVACY_POLICY_URL,
          consent_text: PRIVACY_CONSENT_TEXT,
          accepted_at: new Date().toISOString(),
          ip_address: clientIp(req),
          user_agent: req.headers.get('user-agent') || null,
          active: true
        },
        { onConflict: 'user_id,consent_version' }
      )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
