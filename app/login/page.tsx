import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getSessionUser } from '@/lib/auth'
import { loginEmailCookieName } from '@/lib/loginForm'
import LoginClient from './LoginClient'

function emailValue(value: any) {
  const email = String(value || '').trim().toLowerCase()

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ sent?: string; error?: string; method?: string; code?: string; email?: string; next?: string }>
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
  const initialEmail = emailValue(params.email) || cookieStore.get(loginEmailCookieName)?.value || ''

  return (
    <LoginClient
      initialEmail={initialEmail}
      initialSent={params.sent === '1'}
      initialError={params.error || ''}
      initialMethod={params.method === 'code' ? 'code' : 'email'}
      initialAccessCode={params.code || ''}
      initialNext={nextPath}
    />
  )
}
