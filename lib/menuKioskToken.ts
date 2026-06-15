import { createHmac, timingSafeEqual } from 'crypto'

type TokenPayload = {
  userId: string
  exp: number
  iat: number
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function getSecret() {
  const secret = process.env.KIOSK_MEAL_SELECTION_SECRET || process.env.ACCESS_CODE_SECRET

  if (!secret) {
    throw new Error('KIOSK_MEAL_SELECTION_SECRET alebo ACCESS_CODE_SECRET nie je nastavené.')
  }

  return secret
}

function signPayload(payload: string) {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function createMenuKioskToken(userId: string, ttlSeconds = 120) {
  const now = Math.floor(Date.now() / 1000)
  const payload: TokenPayload = {
    userId,
    iat: now,
    exp: now + ttlSeconds
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signPayload(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export function verifyMenuKioskToken(token: string) {
  const [encodedPayload, signature] = String(token || '').split('.')

  if (!encodedPayload || !signature) {
    return { ok: false as const, error: 'Neplatný kiosk token.', userId: '' }
  }

  const expectedSignature = signPayload(encodedPayload)
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false as const, error: 'Neplatný kiosk token.', userId: '' }
  }

  let payload: TokenPayload

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload))
  } catch {
    return { ok: false as const, error: 'Neplatný kiosk token.', userId: '' }
  }

  if (!payload.userId || !payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false as const, error: 'Platnosť kiosk prístupu vypršala.', userId: '' }
  }

  return { ok: true as const, userId: payload.userId }
}
