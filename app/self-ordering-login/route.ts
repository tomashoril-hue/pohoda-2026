import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { createSessionResponse } from '@/lib/sessionResponse'
import { hashSelfOrderingToken } from '@/lib/selfOrderingToken'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'self-ordering-login', 80, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela pokusov. Skuste znova neskor.')

  const token = String(req.nextUrl.searchParams.get('token') || '').trim()

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const { data: loginToken, error: tokenError } = await supabaseServer
    .from('self_ordering_login_tokens')
    .select('id, user_id, expires_at, used_count')
    .eq('token_hash', hashSelfOrderingToken(token))
    .maybeSingle()

  if (tokenError || !loginToken) {
    return NextResponse.redirect(new URL('/login?error=self-ordering-token', req.url))
  }

  if (new Date(loginToken.expires_at) < new Date()) {
    return NextResponse.redirect(new URL('/login?error=self-ordering-expired', req.url))
  }

  if (Number(loginToken.used_count || 0) > 0) {
    return NextResponse.redirect(new URL('/login?error=self-ordering-used', req.url))
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, aktivny, self_ordering_opened_at')
    .eq('id', loginToken.user_id)
    .maybeSingle()

  if (userError || !user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
    return NextResponse.redirect(new URL('/login?error=blocked', req.url))
  }

  const { data: role } = await supabaseServer
    .from('app_user_roles')
    .select('id')
    .eq('user_id', user.id)
    .eq('role', 'SAMOSTATNE_OBJEDNAVANIE_STRAVY')
    .eq('active', true)
    .maybeSingle()

  if (!role) {
    return NextResponse.redirect(new URL('/login?error=self-ordering-role', req.url))
  }

  const nowIso = new Date().toISOString()
  const { data: consumedToken, error: consumeError } = await supabaseServer
    .from('self_ordering_login_tokens')
    .update({
      used_count: 1,
      last_used_at: nowIso
    })
    .eq('id', loginToken.id)
    .eq('used_count', 0)
    .gt('expires_at', nowIso)
    .select('id')
    .maybeSingle()

  if (consumeError || !consumedToken) {
    return NextResponse.redirect(new URL('/login?error=self-ordering-used', req.url))
  }

  if (!user.self_ordering_opened_at) {
    await supabaseServer
      .from('users')
      .update({
        self_ordering_opened_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', user.id)
      .is('self_ordering_opened_at', null)
  }

  return createSessionResponse(user.id, new URL('/dashboard/objednavanie-stravy', req.url))
}
