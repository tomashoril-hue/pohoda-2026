import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Toto nie je fyzický výdaj. Detail hromadného výdaja slúži iba na prípravu. Skutočný výdaj bude prebiehať cez QR sken pri výdajnom okienku.'
    },
    { status: 410 }
  )
}