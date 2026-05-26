import { sendAppEmail } from '@/lib/email'

export async function POST(req: Request) {
  try {
    const { email, token } = await req.json()

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
