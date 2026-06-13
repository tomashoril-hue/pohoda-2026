'use client'

import { useEffect, useMemo } from 'react'

type Channel = 'sms' | 'whatsapp'

function cleanPhone(value: string, channel: Channel) {
  const cleaned = String(value || '').replace(channel === 'whatsapp' ? /[^\d]/g : /[^\d+]/g, '')

  return cleaned
}

function buildTargetUrl(channel: Channel, phone: string, message: string) {
  if (channel === 'whatsapp') {
    return `https://wa.me/${cleanPhone(phone, channel)}?text=${encodeURIComponent(message)}`
  }

  const normalizedPhone = cleanPhone(phone, channel)
  const isApple = /iPad|iPhone|iPod/i.test(navigator.userAgent)
  const separator = isApple ? '&' : '?'

  return `sms:${normalizedPhone}${separator}body=${encodeURIComponent(message)}`
}

export default function ContactLinkClient({
  channel,
  phone,
  message
}: {
  channel: Channel
  phone: string
  message: string
}) {
  const targetUrl = useMemo(() => buildTargetUrl(channel, phone, message), [channel, phone, message])
  const title = channel === 'whatsapp' ? 'Otvoriť WhatsApp' : 'Otvoriť SMS'
  const description = channel === 'whatsapp'
    ? 'Ak sa WhatsApp neotvoril automaticky, stlač tlačidlo nižšie.'
    : 'Ak sa SMS aplikácia neotvorila automaticky, stlač tlačidlo nižšie.'

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.location.href = targetUrl
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [targetUrl])

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.badge}>PohodaPass</div>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.text}>{description}</p>
        <a href={targetUrl} style={styles.button}>
          {title}
        </a>
        <p style={styles.phone}>{phone}</p>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 20,
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  card: {
    width: 'min(100%, 460px)',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 24,
    padding: 24,
    boxShadow: '10px 10px 0 #000',
    textAlign: 'center'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 14px',
    fontWeight: 950,
    marginBottom: 18
  },
  title: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.05,
    fontWeight: 950
  },
  text: {
    margin: '14px 0 22px',
    fontSize: 16,
    lineHeight: 1.45,
    fontWeight: 750
  },
  button: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '15px 20px',
    fontSize: 18,
    fontWeight: 950,
    textDecoration: 'none'
  },
  phone: {
    margin: '14px 0 0',
    color: '#555',
    fontSize: 13,
    fontWeight: 800
  }
}
