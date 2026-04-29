import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const email = String(body.email || '').trim().toLowerCase()

  if (!email) {
    return NextResponse.json({ error: 'Chýba e-mail.' }, { status: 400 })
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko')
    .eq('email', email)
    .single()

  if (userError || !user) {
    return NextResponse.json(
      { error: 'Tento e-mail nie je registrovaný.' },
      { status: 404 }
    )
  }

  const token = crypto.randomBytes(32).toString('hex')

  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + 30)

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null

  const { error: tokenError } = await supabaseServer
    .from('login_tokens')
    .insert({
      user_id: user.id,
      email: user.email,
      token,
      expires_at: expiresAt.toISOString(),
      ip
    })

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  const loginUrl = `${req.nextUrl.origin}/login/confirm?token=${token}`

  const emailRes = await fetch(`${req.nextUrl.origin}/api/send-login-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      meno: user.meno,
      loginUrl
    })
  })

  const emailJson = await emailRes.json().catch(() => ({}))

  if (!emailRes.ok || emailJson.error) {
    return NextResponse.json(
      { error: 'Token bol vytvorený, ale e-mail sa nepodarilo odoslať.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}