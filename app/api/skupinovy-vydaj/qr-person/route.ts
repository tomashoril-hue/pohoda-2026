import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  getIssueAccess,
  loadPreparationPeople,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

async function findUserByQr(qrCode: string) {
  const [qrResult, userResult] = await Promise.all([
    supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', qrCode)
      .eq('active', true)
      .maybeSingle(),
    supabaseServer
      .from('users')
      .select('id')
      .eq('qr_code', qrCode)
      .maybeSingle()
  ])

  if (qrResult.error) throw qrResult.error
  if (qrResult.data?.user_id) return qrResult.data.user_id

  if (userResult.error) throw userResult.error
  return userResult.data?.id || ''
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const registrationGroupId = cleanText(body.registrationGroupId)
    const date = normalizeDate(body.date || body.datum)
    const meal = normalizeMeal(body.meal || body.typJedla)
    const qrCode = cleanText(body.qrCode)

    if (!registrationGroupId || !date || !meal || !qrCode) {
      return NextResponse.json({ error: 'Chyba registracna skupina, datum, jedlo alebo QR.' }, { status: 400 })
    }

    const access = await getIssueAccess(actor.id, registrationGroupId)

    if (!access) {
      return NextResponse.json({ error: 'Nemas opravnenie pre tuto registracnu skupinu.' }, { status: 403 })
    }

    const userId = await findUserByQr(qrCode)

    if (!userId) {
      return NextResponse.json({ error: 'QR kod nebol najdeny alebo nie je aktivny.' }, { status: 404 })
    }

    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
      .eq('id', userId)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    if (!user) {
      return NextResponse.json({ error: 'Osoba k QR kodu sa nenasla.' }, { status: 404 })
    }

    const people = await loadPreparationPeople({
      users: [user],
      date,
      meal,
      source: 'QR'
    })

    if (people.length === 0) {
      return NextResponse.json(
        { error: 'Osoba sa nepodarila nacitat do pripravy vydaja.' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      person: people[0]
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
