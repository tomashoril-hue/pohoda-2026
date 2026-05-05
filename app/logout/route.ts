import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get('pohoda_session')?.value

  if (sessionToken) {
    await supabaseServer
      .from('app_sessions')
      .delete()
      .eq('session_token', sessionToken)
  }

  const response = NextResponse.redirect(new URL('/', request.url))

  response.cookies.set('pohoda_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0)
  })

  return response
}