import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(request: NextRequest) {
  try {
    await supabaseServer.auth.signOut()
  } catch (e) {
    // pokračujeme aj keby Supabase signOut zlyhal
  }

  const response = NextResponse.redirect(new URL('/', request.url))

  const cookieHeader = request.headers.get('cookie')

  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const name = cookie.split('=')[0]?.trim()

      if (name) {
        response.cookies.set(name, '', {
          path: '/',
          maxAge: 0,
          expires: new Date(0)
        })
      }
    })
  }

  return response
}