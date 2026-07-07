import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicRegistrationEnabled, setPublicRegistrationEnabled } from '@/lib/appSettings'
import { getGlobalAccess } from '@/lib/globalRoles'

export async function GET() {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Neprihlaseny pouzivatel.' }, { status: 401 })
  }

  const access = await getGlobalAccess(user.id)

  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Toto nastavenie moze menit iba ADMIN.' }, { status: 403 })
  }

  const enabled = await getPublicRegistrationEnabled()
  return NextResponse.json({ enabled })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Neprihlaseny pouzivatel.' }, { status: 401 })
  }

  const access = await getGlobalAccess(user.id)

  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Toto nastavenie moze menit iba ADMIN.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const enabled = body?.enabled === true

  await setPublicRegistrationEnabled(enabled, user.id)

  return NextResponse.json({
    enabled,
    message: enabled
      ? 'Registracia je zapnuta.'
      : 'Registracia je vypnuta.'
  })
}
