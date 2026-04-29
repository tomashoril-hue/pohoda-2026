import { Resend } from 'resend'
import QRCode from 'qrcode'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  try {
    const { email, qrCode } = await req.json()

    if (!email || !qrCode) {
      return Response.json({ error: 'Chýba email alebo QR kód' }, { status: 400 })
    }

    const qrDataUrl = await QRCode.toDataURL(qrCode)
    const base64Qr = qrDataUrl.split(',')[1]

    const { data, error } = await resend.emails.send({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Tvoj QR kód – POHODA 2026',
      html: `
        <h2>Registrácia potvrdená</h2>
        <p>Tvoj QR kód je:</p>
        <h3>${qrCode}</h3>
        <p>QR kód nájdeš aj v prílohe.</p>
      `,
      attachments: [
        {
          filename: `qr-${qrCode}.png`,
          content: base64Qr
        }
      ]
    })

    if (error) {
      return Response.json({ error }, { status: 400 })
    }

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || String(err) }, { status: 500 })
  }
}