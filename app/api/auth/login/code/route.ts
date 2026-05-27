import { NextRequest, NextResponse } from 'next/server'
import { hashLoginCode, isValidLoginCodeFormat, normalizeLoginCode } from '@/lib/loginCode'
import { createSessionResponse } from '@/lib/sessionResponse'
import { supabaseServer } from '@/lib/supabaseServer'

const MAX_LOGIN_CODE_ATTEMPTS = 5

export async function POST(req: NextRequest) {
  const body = await req.json()
  const email = String(body.email || '').trim().toLowerCase()
  const code = normalizeLoginCode(body.code)

  if (!email) {
    return NextResponse.json({ error: 'Chýba e-mail.' }, { status: 400 })
  }

  if (!isValidLoginCodeFormat(code)) {
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
    return NextResponse.json({ error: tokenError.message }, { status: 500 })
  }

  if (!loginToken || !loginToken.login_code_hash) {
    return NextResponse.json(
      { error: 'Prihlasovací kód je neplatný alebo expiroval.' },
      { status: 400 }
    )
  }

  const attempts = Number(loginToken.login_code_attempts || 0)

  if (attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
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
      { error: 'Prihlasovací kód už bol použitý alebo expiroval.' },
      { status: 400 }
    )
  }

  return createSessionResponse(loginToken.user_id)
}
