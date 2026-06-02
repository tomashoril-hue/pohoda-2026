import { cookies } from 'next/headers'
import { supabaseServer } from '@/lib/supabaseServer'

const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000

export async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('pohoda_session')?.value

  if (!sessionToken) return null

  const { data: session, error: sessionError } = await supabaseServer
    .from('app_sessions')
    .select('id, user_id, expires_at, last_seen_at')
    .eq('session_token', sessionToken)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (sessionError || !session) return null

  const now = new Date()
  const lastSeenAt = session.last_seen_at
    ? new Date(session.last_seen_at).getTime()
    : 0

  if (now.getTime() - lastSeenAt >= SESSION_ACTIVITY_WRITE_INTERVAL_MS) {
    const activityUpdate = supabaseServer
      .from('app_sessions')
      .update({ last_seen_at: now.toISOString() })
      .eq('id', session.id)

    if (session.last_seen_at) {
      await activityUpdate.lt(
        'last_seen_at',
        new Date(now.getTime() - SESSION_ACTIVITY_WRITE_INTERVAL_MS).toISOString()
      )
    } else {
      await activityUpdate.is('last_seen_at', null)
    }
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('*')
    .eq('id', session.user_id)
    .single()

  if (userError || !user) return null
  if (String(user.aktivny || '').toUpperCase() !== 'ANO') return null

  return user
}

export async function getCurrentUser() {
  const user = await getSessionUser()

  if (!user) return null
  if (String(user.review_status || 'APPROVED').toUpperCase() !== 'APPROVED') return null

  return user
}
