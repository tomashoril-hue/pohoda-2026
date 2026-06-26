import { NextRequest, NextResponse } from 'next/server'

type Bucket = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  key: string
  limit: number
  windowMs: number
}

type RateLimitResult = {
  ok: boolean
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

declare global {
  // eslint-disable-next-line no-var
  var __pohodaRateLimitBuckets: Map<string, Bucket> | undefined
}

function buckets() {
  if (!globalThis.__pohodaRateLimitBuckets) {
    globalThis.__pohodaRateLimitBuckets = new Map<string, Bucket>()
  }

  return globalThis.__pohodaRateLimitBuckets
}

function cleanup(now: number) {
  const store = buckets()
  if (store.size < 2000) return

  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) store.delete(key)
  }
}

export function clientIp(req: NextRequest | Request) {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  const firstForwarded = forwarded.split(',')[0]?.trim()

  return (
    firstForwarded ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

export function rateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const store = buckets()
  cleanup(now)

  const existing = store.get(options.key)
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + options.windowMs }

  bucket.count += 1
  store.set(options.key, bucket)

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))

  return {
    ok: bucket.count <= options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds
  }
}

export function rateLimitResponse(result: RateLimitResult, message = 'Prilis vela poziadaviek. Skuste znova neskor.') {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'Cache-Control': 'no-store, max-age=0'
      }
    }
  )
}

export function checkRateLimit(req: NextRequest | Request, scope: string, limit: number, windowMs: number) {
  return rateLimit({
    key: `${scope}:ip:${clientIp(req)}`,
    limit,
    windowMs
  })
}

export function checkActorRateLimit(actorId: string, scope: string, limit: number, windowMs: number) {
  return rateLimit({
    key: `${scope}:actor:${actorId}`,
    limit,
    windowMs
  })
}

export function checkValueRateLimit(scope: string, value: string, limit: number, windowMs: number) {
  return rateLimit({
    key: `${scope}:value:${value.toLowerCase()}`,
    limit,
    windowMs
  })
}
