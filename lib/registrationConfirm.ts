import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

type ConfirmRegistrationResult =
  | {
    ok: true
    userRow: any
    status: string
  }
  | {
    ok: false
    error: string
    statusCode: number
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

export async function confirmRegistrationToken(token: string): Promise<ConfirmRegistrationResult> {
  const { data, error } = await supabaseServer.rpc('confirm_registration', {
    p_token: token
  })

  if (error) {
    const alreadyConfirmedUser = await getAlreadyConfirmedUserByToken(token)

    if (alreadyConfirmedUser) {
      return {
        ok: true,
        userRow: alreadyConfirmedUser,
        status: 'ALREADY_CONFIRMED'
      }
    }

    return {
      ok: false,
      error: error.message,
      statusCode: 400
    }
  }

  if (!data || data.length === 0) {
    const alreadyConfirmedUser = await getAlreadyConfirmedUserByToken(token)

    if (alreadyConfirmedUser) {
      return {
        ok: true,
        userRow: alreadyConfirmedUser,
        status: 'ALREADY_CONFIRMED'
      }
    }

    return {
      ok: false,
      error: 'Token je neplatný alebo už bol použitý.',
      statusCode: 400
    }
  }

  const confirmedUser = data[0]

  const { data: userRow, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, qr_code, review_status')
    .eq('email', confirmedUser.email)
    .single()

  if (userError || !userRow) {
    return {
      ok: false,
      error: 'Používateľ sa nenašiel.',
      statusCode: 404
    }
  }

  return {
    ok: true,
    userRow,
    status: confirmedUser.status
  }
}

export async function attachPohodaSessionCookie(response: NextResponse, userId: string) {
  const sessionToken = crypto.randomBytes(32).toString('hex')

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 14)

  const { error: sessionError } = await supabaseServer
    .from('app_sessions')
    .insert({
      user_id: userId,
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      last_seen_at: new Date().toISOString()
    })

  if (sessionError) {
    return sessionError.message
  }

  response.cookies.set('pohoda_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  })

  return ''
}
