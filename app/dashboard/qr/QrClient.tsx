'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { appText, type AppLanguage } from '@/lib/i18n'

type Props = {
  language: AppLanguage
  meno: string
  priezvisko: string
  email: string
  qrCode: string
  qrKind: 'NONE' | 'DATABASE' | 'WRISTBAND'
}

export default function QrClient({ language, meno, priezvisko, email, qrCode, qrKind }: Props) {
  const copy = appText(language)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const isDatabaseQr = qrKind === 'DATABASE'
  const isWristbandQr = qrKind === 'WRISTBAND'

  useEffect(() => {
    const generate = async () => {
      if (!qrCode || !isDatabaseQr) {
        setQrImage(null)
        return
      }

      const img = await QRCode.toDataURL(qrCode)
      setQrImage(img)
    }

    generate()
  }, [qrCode, isDatabaseQr])

  return (
    <main className="qr-page" style={styles.page}>
      <style>{`
        @media (max-width: 720px) {
          .qr-page { padding: 12px !important; }
          .qr-top-bar { margin-bottom: 12px !important; gap: 10px !important; }
          .qr-logo { height: 42px !important; max-width: 190px !important; }
          .qr-date { font-size: 12px !important; padding: 7px 10px !important; }
          .qr-card { padding: 18px !important; border-radius: 22px !important; box-shadow: 7px 7px 0 #000 !important; }
          .qr-badge { display: none !important; }
          .qr-title { font-size: 34px !important; }
          .qr-subtitle { font-size: 19px !important; white-space: nowrap !important; margin-bottom: 14px !important; }
        }
      `}</style>
      <div className="qr-top-bar" style={styles.topBar}>
        <a href="/dashboard" style={styles.logoLink} aria-label={copy.backToDashboard}>
          <img className="qr-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        </a>
        <div className="qr-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
      </div>

      <section className="qr-card" style={styles.card}>
        <div className="qr-badge" style={styles.badge}>{copy.myQr}</div>

        <h1 className="qr-title" style={styles.title}>POHODA 2026</h1>
        <h2 className="qr-subtitle" style={styles.subtitle}>{copy.dinerIdentification}</h2>

        {!qrCode ? (
          <p style={styles.status}>{copy.qrNotAssigned}</p>
        ) : (
          <div style={styles.qrBox}>
            <h3 style={styles.qrTitle}>
              {meno} {priezvisko}
            </h3>

            <p style={styles.email}>{email}</p>

            <div style={styles.qrCodeText}>
              {isWristbandQr ? copy.wristbandActive : copy.qrActive}
            </div>

            {qrImage && (
              <div style={styles.qrImageWrap}>
                <img src={qrImage} alt="QR code" style={styles.qrImage} />
              </div>
            )}

            {isWristbandQr && (
              <div style={styles.wristbandImageWrap}>
                <img src="/icon.png" alt={copy.wristbandActive} style={styles.wristbandImage} />
              </div>
            )}

            <div style={styles.buttons}>
              {qrImage && (
                <a href={qrImage} download="qr-pohoda-pass.png" style={styles.link}>
                  <button style={styles.primaryButton}>
                    {copy.downloadQr}
                  </button>
                </a>
              )}

              <a href="/dashboard" style={styles.link}>
                <button style={styles.secondaryButton}>
                  {copy.backToDashboard}
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
  logoLink: {
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none'
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
  wristbandImageWrap: {
    width: 250,
    height: 250,
    margin: '0 auto',
    background: '#f6f2ff',
    border: '4px solid #000',
    borderRadius: 24,
    padding: 0,
    overflow: 'hidden'
  },
  wristbandImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  buttons: {
    display: 'flex',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 22
  },
  link: {
    textDecoration: 'none'
  },
  primaryButton: {
    background: '#56db3f',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    fontSize: 16,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '4px 4px 0 #000'
  },
  secondaryButton: {
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 18px',
    fontSize: 16,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '4px 4px 0 #000'
  }
}
