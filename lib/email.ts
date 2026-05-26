import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { Resend } from 'resend'

type SendAppEmailInput = {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
}

type SendAppEmailResult = {
  provider: 'ses' | 'resend'
  messageId?: string
}

let sesClient: SESClient | null = null
let resendClient: Resend | null = null

function getSesRegion() {
  return process.env.AWS_SES_REGION || process.env.AWS_REGION || ''
}

function hasSesConfig() {
  return Boolean(
    getSesRegion() &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  )
}

function getSesClient() {
  if (!sesClient) {
    sesClient = new SESClient({
      region: getSesRegion(),
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    })
  }

  return sesClient
}

function getResendClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }

  return resendClient
}

export async function sendAppEmail(input: SendAppEmailInput): Promise<SendAppEmailResult> {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to]

  if (hasSesConfig()) {
    const command = new SendEmailCommand({
      Source: input.from,
      Destination: {
        ToAddresses: toAddresses
      },
      Message: {
        Subject: {
          Data: input.subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: input.html,
            Charset: 'UTF-8'
          },
          ...(input.text
            ? {
                Text: {
                  Data: input.text,
                  Charset: 'UTF-8'
                }
              }
            : {})
        }
      }
    })

    const data = await getSesClient().send(command)

    return {
      provider: 'ses',
      messageId: data.MessageId
    }
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error('Chyba konfiguracia e-mailu. Nastav AWS SES alebo RESEND_API_KEY.')
  }

  const { data, error } = await getResendClient().emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text
  })

  if (error) {
    throw new Error(error.message || 'E-mail sa nepodarilo odoslat cez Resend.')
  }

  return {
    provider: 'resend',
    messageId: data?.id
  }
}
