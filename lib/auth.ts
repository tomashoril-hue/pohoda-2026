import { cookies } from 'next/headers'
import { supabaseServer } from '@/lib/supabaseServer'

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('pohoda_session')?.value

  if (!sessionToken) return null

  const { data: session, error: sessionError } = await supabaseServer
    .from('app_sessions')
    .select('id, user_id, expires_at')
    .eq('session_token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (sessionError || !session) return null

  await supabaseServer
    .from('app_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', session.id)

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('*')
    .eq('id', session.user_id)
    .single()

  if (userError || !user) return null

  return user
}