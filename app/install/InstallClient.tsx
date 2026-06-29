'use client'

import { useEffect, useMemo, useState } from 'react'

type DeviceType = 'android' | 'ios' | 'desktop'
type InstallStatus = 'idle' | 'accepted' | 'dismissed' | 'unavailable'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function detectDevice(): DeviceType {
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const isIpadOs = platform === 'MacIntel' && navigator.maxTouchPoints > 1

  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || isIpadOs) return 'ios'

  return 'desktop'
}

function detectStandalone() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    standaloneNavigator.standalone === true
  )
}

function detectSafari() {
  const ua = navigator.userAgent || ''
  return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua)
}

export default function InstallClient() {
  const [ready, setReady] = useState(false)
  const [device, setDevice] = useState<DeviceType>('desktop')
  const [standalone, setStandalone] = useState(false)
  const [isSafari, setIsSafari] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installStatus, setInstallStatus] = useState<InstallStatus>('idle')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    setDevice(detectDevice())
    setStandalone(detectStandalone())
    setIsSafari(detectSafari())
    setReady(true)

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      setInstallStatus('idle')
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setStandalone(true)
      setInstallStatus('accepted')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const copy = useMemo(() => {
    if (standalone) {
      return {
        eyebrow: 'Aplikácia',
        title: 'Aplikácia POHODA Pass je už nainštalovaná.',
        subtitle: 'Môžeš ju používať priamo z plochy telefónu.'
      }
    }

    if (device === 'ios') {
      return {
        eyebrow: 'iPhone / iPad',
        title: 'Pridaj si POHODA Pass na plochu',
        subtitle: 'Pre rýchly prístup počas festivalu si pridaj aplikáciu na plochu telefónu.'
      }
    }

    if (device === 'android') {
      return {
        eyebrow: 'Android',
        title: 'Nainštaluj si aplikáciu POHODA Pass',
        subtitle: 'Pre rýchly prístup počas festivalu si pridaj aplikáciu na plochu telefónu.'
      }
    }

    return {
      eyebrow: 'POHODA Pass',
      title: 'Nainštaluj si POHODA Pass',
      subtitle: 'POHODA Pass vieš používať aj na počítači. Pre výdaj a skenovanie QR kódov odporúčame telefón alebo tablet.'
    }
  }, [device, standalone])

  const openApp = () => {
    window.location.href = '/'
  }

  const installApp = async () => {
    if (!deferredPrompt) {
      setInstallStatus('unavailable')
      return
    }

    setInstalling(true)

    try {
      await deferredPrompt.prompt()
      const choiceResult = await deferredPrompt.userChoice

      if (choiceResult.outcome === 'accepted') {
        setInstallStatus('accepted')
        setStandalone(true)
      } else {
        setInstallStatus('dismissed')
      }

      setDeferredPrompt(null)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <main className="install-page" style={styles.page}>
      <style>{`
        .install-page button,
        .install-page a {
          touch-action: manipulation;
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
          -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
        }

        .install-page button:not(:disabled):active,
        .install-page a:active {
          transform: translate(2px, 2px) scale(0.98);
          filter: brightness(0.94);
          box-shadow: 2px 2px 0 #000 !important;
        }

        @media (max-width: 520px) {
          .install-page { padding: 14px !important; }
          .install-card { padding: 22px !important; border-radius: 24px !important; }
          .install-title { font-size: 34px !important; }
          .install-logo { height: 42px !important; }
        }
      `}</style>

      <section className="install-card" style={styles.card}>
        <header style={styles.header}>
          <img className="install-logo" src="/logo.png" alt="POHODA" style={styles.logo} />
          <div style={styles.brand}>POHODA Pass</div>
        </header>

        <div style={styles.eyebrow}>{copy.eyebrow}</div>
        <h1 className="install-title" style={styles.title}>{copy.title}</h1>
        <p style={styles.subtitle}>{copy.subtitle}</p>

        {!ready && (
          <div style={styles.notice}>Pripravujem návod...</div>
        )}

        {ready && standalone && (
          <div style={styles.successBox}>
            <b>Aplikácia POHODA Pass je už nainštalovaná.</b>
            <span>Môžeš ju používať priamo z plochy telefónu.</span>
          </div>
        )}

        {ready && !standalone && device === 'android' && (
          <div style={styles.guideBox}>
            <b>Android</b>
            <p style={styles.guideText}>
              Na Androide klikni na tlačidlo Nainštalovať aplikáciu. Ak sa tlačidlo nezobrazí,
              otvor stránku v Chrome, klikni na tri bodky vpravo hore a vyber Pridať na plochu
              alebo Inštalovať aplikáciu.
            </p>
          </div>
        )}

        {ready && !standalone && device === 'ios' && (
          <div style={styles.guideBox}>
            {!isSafari && (
              <div style={styles.warning}>
                Na iPhone odporúčame otvoriť túto stránku v Safari. Potom použi Zdieľať - Pridať na plochu.
              </div>
            )}

            <b>iPhone / iPad</b>
            <ol style={styles.steps}>
              <li>Otvor túto stránku v Safari.</li>
              <li>Klikni dole na ikonu Zdieľať.</li>
              <li>Vyber možnosť Pridať na plochu.</li>
              <li>Potvrď tlačidlom Pridať.</li>
            </ol>
          </div>
        )}

        {ready && !standalone && device === 'desktop' && (
          <div style={styles.guideBox}>
            <b>Počítač alebo iné zariadenie</b>
            <p style={styles.guideText}>
              POHODA Pass vieš používať aj na počítači. Pre výdaj a skenovanie QR kódov odporúčame Android alebo iPhone.
            </p>
          </div>
        )}

        {installStatus === 'accepted' && (
          <div style={styles.successBox}>Aplikácia bola pridaná na plochu telefónu.</div>
        )}

        {installStatus === 'dismissed' && (
          <div style={styles.notice}>Inštalácia bola zrušená. Môžeš to skúsiť znova alebo použiť manuálny návod.</div>
        )}

        {installStatus === 'unavailable' && (
          <div style={styles.notice}>Ak sa tlačidlo nezobrazuje, použi manuálny návod pre svoje zariadenie.</div>
        )}

        <div style={styles.actions}>
          {ready && !standalone && device === 'android' && deferredPrompt && (
            <button type="button" style={styles.primaryButton} onClick={installApp} disabled={installing}>
              {installing ? 'Inštalujem...' : 'Nainštalovať aplikáciu'}
            </button>
          )}

          {ready && !standalone && device === 'android' && !deferredPrompt && (
            <button type="button" style={styles.secondaryButton} onClick={() => setInstallStatus('unavailable')}>
              Zobraziť manuálny návod
            </button>
          )}

          <button type="button" style={standalone ? styles.primaryButton : styles.openButton} onClick={openApp}>
            {standalone ? 'Pokračovať do aplikácie' : 'Otvoriť POHODA Pass'}
          </button>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 48%, #56db3f 100%)',
    padding: 20,
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  card: {
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 30,
    padding: 30,
    boxShadow: '12px 12px 0 #000',
    display: 'grid',
    gap: 16,
    boxSizing: 'border-box'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  logo: {
    height: 48,
    width: 'auto',
    objectFit: 'contain'
  },
  brand: {
    border: '3px solid #000',
    borderRadius: 999,
    padding: '7px 12px',
    background: '#56db3f',
    fontSize: 13,
    fontWeight: 950,
    whiteSpace: 'nowrap'
  },
  eyebrow: {
    marginTop: 4,
    color: '#7417e8',
    fontSize: 13,
    fontWeight: 950,
    textTransform: 'uppercase'
  },
  title: {
    margin: 0,
    fontSize: 42,
    lineHeight: 0.98,
    fontWeight: 950
  },
  subtitle: {
    margin: 0,
    color: '#374151',
    fontSize: 17,
    lineHeight: 1.35,
    fontWeight: 800
  },
  guideBox: {
    border: '3px solid #000',
    borderRadius: 20,
    background: '#f8fafc',
    padding: 16,
    display: 'grid',
    gap: 10,
    fontSize: 15,
    fontWeight: 850
  },
  guideText: {
    margin: 0,
    color: '#374151',
    lineHeight: 1.45
  },
  steps: {
    margin: 0,
    paddingLeft: 22,
    display: 'grid',
    gap: 8,
    color: '#111827',
    lineHeight: 1.35
  },
  warning: {
    border: '2px solid #f59e0b',
    borderRadius: 14,
    background: '#fffbeb',
    color: '#92400e',
    padding: 10,
    fontSize: 14,
    fontWeight: 900,
    lineHeight: 1.35
  },
  successBox: {
    border: '3px solid #16a34a',
    borderRadius: 18,
    background: '#dcfce7',
    color: '#14532d',
    padding: 14,
    display: 'grid',
    gap: 4,
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.35
  },
  notice: {
    border: '2px solid #cbd5e1',
    borderRadius: 16,
    background: '#f8fafc',
    color: '#334155',
    padding: 12,
    fontSize: 14,
    fontWeight: 850,
    lineHeight: 1.35
  },
  actions: {
    display: 'grid',
    gap: 10
  },
  primaryButton: {
    minHeight: 56,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#56db3f',
    color: '#000',
    boxShadow: '5px 5px 0 #000',
    fontSize: 17,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  secondaryButton: {
    minHeight: 50,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#fff',
    color: '#000',
    boxShadow: '4px 4px 0 #000',
    fontSize: 15,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  openButton: {
    minHeight: 50,
    border: '3px solid #000',
    borderRadius: 999,
    background: '#000',
    color: '#fff',
    boxShadow: '4px 4px 0 #000',
    fontSize: 15,
    fontWeight: 950,
    fontFamily: 'Arial, Helvetica, sans-serif'
  }
}
