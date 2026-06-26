import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const apiLimit = checkRateLimit(request, 'api-global', 1200, 60 * 1000)
    if (!apiLimit.ok) return rateLimitResponse(apiLimit)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pohoda-pathname', request.nextUrl.pathname)

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  })
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*']
}
