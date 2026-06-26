import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { createSessionResponse } from '@/lib/sessionResponse'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'auth-login-confirm', 60, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Prilis vela pokusov. Skuste znova neskor.')

  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Chýba token.' }, { status: 400 })
  }

  const { data: loginToken, error: tokenError } = await supabaseServer
    .from('login_tokens')
    .select('id, user_id, email, expires_at, used_at')
    .eq('token', token)
    .single()

  if (tokenError || !loginToken) {
    return NextResponse.json(
      { error: 'Prihlasovací link je neplatný.' },
      { status: 400 }
    )
  }

  if (loginToken.used_at) {
    return NextResponse.json(
      { error: 'Prihlasovací link už bol použitý.' },
      { status: 400 }
    )
  }

  if (new Date(loginToken.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'Prihlasovací link expiroval. Požiadaj o nový.' },
      { status: 400 }
    )
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, aktivny')
    .eq('id', loginToken.user_id)
    .maybeSingle()

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
    return NextResponse.json(
      { error: 'Tento účet je zablokovaný.' },
      { status: 403 }
    )
  }

  const { data: usedToken, error: usedError } = await supabaseServer
    .from('login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', loginToken.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()

  if (usedError) {
    return NextResponse.json({ error: usedError.message }, { status: 500 })
  }

  if (!usedToken) {
    return NextResponse.json(
      { error: 'Prihlasovací link už bol použitý alebo expiroval.' },
      { status: 400 }
    )
  }

  return createSessionResponse(loginToken.user_id)
}
