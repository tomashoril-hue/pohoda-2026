import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(request: Request) {
  await supabaseServer.auth.signOut()

  return NextResponse.redirect(new URL('/', request.url))
}