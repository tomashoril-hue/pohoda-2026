import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'Fyzický výdaj sa nezapisuje z detailu hromadného výdaja. Výdaj bude prebiehať iba cez QR sken pri výdajnom okienku.'
    },
    { status: 410 }
  )
}