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

function htmlEscape(value: any) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  try {
    const ipLimit = checkRateLimit(req, 'registration-confirm-email', 12, 10 * 60 * 1000)
    if (!ipLimit.ok) return rateLimitResponse(ipLimit)

    const body = await req.json()
    const email = emailValue(body?.email)
    const token = clean(body?.token)
    const language = clean(body?.language).toUpperCase() === 'EN' ? 'EN' : 'SK'

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
    const faviconUrl = `${baseUrl}/favicon.ico`
    const copy = language === 'EN'
      ? {
          subject: 'Confirm your registration - POHODA 2026',
          heading: 'Confirm your registration',
          intro: 'We have received your registration in the PohodaPass meal system.',
          body: 'Please confirm your e-mail address by clicking the button below. After confirmation, the personnel team will review your registration. Once approved, your QR code and app access will be activated.',
          button: 'Confirm registration',
          fallback: 'If the button does not work, open this link:',
          footer: 'If you did not request this registration, you can ignore this e-mail.'
        }
      : {
          subject: 'Potvrdenie registrácie - POHODA 2026',
          heading: 'Potvrď registráciu',
          intro: 'Prijali sme tvoju registráciu do stravovacieho systému PohodaPass.',
          body: 'Prosím potvrď svoju e-mailovú adresu kliknutím na tlačidlo nižšie. Po potvrdení registráciu skontroluje personalista. Po schválení sa ti aktivuje QR kód a prístup do aplikácie.',
          button: 'Potvrdiť registráciu',
          fallback: 'Ak tlačidlo nefunguje, otvor tento odkaz:',
          footer: 'Ak si túto registráciu nevytvoril/a, tento e-mail môžeš ignorovať.'
        }

    const safeConfirmLink = htmlEscape(confirmLink)

    const data = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: copy.subject,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
          <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td align="left">
                  <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">PohodaPass</div>
                </td>
                <td align="right" style="vertical-align:middle;padding-right:10px;">
                  <img src="${htmlEscape(faviconUrl)}" alt="PohodaPass" width="42" height="42" style="display:block;width:42px;height:42px;">
                </td>
              </tr>
            </table>

            <h1 style="font-size:26px;line-height:1.12;margin:20px 0 10px;font-weight:950;">${htmlEscape(copy.heading)}</h1>
            <p style="font-size:16px;line-height:1.5;margin:0 0 12px;font-weight:700;">${htmlEscape(copy.intro)}</p>
            <p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#333;">${htmlEscape(copy.body)}</p>

            <p style="margin:20px 0;">
              <a href="${safeConfirmLink}" style="display:inline-block;background:#7417e8;color:#fff;border:3px solid #000;border-radius:999px;padding:12px 18px;font-weight:900;text-decoration:none;">${htmlEscape(copy.button)}</a>
            </p>

            <p style="font-size:13px;line-height:1.45;margin:18px 0 6px;color:#555;">${htmlEscape(copy.fallback)}</p>
            <p style="font-size:13px;line-height:1.45;margin:0;word-break:break-all;">
              <a href="${safeConfirmLink}" style="color:#7417e8;font-weight:900;">${safeConfirmLink}</a>
            </p>

            <p style="font-size:12px;line-height:1.45;margin:20px 0 0;color:#666;">${htmlEscape(copy.footer)}</p>
          </div>
        </div>
      `,
      text: `${copy.heading}\n\n${copy.intro}\n\n${copy.body}\n\n${copy.button}: ${confirmLink}\n\n${copy.footer}`
    })

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || err }, { status: 500 })
  }
}
