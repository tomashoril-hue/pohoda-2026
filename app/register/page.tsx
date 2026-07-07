import { requestLanguage } from '@/lib/i18nServer'
import { getPublicRegistrationEnabled } from '@/lib/appSettings'
import Link from 'next/link'
import RegisterClient from './RegisterClient'

export default async function RegisterPage() {
  const language = await requestLanguage()
  const registrationEnabled = await getPublicRegistrationEnabled()

  if (!registrationEnabled) {
    const isEnglish = language === 'EN'

    return (
      <main style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
        padding: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: '#000'
      }}>
        <section style={{
          width: '100%',
          maxWidth: 520,
          background: 'rgba(255,255,255,0.97)',
          border: '2px solid #000',
          borderRadius: 28,
          padding: 28,
          boxShadow: '0 18px 46px rgba(0,0,0,0.24)',
          textAlign: 'center'
        }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.05, fontWeight: 950 }}>
            {isEnglish ? 'Registration is currently disabled' : 'Registracia je momentalne vypnuta'}
          </h1>

          <p style={{ margin: '14px 0 22px', fontSize: 17, lineHeight: 1.35, fontWeight: 800, color: '#4b5563' }}>
            {isEnglish
              ? 'If you already have an account, sign in to POHODA Pass.'
              : 'Ak uz mas ucet, prihlas sa do POHODA Pass.'}
          </p>

          <Link href="/login" style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
            padding: '0 24px',
            borderRadius: 999,
            border: '3px solid #000',
            background: '#000',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 950,
            fontSize: 17
          }}>
            {isEnglish ? 'Sign in' : 'Prihlasit sa'}
          </Link>
        </section>
      </main>
    )
  }

  return <RegisterClient language={language} />
}
