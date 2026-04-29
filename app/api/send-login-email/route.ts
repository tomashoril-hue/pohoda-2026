import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  try {
    const { email, meno, loginUrl } = await req.json()

    const { data, error } = await resend.emails.send({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: email,
      subject: 'Prihlásenie do systému – POHODA 2026',
      html: `
        <h2>Prihlásenie</h2>
        <p>Dobrý deň${meno ? `, ${meno}` : ''},</p>
        <p>Klikni na tlačidlo pre prihlásenie:</p>

        <p>
          <a href="${loginUrl}" style="font-weight:bold;">
            Prihlásiť sa
          </a>
        </p>

        <p>Link je jednorazový a platí krátky čas.</p>
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