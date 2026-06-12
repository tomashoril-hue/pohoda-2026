import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { Resend } from 'resend'

type SendAppEmailInput = {
  from: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  attachments?: Array<{
    filename: string
    content: string
    contentType?: string
  }>
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

async function sendWithSes(input: SendAppEmailInput): Promise<SendAppEmailResult> {
  const toAddresses = Array.isArray(input.to) ? input.to : [input.to]

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

async function sendWithResend(input: SendAppEmailInput): Promise<SendAppEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nie je nastaveny.')
  }

  const { data, error } = await getResendClient().emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments?.map(attachment => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType
    }))
  })

  if (error) {
    throw new Error(error.message || 'E-mail sa nepodarilo odoslat cez Resend.')
  }

  return {
    provider: 'resend',
    messageId: data?.id
  }
}

export async function sendAppEmail(input: SendAppEmailInput): Promise<SendAppEmailResult> {
  if (input.attachments?.length) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY nie je nastaveny. Prilohy teraz posielame cez Resend.')
    }

    return sendWithResend(input)
  }

  if (hasSesConfig()) {
    try {
      return await sendWithSes(input)
    } catch (sesError) {
      if (!process.env.RESEND_API_KEY) {
        throw sesError
      }

      console.warn('Amazon SES email failed, falling back to Resend.', sesError)
    }
  }

  return sendWithResend(input)
}
