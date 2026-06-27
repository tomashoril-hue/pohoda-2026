import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

async function createSessionResponse(userRow: any, status: string) {
  const sessionToken = crypto.randomBytes(32).toString('hex')

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 14)

  const { error: sessionError } = await supabaseServer
    .from('app_sessions')
    .insert({
      user_id: userRow.id,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      last_seen_at: new Date().toISOString()
    })

  if (sessionError) {
    return NextResponse.json(
      { error: sessionError.message },
      { status: 500 }
    )
  }

  const response = NextResponse.json({
    ok: true,
    user: userRow,
    qrCode: userRow.qr_code,
    status,
    reviewStatus: userRow.review_status || 'APPROVED'
  })

  response.cookies.set('pohoda_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  })

  return response
}

async function getAlreadyConfirmedUserByToken(token: string) {
  const { data: registration } = await supabaseServer
    .from('registrations')
    .select('email, status, confirmed_at, created_user_id')
    .eq('confirmation_token', token)
    .maybeSingle()

  if (!registration) return null

  const status = String(registration.status || '').toUpperCase()
  const confirmed = status === 'CONFIRMED' || !!registration.confirmed_at || !!registration.created_user_id

  if (!confirmed) return null

  let userQuery = supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, qr_code, review_status')

  if (registration.created_user_id) {
    userQuery = userQuery.eq('id', registration.created_user_id)
  } else {
    userQuery = userQuery.eq('email', registration.email)
  }

  const { data: userRow } = await userQuery.maybeSingle()

  return userRow || null
}

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'auth-confirm-registration', 60, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Príliš veľa pokusov. Skúste znova neskôr.')

  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      { error: 'Chýba token.' },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseServer.rpc('confirm_registration', {
    p_token: token
  })

  if (error) {
    const alreadyConfirmedUser = await getAlreadyConfirmedUserByToken(token)

    if (alreadyConfirmedUser) {
      return createSessionResponse(alreadyConfirmedUser, 'ALREADY_CONFIRMED')
    }

    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    )
  }

  if (!data || data.length === 0) {
    const alreadyConfirmedUser = await getAlreadyConfirmedUserByToken(token)

    if (alreadyConfirmedUser) {
      return createSessionResponse(alreadyConfirmedUser, 'ALREADY_CONFIRMED')
    }

    return NextResponse.json(
      { error: 'Token je neplatný alebo už bol použitý.' },
      { status: 400 }
    )
  }

  const confirmedUser = data[0]

  const { data: userRow, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, qr_code, review_status')
    .eq('email', confirmedUser.email)
    .single()

  if (userError || !userRow) {
    return NextResponse.json(
      { error: 'Používateľ sa nenašiel.' },
      { status: 404 }
    )
  }

  return createSessionResponse(userRow, confirmedUser.status)
}
