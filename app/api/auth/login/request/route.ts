import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createLoginCode, hashLoginCode } from '@/lib/loginCode'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const email = String(body.email || '').trim().toLowerCase()

  if (!email) {
    return NextResponse.json({ error: 'Chýba e-mail.' }, { status: 400 })
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, aktivny')
    .eq('email', email)
    .single()

  if (userError || !user) {
    return NextResponse.json(
      { error: 'Tento e-mail nie je registrovaný.' },
      { status: 404 }
    )
  }

  if (String(user.aktivny || '').toUpperCase() !== 'ANO') {
    return NextResponse.json(
      { error: 'Tento účet je zablokovaný.' },
      { status: 403 }
    )
  }

  const token = crypto.randomBytes(32).toString('hex')
  const loginCode = createLoginCode()
  const loginCodeHash = hashLoginCode(user.email, loginCode)

  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + 15)

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null

  await supabaseServer
    .from('login_tokens')
    .update({ expires_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('used_at', null)

  const { error: tokenError } = await supabaseServer
    .from('login_tokens')
    .insert({
      user_id: user.id,
      email: user.email,
      token,
      login_code_hash: loginCodeHash,
      login_code_attempts: 0,
      expires_at: expiresAt.toISOString(),
      ip
    })

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const loginUrl = `${baseUrl}/login/confirm?token=${token}`

  const emailRes = await fetch(`${req.nextUrl.origin}/api/send-login-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      meno: user.meno,
      loginUrl,
      loginCode
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
