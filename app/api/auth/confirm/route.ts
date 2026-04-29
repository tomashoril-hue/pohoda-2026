import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
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
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    )
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: 'Token je neplatný alebo už bol použitý.' },
      { status: 400 }
    )
  }

  const user = data[0]

  const { data: userRow, error: userError } = await supabaseServer
    .from('users')
    .select('id, email, meno, priezvisko, qr_code')
    .eq('email', user.email)
    .single()

  if (userError || !userRow) {
    return NextResponse.json(
      { error: 'Používateľ sa nenašiel.' },
      { status: 404 }
    )
  }

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
    qrCode: user.qr_code,
    status: user.status
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