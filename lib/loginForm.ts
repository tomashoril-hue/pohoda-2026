import { NextRequest, NextResponse } from 'next/server'

const LOGIN_EMAIL_COOKIE = 'pohoda_login_email'

export function isFormSubmission(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''

  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  )
}

export async function readLoginBody(req: NextRequest, formSubmission: boolean) {
  if (!formSubmission) {
    return req.json()
  }

  return Object.fromEntries((await req.formData()).entries())
}

export function redirectToLogin(req: NextRequest, {
  email,
  sent = false,
  error = ''
}: {
  email?: string
  sent?: boolean
  error?: string
}) {
  const url = new URL('/login', req.url)

  if (sent) {
    url.searchParams.set('sent', '1')
  }

  if (error) {
    url.searchParams.set('error', error)
  }

  const response = NextResponse.redirect(url, 303)

  if (email) {
    response.cookies.set(LOGIN_EMAIL_COOKIE, email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/login',
      maxAge: 60 * 15
    })
  }

  return response
}

export const loginEmailCookieName = LOGIN_EMAIL_COOKIE
