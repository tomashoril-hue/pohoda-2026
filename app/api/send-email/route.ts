import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  try {
    const { email, token } = await req.json()

    const confirmLink = `http://localhost:3000/confirm?token=${token}`

    const { data, error } = await resend.emails.send({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Potvrdenie registrácie – POHODA 2026',
      html: `
        <h2>Potvrď registráciu</h2>
        <p>Klikni na link:</p>
        <a href="${confirmLink}">${confirmLink}</a>
      `
    })

    if (error) {
      return Response.json({ error }, { status: 400 })
    }

    return Response.json({ data })
  } catch (err: any) {
    return Response.json({ error: err.message || err }, { status: 500 })
  }
}