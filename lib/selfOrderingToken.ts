import crypto from 'crypto'

export function createSelfOrderingToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function hashSelfOrderingToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
