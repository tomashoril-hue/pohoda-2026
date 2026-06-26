import { NextRequest, NextResponse } from 'next/server'
import { hashLoginCode, isValidLoginCodeFormat, normalizeLoginCode } from '@/lib/loginCode'
import { isFormSubmission, readLoginBody, redirectToLogin } from '@/lib/loginForm'
import { checkRateLimit, checkValueRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { createSessionResponse } from '@/lib/sessionResponse'
import { supabaseServer } from '@/lib/supabaseServer'

const MAX_LOGIN_CODE_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  const formSubmission = isFormSubmission(req)
  const ipLimit = checkRateLimit(req, 'auth-login-code', 40, 10 * 60 * 1000)

  if (!ipLimit.ok) {
    return rateLimitResponse(ipLimit, 'Prilis vela pokusov. Skuste znova neskor.')
  }

  const body = await readLoginBody(req, formSubmission)
  const email = String(body.email || '').trim().toLowerCase()
  const code = normalizeLoginCode(body.code)

  if (!email) {
    if (formSubmission) {
      return redirectToLogin(req, {
        sent: true,
        error: 'Chýba e-mail. Pošli si nový prihlasovací kód.'
      })
    }

    return NextResponse.json({ error: 'Chýba e-mail.' }, { status: 400 })
  }

  const emailLimit = checkValueRateLimit('auth-login-code-email', email, 15, 10 * 60 * 1000)

  if (!emailLimit.ok) {
    return rateLimitResponse(emailLimit, 'Prilis vela pokusov pre tento e-mail. Skuste znova neskor.')
  }

  if (!isValidLoginCodeFormat(code)) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Zadaj 6-miestny kód.'
      })
    }

    return NextResponse.json({ error: 'Zadaj 6-miestny kód.' }, { status: 400 })
  }

  const { data: loginToken, error: tokenError } = await supabaseServer
    .from('login_tokens')
    .select('id, user_id, email, expires_at, used_at, login_code_hash, login_code_attempts')
    .eq('email', email)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (tokenError) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: tokenError.message
      })
    }

    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  if (!loginToken || !loginToken.login_code_hash) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Prihlasovací kód je neplatný alebo expiroval.'
      })
    }

    return NextResponse.json(
      { error: 'Prihlasovací kód je neplatný alebo expiroval.' },
      { status: 400 }
    )
  }

  const attempts = Number(loginToken.login_code_attempts || 0)

  if (attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Príliš veľa pokusov. Požiadaj o nový prihlasovací kód.'
      })
    }

    return NextResponse.json(
      { error: 'Príliš veľa pokusov. Požiadaj o nový prihlasovací kód.' },
      { status: 429 }
    )
  }

  const expectedHash = hashLoginCode(email, code)

  if (expectedHash !== loginToken.login_code_hash) {
    await supabaseServer
      .from('login_tokens')
      .update({
        login_code_attempts: attempts + 1,
        login_code_last_attempt_at: new Date().toISOString()
      })
      .eq('id', loginToken.id)

    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Prihlasovací kód je nesprávny.'
      })
    }

    return NextResponse.json(
      { error: 'Prihlasovací kód je nesprávny.' },
      { status: 400 }
    )
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, aktivny')
    .eq('id', loginToken.user_id)
    .maybeSingle()

  if (userError) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: userError.message
      })
    }

    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Tento účet je zablokovaný.'
      })
    }

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
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: usedError.message
      })
    }

    return NextResponse.json({ error: usedError.message }, { status: 500 })
  }

  if (!usedToken) {
    if (formSubmission) {
      return redirectToLogin(req, {
        email,
        sent: true,
        error: 'Prihlasovací kód už bol použitý alebo expiroval.'
      })
    }

    return NextResponse.json(
      { error: 'Prihlasovací kód už bol použitý alebo expiroval.' },
      { status: 400 }
    )
  }

  return createSessionResponse(
    loginToken.user_id,
    formSubmission ? new URL('/dashboard', req.url) : undefined
  )
}
