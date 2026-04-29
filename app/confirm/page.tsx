'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import QRCode from 'qrcode'

export default function ConfirmPage() {
  return (
    <Suspense fallback={<ConfirmLoading />}>
      <ConfirmContent />
    </Suspense>
  )
}

function ConfirmLoading() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p style={styles.status}>Načítavam potvrdenie...</p>
      </section>
    </main>
  )
}

function ConfirmContent() {
  const params = useSearchParams()
  const token = params.get('token')

  const [status, setStatus] = useState('Potvrdzujem registráciu...')
  const [qrCode, setQrCode] = useState('')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const confirm = async () => {
      if (!token) {
        setStatus('Chýba token.')
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/auth/confirm?token=${token}`)
        const json = await res.json()

        if (!res.ok || json.error) {
          setStatus(json.error || 'Nepodarilo sa potvrdiť registráciu.')
          setLoading(false)
          return
        }

        const qr = json.qrCode || json.user?.qr_code
        const mail = json.user?.email || ''

        const qrImg = await QRCode.toDataURL(qr)

        setQrCode(qr)
        setQrImage(qrImg)
        setEmail(mail)

        setStatus('Registrácia potvrdená. Ste prihlásený.')
      } catch (err: any) {
        setStatus('Chyba: ' + err.message)
      } finally {
        setLoading(false)
      }
    }

    confirm()
  }, [token])

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Registrácia stravy</div>

        <h1 style={styles.title}>POHODA 2026</h1>
        <h2 style={styles.subtitle}>Potvrdenie registrácie</h2>

        <p style={styles.status}>{loading ? 'Spracovávam...' : status}</p>

        {qrImage && (
          <div style={styles.qrBox}>
            <h3 style={styles.qrTitle}>Tvoj QR kód</h3>

            {email && <p style={styles.email}>{email}</p>}

            <div style={styles.qrCodeText}>{qrCode}</div>

            <div style={styles.qrImageWrap}>
              <img src={qrImage} alt="QR kód" style={styles.qrImage} />
            </div>

            <div style={styles.buttons}>
              <a href={qrImage} download={`qr-${qrCode}.png`} style={styles.link}>
                <button style={styles.primaryButton}>Stiahnuť QR kód</button>
              </a>

              <a href="/dashboard" style={styles.link}>
                <button style={styles.secondaryButton}>Pokračovať do aplikácie</button>
              </a>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background:
      'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  title: {
    fontSize: 46,
    lineHeight: 1,
    margin: 0,
    fontWeight: 950
  },
  subtitle: {
    fontSize: 28,
    marginTop: 8,
    marginBottom: 20
  },
  status: {
    fontSize: 20,
    lineHeight: 1.4,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontWeight: 700
  },
  qrBox: {
    marginTop: 30,
    textAlign: 'center'
  },
  qrTitle: {
    fontSize: 28,
    marginBottom: 8
  },
  email: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 12
  },
  qrCodeText: {
    display: 'inline-block',
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '8px 18px',
    fontSize: 20,
    fontWeight: 900,
    letterSpacing: 1,
    marginBottom: 18
  },
  qrImageWrap: {
    width: 250,
    height: 250,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 24,
    padding: 16
  },
  qrImage: {
    width: '100%',
    height: '100%'
  },
  buttons: {
    marginTop: 26,
    display: 'flex',
    justifyContent: 'center',
    gap: 14,
    flexWrap: 'wrap'
  },
  link: {
    textDecoration: 'none'
  },
  primaryButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '13px 22px',
    fontSize: 17,
    fontWeight: 900,
    cursor: 'pointer'
  },
  secondaryButton: {
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '13px 22px',
    fontSize: 17,
    fontWeight: 900,
    cursor: 'pointer'
  }
}