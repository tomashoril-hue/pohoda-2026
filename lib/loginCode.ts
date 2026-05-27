import crypto from 'crypto'

const LOGIN_CODE_LENGTH = 6

function getLoginCodeSecret() {
  return (
    process.env.LOGIN_CODE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'pohoda-login-code-secret'
  )
}

export function createLoginCode() {
  return crypto.randomInt(0, 10 ** LOGIN_CODE_LENGTH).toString().padStart(LOGIN_CODE_LENGTH, '0')
}

export function normalizeLoginCode(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH)
}

export function hashLoginCode(email: string, code: string) {
  return crypto
    .createHash('sha256')
    .update(`${email.trim().toLowerCase()}:${code}:${getLoginCodeSecret()}`)
    .digest('hex')
}

export function isValidLoginCodeFormat(code: string) {
  return /^\d{6}$/.test(code)
}
