import { NextRequest, NextResponse } from 'next/server'
import { hashAccessCode, isValidAccessCodeFormat, normalizeAccessCode, normalizeAccessName } from '@/lib/accessCode'
import { createSessionResponse } from '@/lib/sessionResponse'
import { supabaseServer } from '@/lib/supabaseServer'

const MAX_ACCESS_CODE_ATTEMPTS = 8

function text(value: any) {
  return String(value || '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const meno = text(body.meno)
    const priezvisko = text(body.priezvisko)
    const code = normalizeAccessCode(body.code)
    const menoKey = normalizeAccessName(meno)
    const priezviskoKey = normalizeAccessName(priezvisko)

    if (!meno || !priezvisko) {
      return NextResponse.json({ error: 'Zadaj meno aj priezvisko.' }, { status: 400 })
    }

    if (!isValidAccessCodeFormat(code)) {
      return NextResponse.json({ error: 'Zadaj 8-miestny pristupovy kod.' }, { status: 400 })
    }

    const expectedHash = hashAccessCode(meno, priezvisko, code)

    const { data: accessCodes, error: accessCodeError } = await supabaseServer
      .from('user_access_codes')
      .select(`
        id,
        user_id,
        code_hash,
        failed_attempts
      `)
      .eq('meno_key', menoKey)
      .eq('priezvisko_key', priezviskoKey)
      .eq('active', true)
      .limit(20)

    if (accessCodeError) {
      return NextResponse.json({ error: accessCodeError.message }, { status: 500 })
    }

    const matchingCode = (accessCodes || []).find((item: any) => item.code_hash === expectedHash)

    if (!matchingCode) {
      const now = new Date().toISOString()

      await Promise.all((accessCodes || [])
        .filter((item: any) => item.id && Number(item.failed_attempts || 0) < MAX_ACCESS_CODE_ATTEMPTS)
        .map((item: any) => supabaseServer
          .from('user_access_codes')
          .update({
            failed_attempts: Number(item.failed_attempts || 0) + 1,
            last_failed_at: now,
            updated_at: now
          })
          .eq('id', item.id)))

      return NextResponse.json({ error: 'Meno, priezvisko alebo kod nesedi.' }, { status: 400 })
    }

    const attempts = Number(matchingCode.failed_attempts || 0)

    if (attempts >= MAX_ACCESS_CODE_ATTEMPTS) {
      return NextResponse.json({ error: 'Prilis vela pokusov. Kontaktuj organizatora.' }, { status: 429 })
    }

    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, aktivny, review_status')
      .eq('id', matchingCode.user_id)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 })
    }

    if (!user || String(user.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json({ error: 'Tento ucet je zablokovany.' }, { status: 403 })
    }

    if (String(user.review_status || 'APPROVED').toUpperCase() !== 'APPROVED') {
      return NextResponse.json({ error: 'Tento ucet este nie je schvaleny.' }, { status: 403 })
    }

    await supabaseServer
      .from('user_access_codes')
      .update({
        failed_attempts: 0,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', matchingCode.id)

    return createSessionResponse(matchingCode.user_id)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
