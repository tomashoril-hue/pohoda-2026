import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { attachPohodaSessionCookie, confirmRegistrationToken } from '@/lib/registrationConfirm'

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'auth-confirm-registration-redirect', 60, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Príliš veľa pokusov. Skúste znova neskôr.')

  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/register', req.url))
  }

  const result = await confirmRegistrationToken(token)

  if (!result.ok) {
    const errorUrl = new URL('/register', req.url)
    errorUrl.searchParams.set('error', 'confirm-token')
    return NextResponse.redirect(errorUrl)
  }

  const reviewStatus = String(result.userRow.review_status || 'APPROVED').toUpperCase()
  const targetPath = reviewStatus === 'APPROVED' ? '/dashboard' : '/pending-approval'
  const response = NextResponse.redirect(new URL(targetPath, req.url))
  const sessionError = await attachPohodaSessionCookie(response, result.userRow.id)

  if (sessionError) {
    const errorUrl = new URL('/register', req.url)
    errorUrl.searchParams.set('error', 'confirm-session')
    return NextResponse.redirect(errorUrl)
  }

  return response
}
