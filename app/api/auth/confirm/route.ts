import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { attachPohodaSessionCookie, confirmRegistrationToken } from '@/lib/registrationConfirm'

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'auth-confirm-registration', 60, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit, 'Príliš veľa pokusov. Skúste znova neskôr.')

  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      { error: 'Chýba token.' },
      { status: 400 }
    )
  }

  const result = await confirmRegistrationToken(token)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.statusCode }
    )
  }

  const response = NextResponse.json({
    ok: true,
    user: result.userRow,
    qrCode: result.userRow.qr_code,
    status: result.status,
    reviewStatus: result.userRow.review_status || 'APPROVED'
  })

  const sessionError = await attachPohodaSessionCookie(response, result.userRow.id)

  if (sessionError) {
    return NextResponse.json(
      { error: sessionError },
      { status: 500 }
    )
  }

  return response
}
