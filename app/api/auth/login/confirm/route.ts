import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
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

  const sessionToken = crypto.randomBytes(32).toString('hex')

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 14)

  const { error: sessionError } = await supabaseServer
    .from('app_sessions')
    .insert({
      user_id: loginToken.user_id,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      last_seen_at: new Date().toISOString()
    })

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  await supabaseServer
    .from('login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', loginToken.id)

  const response = NextResponse.json({ ok: true })

  response.cookies.set('pohoda_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  })

  return response
}