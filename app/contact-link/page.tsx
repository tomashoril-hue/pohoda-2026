import ContactLinkClient from './ContactLinkClient'

function text(value: any) {
  return String(value || '').trim()
}

export default async function ContactLinkPage({
  searchParams
}: {
  searchParams: Promise<{ channel?: string; phone?: string; message?: string }>
}) {
  const params = await searchParams
  const channel = text(params.channel) === 'whatsapp' ? 'whatsapp' : 'sms'
  const phone = text(params.phone)
  const message = text(params.message)

  return (
    <ContactLinkClient
      channel={channel}
      phone={phone}
      message={message}
    />
  )
}
