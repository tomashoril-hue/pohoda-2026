import { sendAppEmail } from '@/lib/email'

export async function POST(req: Request) {
  try {
    const { email, qrCode } = await req.json()

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
