import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getLegacyFoodGroupsEnabled, setLegacyFoodGroupsEnabled } from '@/lib/appSettings'
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

  const enabled = await getLegacyFoodGroupsEnabled()
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

  await setLegacyFoodGroupsEnabled(enabled, user.id)

  return NextResponse.json({
    enabled,
    message: enabled
      ? 'Stravovacie skupiny su zapnute.'
      : 'Stravovacie skupiny su vypnute.'
  })
}
