import { sendAppEmail } from '@/lib/email'
import { checkRateLimit, checkValueRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function clean(value: any) {
  return String(value || '').trim()
}

function emailValue(value: any) {
  const email = clean(value).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export async function POST(req: Request) {
  try {
    const ipLimit = checkRateLimit(req, 'registration-qr-email', 10, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit)

    const { email: rawEmail, qrCode: rawQrCode } = await req.json()
    const email = emailValue(rawEmail)
    const qrCode = clean(rawQrCode)

    if (!email || !qrCode || qrCode.length > 120) {
      return Response.json({ error: 'Neplatne udaje.' }, { status: 400 })
    }

    const emailLimit = checkValueRateLimit('registration-qr-email-address', email, 3, 10 * 60 * 1000)
    if (!emailLimit.ok) return rateLimitResponse(emailLimit)

    const { data: user, error: userError } = await supabaseServer
      .from('users')
      .select('id, qr_code')
      .eq('email', email)
      .maybeSingle()

    if (userError) {
      return Response.json({ error: userError.message }, { status: 500 })
    }

    let qrMatches = clean(user?.qr_code) === qrCode

    if (user?.id && !qrMatches) {
      const { data: qrRow, error: qrError } = await supabaseServer
        .from('user_qr_codes')
        .select('id')
        .eq('user_id', user.id)
        .eq('qr_code', qrCode)
        .eq('active', true)
        .maybeSingle()

      if (qrError) {
        return Response.json({ error: qrError.message }, { status: 500 })
      }

      qrMatches = Boolean(qrRow)
    }

    if (!user || !qrMatches) {
      return Response.json({ error: 'QR kod nepatri k zadanemu e-mailu.' }, { status: 403 })
    }

    const data = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Tvoj QR kód - POHODA 2026',
      html: `
        <h2>Si už registrovaný</h2>
        <p>Tvoj QR kód:</p>
        <p><b>${qrCode}</b></p>
        <p>Uschovaj si ho - budeš ho potrebovať na výdaj stravy.</p>
      `
    })

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || err }, { status: 500 })
  }
}
