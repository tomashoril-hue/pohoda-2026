import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { loginEmailCookieName } from '@/lib/loginForm'
import LoginClient from './LoginClient'

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const user = await getCurrentUser()

  if (user) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const cookieStore = await cookies()

  return (
    <LoginClient
      initialEmail={cookieStore.get(loginEmailCookieName)?.value || ''}
      initialSent={params.sent === '1'}
      initialError={params.error || ''}
    />
  )
}
