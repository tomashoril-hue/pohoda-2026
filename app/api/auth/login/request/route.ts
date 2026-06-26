import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { sendAppEmail } from '@/lib/email'
import { createLoginCode, hashLoginCode } from '@/lib/loginCode'
import { isFormSubmission, readLoginBody, redirectToLogin } from '@/lib/loginForm'
import { checkRateLimit, checkValueRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function loginEmailHtml(meno: string, loginUrl: string, loginCode: string) {
  return `
    <h2>Prihlasenie</h2>
    <p>Dobry den${meno ? `, ${meno}` : ''},</p>
    <p>Klikni na tlacidlo pre prihlasenie:</p>
    <p><a href="${loginUrl}" style="font-weight:bold;">Prihlasit sa</a></p>
    <p>Alebo otvor aplikaciu a zadaj prihlasovaci kod:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:12px 0;">${loginCode}</p>
    <p>Link aj kod su jednorazove a platia kratky cas.</p>
  `
}

export async function POST(req: NextRequest) {
  const formSubmission = isFormSubmission(req)
  const ipLimit = checkRateLimit(req, 'auth-login-request', 20, 10 * 60 * 1000)

  if (!ipLimit.ok) {
    return rateLimitResponse(ipLimit, 'Prilis vela pokusov o prihlasenie. Skuste znova neskor.')
  }

  const body = await readLoginBody(req, formSubmission)
  const email = String(body.email || '').trim().toLowerCase()

  if (!email) {
    if (formSubmission) {
      return redirectToLogin(req, { error: 'Chýba e-mail.' })
    }

    return NextResponse.json({ error: 'Chýba e-mail.' }, { status: 400 })
  }

  const emailLimit = checkValueRateLimit('auth-login-request-email', email, 5, 10 * 60 * 1000)

  if (!emailLimit.ok) {
    return rateLimitResponse(emailLimit, 'Prilis vela prihlasovacich e-mailov. Skuste znova neskor.')
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, aktivny')
    .eq('email', email)
    .single()

  if (userError || !user) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        error: 'Tento e-mail nie je registrovaný.'
      })
    }

    return NextResponse.json(
      { error: 'Tento e-mail nie je registrovaný.' },
      { status: 404 }
    )
  }

  if (String(user.aktivny || '').toUpperCase() !== 'ANO') {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        error: 'Tento účet je zablokovaný.'
      })
    }

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
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        error: tokenError.message
      })
    }

    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const loginUrl = `${baseUrl}/login/confirm?token=${token}`

  try {
    await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: user.email,
      subject: 'Prihlasenie do systemu - POHODA PASS',
      html: loginEmailHtml(user.meno || '', loginUrl, loginCode),
      text: `Dobry den ${user.meno || ''}, prihlasenie: ${loginUrl}\nPrihlasovaci kod: ${loginCode}`
    })
  } catch {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        error: 'Token bol vytvorený, ale e-mail sa nepodarilo odoslať.'
      })
    }

    return NextResponse.json(
      { error: 'Token bol vytvorený, ale e-mail sa nepodarilo odoslať.' },
      { status: 500 }
    )
  }

  if (formSubmission) {
    return redirectToLogin(req, { email: user.email, sent: true })
  }

  return NextResponse.json({ ok: true })
}
