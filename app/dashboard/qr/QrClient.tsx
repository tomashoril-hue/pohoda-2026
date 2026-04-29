'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

type Props = {
  meno: string
  priezvisko: string
  email: string
  qrCode: string
}

export default function QrClient({ meno, priezvisko, email, qrCode }: Props) {
  const [qrImage, setQrImage] = useState<string | null>(null)

  useEffect(() => {
    const generate = async () => {
      if (!qrCode) return
      const img = await QRCode.toDataURL(qrCode)
      setQrImage(img)
    }

    generate()
  }, [qrCode])

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Môj QR kód</div>

        <h1 style={styles.title}>POHODA 2026</h1>
        <h2 style={styles.subtitle}>Identifikácia stravníka</h2>

        {!qrCode ? (
          <p style={styles.status}>
            QR kód zatiaľ nie je priradený.
          </p>
        ) : (
          <div style={styles.qrBox}>
            <h3 style={styles.qrTitle}>
              {meno} {priezvisko}
            </h3>

            <p style={styles.email}>{email}</p>

            <div style={styles.qrCodeText}>{qrCode}</div>

            {qrImage && (
              <div style={styles.qrImageWrap}>
                <img src={qrImage} alt="QR kód" style={styles.qrImage} />
              </div>
            )}

            <div style={styles.buttons}>
              {qrImage && (
                <a href={qrImage} download={`qr-${qrCode}.png`} style={styles.link}>
                  <button style={styles.primaryButton}>
                    Stiahnuť QR kód
                  </button>
                </a>
              )}

              <a href="/dashboard" style={styles.link}>
                <button style={styles.secondaryButton}>
                  Späť na dashboard
                </button>
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
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
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
    marginBottom: 20,
    fontWeight: 900
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
    marginBottom: 8,
    fontWeight: 900
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