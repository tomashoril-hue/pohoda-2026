import { redirect } from 'next/navigation'

type ConfirmPageProps = {
  searchParams: Promise<{
    token?: string | string[]
  }>
}

export default async function ConfirmPage({ searchParams }: ConfirmPageProps) {
  const params = await searchParams
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token
  const token = String(rawToken || '').trim()

  if (!token) {
    redirect('/register')
  }

  redirect(`/api/auth/confirm/redirect?token=${encodeURIComponent(token)}`)
}
