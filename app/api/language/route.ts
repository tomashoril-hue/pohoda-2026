import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { APP_LANGUAGE_COOKIE, normalizeAppLanguage } from '@/lib/i18n'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'language-switch', 30, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit)

  const body = await req.json().catch(() => ({}))
  const language = normalizeAppLanguage(body.language)
  const response = NextResponse.json({ ok: true, language })

  response.cookies.set(APP_LANGUAGE_COOKIE, language, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  })

  const user = await getSessionUser()

  if (user?.id) {
    await supabaseServer
      .from('users')
      .update({ app_language: language })
      .eq('id', user.id)
  }

  return response
}
