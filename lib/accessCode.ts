import crypto from 'crypto'

export function normalizeAccessName(value: any) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

export function normalizeAccessCode(value: any) {
  return String(value || '').replace(/\D/g, '').slice(0, 8)
}

export function isValidAccessCodeFormat(value: any) {
  return /^\d{8}$/.test(normalizeAccessCode(value))
}

function accessCodeSecret() {
  return (
    process.env.ACCESS_CODE_SECRET ||
    process.env.LOGIN_CODE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'pohoda-access-code-development-secret'
  )
}

export function createAccessCode() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, '0')
}

export function hashAccessCode(meno: any, priezvisko: any, code: any) {
  const key = `${normalizeAccessName(meno)}|${normalizeAccessName(priezvisko)}|${normalizeAccessCode(code)}`

  return crypto
    .createHmac('sha256', accessCodeSecret())
    .update(key)
    .digest('hex')
}
