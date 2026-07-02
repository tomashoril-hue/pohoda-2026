import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const DEFAULT_PRINTER_ID = 'vydaj-1'
const SLOVAK_TIME_ZONE = 'Europe/Bratislava'

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function fullName(user: any) {
  return cleanText(`${cleanText(user?.meno)} ${cleanText(user?.priezvisko)}`) || cleanText(user?.email)
}

function normalizePrinterId(value: unknown) {
  const printerId = cleanText(value) || DEFAULT_PRINTER_ID
  return printerId.slice(0, 80)
}

function slovakDateLabel(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('sk-SK', {
    timeZone: SLOVAK_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  })

  return formatter.format(date)
}

function sanitizeOptionalPayloadValue(value: unknown) {
  const text = cleanText(value)
  return text ? text.slice(0, 240) : undefined
}

function buildPayloadFromInput(input: Record<string, any>) {
  const name = cleanText(input.name).slice(0, 160)
  const qr = cleanText(input.qr).slice(0, 240)

  if (!name) return { error: 'Chýba meno osoby.' }
  if (!qr) return { error: 'Chýba QR kód.' }

  const payload: Record<string, string> = { name, qr }
  const group = sanitizeOptionalPayloadValue(input.group)
  const meal = sanitizeOptionalPayloadValue(input.meal)
  const date = sanitizeOptionalPayloadValue(input.date)
  const note = sanitizeOptionalPayloadValue(input.note)

  if (group) payload.group = group
  if (meal) payload.meal = meal
  if (date) payload.date = date
  if (note) payload.note = note

  return { payload }
}

async function buildPersonQrPayload(personId: string) {
  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, registration_group_id')
    .eq('id', personId)
    .maybeSingle()

  if (userError) throw userError
  if (!user?.id) return { error: 'Osoba sa nenašla.' }

  const { data: qrRows, error: qrError } = await supabaseServer
    .from('user_qr_codes')
    .select('qr_code, assigned_at')
    .eq('user_id', personId)
    .eq('active', true)
    .order('assigned_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (qrError) throw qrError

  const qr = cleanText(qrRows?.[0]?.qr_code)
  if (!qr) return { error: 'Osoba nemá aktívny QR kód.' }

  let groupName = ''
  if (user.registration_group_id) {
    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('name')
      .eq('id', user.registration_group_id)
      .maybeSingle()

    if (groupError) throw groupError
    groupName = cleanText(group?.name)
  }

  return {
    payload: {
      name: fullName(user),
      group: groupName,
      meal: 'QR',
      date: slovakDateLabel(),
      qr,
      note: 'QR osoby - personalistika'
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Tlačiť štítky môže iba ADMIN alebo PERSONALISTA.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const printerId = normalizePrinterId(body.printer_id || body.printerId)
    const personId = cleanText(body.person_id || body.personId)

    const payloadResult = personId
      ? await buildPersonQrPayload(personId)
      : buildPayloadFromInput(body.payload || {})

    if (payloadResult.error || !payloadResult.payload) {
      return NextResponse.json({ error: payloadResult.error || 'Neplatné údaje pre tlač.' }, { status: 400 })
    }

    const { data, error } = await supabaseServer
      .from('print_jobs')
      .insert({
        printer_id: printerId,
        status: 'pending',
        payload: payloadResult.payload,
        created_by: actor.id
      })
      .select('id, printer_id, status')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Štítok bol odoslaný do tlače.',
      job: data
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Štítok sa nepodarilo odoslať do tlače.' },
      { status: 500 }
    )
  }
}
