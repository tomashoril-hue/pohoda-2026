import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const DEFAULT_PRINTER_ID = 'vydaj-zurnal'
const PRINT_TIME_ZONE = 'Europe/Bratislava'

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

function zplText(value: unknown, maxLength = 120) {
  return cleanText(value)
    .replace(/[\^~]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
}

function currentPrintDateTime() {
  const parts = new Intl.DateTimeFormat('sk-SK', {
    timeZone: PRINT_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date())

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || ''

  const day = getPart('day').padStart(2, '0')
  const month = getPart('month').padStart(2, '0')

  return `${day}.${month}.${getPart('year')}  ${getPart('hour')}:${getPart('minute')}`
}

function buildPersonQrLabelZpl(input: {
  name: string
  group: string
  meal: string
  qr: string
}) {
  const name = zplText(input.name, 52)
  const group = zplText(input.group || '-', 54)
  const meal = zplText(input.meal || 'NEZADANE', 18)
  const qr = zplText(input.qr, 120)
  const printedAt = zplText(currentPrintDateTime(), 24)

  return [
    '^XA',
    '^CI28',
    '^PW384',
    '^LL490',
    '^MMT',
    '^MNN',
    '^POI',
    '~TA020',
    '^LT0',
    '^FO20,50^GB344,395,2,15^FS',
    '^FO90,65',
    '^BQN,2,11',
    '^FDLA,' + qr + '^FS',
    '^FO0,300^FB384,1,0,C,0^A0N,23,23^FDMeno: ' + name + '^FS',
    '^FO0,330^FB384,1,0,C,0^A0N,21,21^FDSkupina: ' + group + '^FS',
    '^FO112,362^GB160,32,2,15^FS',
    '^FO112,370^FB160,1,0,C,0^A0N,18,18^FDTyp stravy: ' + meal + '^FS',
    '^FC%,H,M',
    '^FO0,415^FB384,1,0,C,0^A0N,22,22^FD' + printedAt + '^FS',
    '^XZ'
  ].join('\n')
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

  payload.type = 'zpl'
  payload.template = 'person_qr_label'
  payload.zpl = cleanText(input.zpl) || buildPersonQrLabelZpl({
    name,
    group: group || '',
    meal: meal || '',
    qr
  })

  return { payload }
}

async function buildPersonQrPayload(personId: string) {
  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, typ_stravy, registration_group_id')
    .eq('id', personId)
    .maybeSingle()

  if (userError) throw userError
  if (!user?.id) return { error: 'Osoba sa nenašla.' }

  const { data: qrRows, error: qrError } = await supabaseServer
    .from('user_qr_codes')
    .select('qr_code')
    .eq('user_id', personId)
    .eq('active', true)
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

  const meal = cleanText(user.typ_stravy) || 'NEZADANE'
  const name = fullName(user)
  const zpl = buildPersonQrLabelZpl({
    name,
    group: groupName,
    meal,
    qr
  })

  return {
    payload: {
      type: 'zpl',
      template: 'person_qr_label',
      name,
      group: groupName,
      registrationGroup: groupName,
      meal,
      food: meal,
      foodType: meal,
      typStravy: meal,
      defaultMeal: meal,
      qr,
      zpl
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
