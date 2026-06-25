import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getLegacyBulkIssueEnabled, setLegacyBulkIssueEnabled } from '@/lib/appSettings'
import { getGlobalAccess } from '@/lib/globalRoles'

export async function GET() {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Neprihlásený používateľ.' }, { status: 401 })
  }

  const access = await getGlobalAccess(user.id)

  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Toto nastavenie môže meniť iba ADMIN.' }, { status: 403 })
  }

  const enabled = await getLegacyBulkIssueEnabled()
  return NextResponse.json({ enabled })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Neprihlásený používateľ.' }, { status: 401 })
  }

  const access = await getGlobalAccess(user.id)

  if (!access.isAdmin) {
    return NextResponse.json({ error: 'Toto nastavenie môže meniť iba ADMIN.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const enabled = body?.enabled === true

  await setLegacyBulkIssueEnabled(enabled, user.id)

  return NextResponse.json({
    enabled,
    message: enabled
      ? 'Starý hromadný výdaj je zapnutý.'
      : 'Starý hromadný výdaj je vypnutý.'
  })
}
