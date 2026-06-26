import { sendAppEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'

export async function POST(req: Request) {
  try {
    const expectedToken = process.env.INTERNAL_EMAIL_TOKEN || ''
    const requestToken = req.headers.get('x-internal-email-token') || ''

    if (!expectedToken || requestToken !== expectedToken) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const limit = checkRateLimit(req, 'send-login-email-internal', 30, 60 * 1000)
    if (!limit.ok) return rateLimitResponse(limit)

    const { email, meno, loginUrl, loginCode } = await req.json()

    const codeBlock = loginCode
      ? `
        <p>Alebo otvor aplikáciu a zadaj prihlasovací kód:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:12px 0;">
          ${loginCode}
        </p>
      `
      : ''

    const data = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Prihlásenie do systému - POHODA PASS',
      html: `
        <h2>Prihlásenie</h2>
        <p>Dobrý deň${meno ? `, ${meno}` : ''},</p>
        <p>Klikni na tlačidlo pre prihlásenie:</p>

        <p>
          <a href="${loginUrl}" style="font-weight:bold;">
            Prihlásiť sa
          </a>
        </p>

        ${codeBlock}

        <p>Link aj kód sú jednorazové a platia krátky čas.</p>
      `
    })

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || err }, { status: 500 })
  }
}
