import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

const SESSION_DAYS = 21

export async function createSessionResponse(userId: string, redirectUrl?: URL) {
  const sessionToken = crypto.randomBytes(32).toString('hex')

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS)

  const { error: sessionError } = await supabaseServer
    .from('app_sessions')
    .insert({
      user_id: userId,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      last_seen_at: new Date().toISOString()
    })

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  const response = redirectUrl
    ? NextResponse.redirect(redirectUrl, 303)
    : NextResponse.json({ ok: true })

  response.cookies.set('pohoda_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS
  })

  return response
}
