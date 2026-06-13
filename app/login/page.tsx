import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSessionUser } from '@/lib/auth'
import { loginEmailCookieName } from '@/lib/loginForm'
import LoginClient from './LoginClient'

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ sent?: string; error?: string; method?: string; code?: string; next?: string }>
}) {
  const params = await searchParams
  const nextPath = typeof params.next === 'string' && params.next.startsWith('/') && !params.next.startsWith('//')
    ? params.next
    : ''
  const user = await getSessionUser()

  if (user) {
    const reviewStatus = String(user.review_status || 'APPROVED').toUpperCase()
    redirect(reviewStatus === 'APPROVED' ? (nextPath || '/dashboard') : '/pending-approval')
  }

  const cookieStore = await cookies()

  return (
    <LoginClient
      initialEmail={cookieStore.get(loginEmailCookieName)?.value || ''}
      initialSent={params.sent === '1'}
      initialError={params.error || ''}
      initialMethod={params.method === 'code' ? 'code' : 'email'}
      initialAccessCode={params.code || ''}
      initialNext={nextPath}
    />
  )
}
