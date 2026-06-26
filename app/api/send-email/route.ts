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
    const ipLimit = checkRateLimit(req, 'registration-confirm-email', 12, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit)

    const { email: rawEmail, token: rawToken } = await req.json()
    const email = emailValue(rawEmail)
    const token = clean(rawToken)

    if (!email || !/^[a-f0-9-]{20,}$/i.test(token)) {
      return Response.json({ error: 'Neplatne udaje.' }, { status: 400 })
    }

    const emailLimit = checkValueRateLimit('registration-confirm-email-address', email, 3, 10 * 60 * 1000)
    if (!emailLimit.ok) return rateLimitResponse(emailLimit)

    const { data: registration, error: registrationError } = await supabaseServer
      .from('registrations')
      .select('id')
      .eq('email', email)
      .eq('confirmation_token', token)
      .eq('status', 'PENDING')
      .maybeSingle()

    if (registrationError) {
      return Response.json({ error: registrationError.message }, { status: 500 })
    }

    if (!registration) {
      return Response.json({ error: 'Registracia sa nenasla alebo token neplati.' }, { status: 403 })
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000')

    const confirmLink = `${baseUrl}/confirm?token=${token}`

    const data = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Potvrdenie registrácie - POHODA 2026',
      html: `
        <h2>Potvrď registráciu</h2>
        <p>Klikni na link:</p>
        <a href="${confirmLink}">${confirmLink}</a>
      `
    })

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || err }, { status: 500 })
  }
}
