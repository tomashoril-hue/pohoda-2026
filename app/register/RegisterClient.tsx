'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import type { AppLanguage } from '@/lib/i18n'
import { PRIVACY_POLICY_URL } from '@/lib/privacyConsentConfig'
import { supabase } from '../../lib/supabaseClient'

type RegistrationGroup = {
  id: string
  name: string
}

type RegisterResult = {
  result_type?: string
  email?: string
  qr_code?: string
}

const NAME_MAX_LENGTH = 60
const EMAIL_MAX_LENGTH = 254
const PHONE_MAX_LENGTH = 24
const REGISTRATION_NOTE_MAX_LENGTH = 120

const registerCopy = {
  SK: {
    badge: 'Registrácia stravy',
    title: 'POHODA 2026',
    subtitle: 'Vyplňte údaje. Po registrácii vám príde potvrdzovací e-mail.',
    firstName: 'Meno',
    lastName: 'Priezvisko',
    email: 'E-mail',
    phone: 'Telefón',
    foodType: 'Typ stravy',
    registrationGroup: 'Registračná skupina',
    groupPlaceholder: 'Začni písať názov skupiny...',
    noGroup: 'Nenašla sa žiadna skupina',
    other: 'Iné',
    otherPlaceholder: 'Napíš, pod koho patríš',
    clearGroup: 'Zrušiť výber skupiny',
    privacyText: 'Beriem na vedomie spracovanie mojich osobných údajov v rozsahu potrebnom na registráciu, správu stravovania, prideľovanie QR/NFC identifikátora, evidenciu výberu stravy, nárokov a výdaja stravy v systéme PohodaPass. Potvrdzujem, že som sa oboznámil/a s',
    privacyLink: 'Pravidlá ochrany osobných údajov',
    submit: 'Registrovať',
    loading: 'Spracovávam...',
    createdTitle: 'Registrácia prijatá',
    createdLine1: 'Na e-mail sme odoslali potvrdzovací link.',
    createdLine2: 'Po potvrdení e-mailu registráciu skontroluje personalista. QR kód vám príde po schválení.',
    pendingTitle: 'Registrácia už čaká na potvrdenie',
    pendingLine1: 'Na e-mail už bol odoslaný potvrdzovací link.',
    pendingLine2: 'Skontrolujte si aj spam.',
    existsTitle: 'Už ste registrovaný',
    existsLine1: 'Tento e-mail už má potvrdenú registráciu.',
    existsQr: 'QR kód sme poslali znova.',
    existsPending: 'Registrácia ešte čaká na kontrolu personalistom.',
    errorEmail: 'Registrácia prebehla, ale e-mail sa nepodarilo odoslať: ',
    validationFirstName: 'Zadaj meno.',
    validationLastName: 'Zadaj priezvisko.',
    validationEmail: 'Zadaj e-mail.',
    validationEmailFormat: 'Zadaj platný e-mail.',
    validationNameFormat: 'Meno a priezvisko môžu obsahovať iba písmená, medzery, bodku, pomlčku alebo apostrof a môžu mať najviac 60 znakov.',
    validationPhoneFormat: 'Telefón zadaj v medzinárodnom tvare, napríklad +421900123456.',
    validationNoteLength: 'Poznámka k registračnej skupine môže mať najviac 120 znakov.',
    validationGroup: 'Vyber registračnú skupinu alebo možnosť Iné.',
    validationOther: 'Doplň, pod koho patríš.',
    validationPrivacy: 'Potvrď oboznámenie s pravidlami ochrany osobných údajov.'
  },
  EN: {
    badge: 'Meal registration',
    title: 'POHODA 2026',
    subtitle: 'Fill in your details. We will send you a confirmation e-mail after registration.',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'E-mail',
    phone: 'Phone',
    foodType: 'Meal type',
    registrationGroup: 'Registration group',
    groupPlaceholder: 'Start typing the group name...',
    noGroup: 'No group found',
    other: 'Other',
    otherPlaceholder: 'Tell us who you belong under',
    clearGroup: 'Clear group selection',
    privacyText: 'I acknowledge the processing of my personal data to the extent necessary for registration, meal administration, QR/NFC identifier assignment, meal selection records, meal entitlements and meal issue records in the PohodaPass system. I confirm that I have read the',
    privacyLink: 'Personal data protection rules',
    submit: 'Register',
    loading: 'Processing...',
    createdTitle: 'Registration received',
    createdLine1: 'We sent a confirmation link to your e-mail.',
    createdLine2: 'After e-mail confirmation, the personnel team will review your registration. Your QR code will be sent after approval.',
    pendingTitle: 'Registration is already waiting for confirmation',
    pendingLine1: 'A confirmation link has already been sent to this e-mail.',
    pendingLine2: 'Please also check your spam folder.',
    existsTitle: 'You are already registered',
    existsLine1: 'This e-mail already has a confirmed registration.',
    existsQr: 'We sent the QR code again.',
    existsPending: 'The registration is still waiting for personnel review.',
    errorEmail: 'Registration was saved, but the e-mail could not be sent: ',
    validationFirstName: 'Enter first name.',
    validationLastName: 'Enter last name.',
    validationEmail: 'Enter e-mail.',
    validationEmailFormat: 'Enter a valid e-mail.',
    validationNameFormat: 'First name and last name may contain only letters, spaces, a dot, hyphen or apostrophe and may have at most 60 characters.',
    validationPhoneFormat: 'Enter the phone number in international format, for example +421900123456.',
    validationNoteLength: 'Registration group note may have at most 120 characters.',
    validationGroup: 'Choose a registration group or Other.',
    validationOther: 'Fill in who you belong under.',
    validationPrivacy: 'Confirm that you have read the personal data protection rules.'
  }
}

export default function RegisterClient({ language = 'SK' }: { language?: AppLanguage }) {
  const copy = registerCopy[language]
  const [registrationGroups, setRegistrationGroups] = useState<RegistrationGroup[]>([])
  const [registrationGroupId, setRegistrationGroupId] = useState('')
  const [registrationGroupNote, setRegistrationGroupNote] = useState('')
  const [registrationGroupSearch, setRegistrationGroupSearch] = useState('')
  const [registrationGroupOpen, setRegistrationGroupOpen] = useState(false)
  const [meno, setMeno] = useState('')
  const [priezvisko, setPriezvisko] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [typStravy, setTypStravy] = useState('MASO')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [result, setResult] = useState<RegisterResult | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/registration-groups')
      .then(response => response.json())
      .then(json => setRegistrationGroups(json.groups || []))
      .catch(() => setRegistrationGroups([]))
  }, [])

  const filteredRegistrationGroups = useMemo(() => {
    const query = normalizeSearch(registrationGroupSearch)

    if (!query) return registrationGroups

    return registrationGroups.filter(group => normalizeSearch(group.name).includes(query))
  }, [registrationGroups, registrationGroupSearch])

  const selectedRegistrationGroupName = useMemo(() => {
    if (registrationGroupId === 'OTHER') return copy.other

    return registrationGroups.find(group => group.id === registrationGroupId)?.name || ''
  }, [copy.other, registrationGroups, registrationGroupId])

  const clearForm = () => {
    setMeno('')
    setPriezvisko('')
    setEmail('')
    setTelefon('')
    setTypStravy('MASO')
    setRegistrationGroupId('')
    setRegistrationGroupNote('')
    setRegistrationGroupSearch('')
    setRegistrationGroupOpen(false)
    setPrivacyAccepted(false)
  }

  const sendConfirmationEmail = async (emailAddress: string, token: string) => {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailAddress, token, language })
    })

    const json = await response.json()
    if (!response.ok || json.error) throw new Error(JSON.stringify(json))
  }

  const sendQrEmail = async (emailAddress: string, qrCode: string) => {
    const response = await fetch('/api/send-qr-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailAddress, qrCode })
    })

    const json = await response.json()
    if (!response.ok || json.error) throw new Error(JSON.stringify(json))
  }

  const handleSubmit = async () => {
    const cleanFirstName = cleanName(meno)
    const cleanLastName = cleanName(priezvisko)
    const cleanEmail = email.trim().toLowerCase()
    const cleanPhone = normalizePhone(telefon)
    const cleanRegistrationGroupNote = registrationGroupNote.trim().replace(/\s+/g, ' ')

    if (!cleanFirstName) return alert(copy.validationFirstName)
    if (!cleanLastName) return alert(copy.validationLastName)
    if (!isValidName(cleanFirstName) || !isValidName(cleanLastName)) return alert(copy.validationNameFormat)
    if (!cleanEmail) return alert(copy.validationEmail)
    if (!isValidEmail(cleanEmail)) return alert(copy.validationEmailFormat)
    if (telefon.trim() && !cleanPhone) return alert(copy.validationPhoneFormat)
    if (!registrationGroupId) return alert(copy.validationGroup)
    if (registrationGroupId === 'OTHER' && !cleanRegistrationGroupNote) return alert(copy.validationOther)
    if (cleanRegistrationGroupNote.length > REGISTRATION_NOTE_MAX_LENGTH) return alert(copy.validationNoteLength)
    if (!privacyAccepted) return alert(copy.validationPrivacy)

    setLoading(true)

    try {
      const ipRes = await fetch('https://api.ipify.org?format=json')
      const ipData = await ipRes.json()

      const { data, error } = await supabase.rpc('create_registration', {
        p_meno: cleanFirstName,
        p_priezvisko: cleanLastName,
        p_email: cleanEmail,
        p_telefon: cleanPhone,
        p_typ_stravy: typStravy,
        p_skupina: null,
        p_registration_group_id: registrationGroupId === 'OTHER' ? null : registrationGroupId,
        p_registration_group_note: registrationGroupId === 'OTHER' ? cleanRegistrationGroupNote : null,
        p_zdroj: 'WEBAPP',
        p_ip: ipData.ip
      })

      if (error) {
        alert(error.message)
        return
      }

      const reg = data[0]

      if (reg.result_type === 'CREATED') {
        await sendConfirmationEmail(reg.email, reg.confirmation_token)
      }

      if (reg.result_type === 'USER_ALREADY_EXISTS' && reg.qr_code) {
        await sendQrEmail(reg.email, reg.qr_code)
      }

      setResult(reg)
      clearForm()
    } catch (err: any) {
      alert(copy.errorEmail + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="register-page" style={styles.page}>
      <style>
        {`
          .register-page button,
          .register-page a[href] {
            touch-action: manipulation;
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease, background 120ms ease;
            -webkit-tap-highlight-color: rgba(86, 219, 63, 0.22);
          }

          .register-page button:not(:disabled):active,
          .register-page a[href]:active {
            transform: translate(2px, 2px) scale(0.98);
            filter: brightness(0.94);
            box-shadow: 2px 2px 0 #000 !important;
          }

          @media (max-width: 520px) {
            .register-page {
              padding: 12px !important;
            }

            .register-top-bar {
              margin-bottom: 10px !important;
              gap: 8px !important;
              align-items: flex-start !important;
            }

            .register-logo {
              height: 38px !important;
              max-width: 172px !important;
            }

            .register-logo-group {
              gap: 0 !important;
            }

            .register-date {
              display: none !important;
            }

            .register-card {
              padding: 16px !important;
              border-radius: 20px !important;
              border-width: 3px !important;
              box-shadow: 6px 6px 0 #000 !important;
            }

            .register-badge {
              margin-bottom: 10px !important;
              padding: 6px 11px !important;
              border-width: 2px !important;
              font-size: 12px !important;
            }

            .register-title {
              font-size: 30px !important;
              line-height: 0.95 !important;
            }

            .register-subtitle {
              margin: 9px 0 14px !important;
              font-size: 13px !important;
              line-height: 1.28 !important;
            }

            .register-grid {
              gap: 9px !important;
            }

            .register-input {
              border-width: 2px !important;
              border-radius: 13px !important;
              padding: 11px 12px !important;
              font-size: 14px !important;
            }

            .register-group-label {
              font-size: 12px !important;
            }

            .register-group-list {
              max-height: 178px !important;
              border-width: 2px !important;
              border-radius: 14px !important;
              box-shadow: 4px 4px 0 #000 !important;
            }

            .register-group-option,
            .register-group-empty {
              font-size: 14px !important;
              padding: 9px 10px !important;
            }

            .register-privacy {
              margin-top: 12px !important;
              padding: 11px !important;
              border-width: 2px !important;
              border-radius: 14px !important;
              font-size: 12px !important;
              line-height: 1.3 !important;
            }

            .register-button {
              margin-top: 13px !important;
              padding: 12px 14px !important;
              font-size: 15px !important;
              border-width: 2px !important;
            }

            .register-success,
            .register-notice {
              margin-top: 12px !important;
              padding: 12px !important;
              border-radius: 15px !important;
              border-width: 2px !important;
              font-size: 13px !important;
            }

            .register-message-title {
              font-size: 18px !important;
            }
          }
        `}
      </style>

      <div className="register-top-bar" style={styles.topBar}>
        <div className="register-logo-group" style={styles.logoGroup}>
          <a href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            <img className="register-logo" src="/pohoda-30.svg" alt="Pohoda 30" style={styles.topLogo} />
          </a>
          <div className="register-date" style={styles.date}>8. & 9. - 11. 7. 2026</div>
        </div>

        <div style={styles.topControls}>
          <LanguageSwitcher language={language} compact />
        </div>
      </div>

      <section className="register-card" style={styles.card}>
        <div className="register-badge" style={styles.badge}>{copy.badge}</div>

        <h1 className="register-title" style={styles.title}>{copy.title}</h1>

        <p className="register-subtitle" style={styles.subtitle}>
          {copy.subtitle}
        </p>

        <div className="register-grid" style={styles.grid}>
          <input
            className="register-input"
            style={styles.input}
            placeholder={copy.firstName}
            value={meno}
            onChange={e => setMeno(e.target.value.slice(0, NAME_MAX_LENGTH))}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="given-name"
          />
          <input
            className="register-input"
            style={styles.input}
            placeholder={copy.lastName}
            value={priezvisko}
            onChange={e => setPriezvisko(e.target.value.slice(0, NAME_MAX_LENGTH))}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="family-name"
          />
          <input
            className="register-input"
            style={styles.input}
            placeholder={copy.email}
            value={email}
            onChange={e => setEmail(e.target.value.slice(0, EMAIL_MAX_LENGTH))}
            type="email"
            maxLength={EMAIL_MAX_LENGTH}
            autoComplete="email"
          />
          <input
            className="register-input"
            style={styles.input}
            placeholder={`${copy.phone} (+421...)`}
            value={telefon}
            onChange={e => setTelefon(e.target.value.slice(0, PHONE_MAX_LENGTH))}
            type="tel"
            inputMode="tel"
            maxLength={PHONE_MAX_LENGTH}
            autoComplete="tel"
          />

          <select className="register-input" style={styles.input} value={typStravy} onChange={e => setTypStravy(e.target.value)} aria-label={copy.foodType}>
            <option value="MASO">MASO</option>
            <option value="VEGE">VEGE</option>
          </select>

          <div style={styles.groupField}>
            <span className="register-group-label" style={styles.groupLabel}>{copy.registrationGroup}</span>

            <div style={styles.groupPicker}>
              <input
                className="register-input"
                style={{
                  ...styles.input,
                  paddingRight: selectedRegistrationGroupName && !registrationGroupOpen ? 52 : 17
                }}
                placeholder={copy.groupPlaceholder}
                value={registrationGroupOpen ? registrationGroupSearch : selectedRegistrationGroupName}
                onFocus={() => {
                  setRegistrationGroupSearch('')
                  setRegistrationGroupOpen(true)
                }}
                onBlur={() => setTimeout(() => setRegistrationGroupOpen(false), 120)}
                onChange={e => {
                  setRegistrationGroupSearch(e.target.value)
                  setRegistrationGroupId('')
                  setRegistrationGroupNote('')
                  setRegistrationGroupOpen(true)
                }}
              />

              {selectedRegistrationGroupName && !registrationGroupOpen && (
                <button
                  type="button"
                  style={styles.groupClearButton}
                  aria-label={copy.clearGroup}
                  title={copy.clearGroup}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    setRegistrationGroupId('')
                    setRegistrationGroupNote('')
                    setRegistrationGroupSearch('')
                  }}
                >
                  ×
                </button>
              )}

              {registrationGroupOpen && (
                <div className="register-group-list" style={styles.groupList}>
                  {filteredRegistrationGroups.length === 0 && (
                    <div className="register-group-empty" style={styles.groupEmpty}>
                      {copy.noGroup}
                    </div>
                  )}

                  {filteredRegistrationGroups.map(group => (
                    <button
                      className="register-group-option"
                      key={group.id}
                      type="button"
                      style={styles.groupOption}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => {
                        setRegistrationGroupId(group.id)
                        setRegistrationGroupSearch('')
                        setRegistrationGroupNote('')
                        setRegistrationGroupOpen(false)
                      }}
                    >
                      {group.name}
                    </button>
                  ))}

                  <button
                    className="register-group-option"
                    type="button"
                    style={styles.groupOption}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setRegistrationGroupId('OTHER')
                      setRegistrationGroupSearch('')
                      setRegistrationGroupOpen(false)
                    }}
                  >
                    {copy.other}
                  </button>
                </div>
              )}
            </div>
          </div>

          {registrationGroupId === 'OTHER' && (
            <input
              className="register-input"
              style={styles.input}
              placeholder={copy.otherPlaceholder}
              value={registrationGroupNote}
              onChange={e => setRegistrationGroupNote(e.target.value.slice(0, REGISTRATION_NOTE_MAX_LENGTH))}
              maxLength={REGISTRATION_NOTE_MAX_LENGTH}
            />
          )}
        </div>

        <label className="register-privacy" style={styles.privacyBox}>
          <input
            type="checkbox"
            checked={privacyAccepted}
            onChange={event => setPrivacyAccepted(event.target.checked)}
            style={styles.privacyCheckbox}
          />
          <span>
            {copy.privacyText}{' '}
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
              style={styles.privacyLink}
            >
              {copy.privacyLink}
            </a>
          </span>
        </label>

        <button
          className="register-button"
          style={{
            ...styles.button,
            opacity: loading || !privacyAccepted ? 0.65 : 1,
            cursor: loading || !privacyAccepted ? 'not-allowed' : 'pointer'
          }}
          onClick={handleSubmit}
          disabled={loading || !privacyAccepted}
        >
          {loading ? copy.loading : copy.submit}
        </button>

        {result?.result_type === 'CREATED' && (
          <div className="register-success" style={styles.success}>
            <h2 className="register-message-title" style={styles.messageTitle}>{copy.createdTitle}</h2>
            <p>{copy.createdLine1} <b>{result.email}</b></p>
            <p>{copy.createdLine2}</p>
          </div>
        )}

        {result?.result_type === 'PENDING_ALREADY_EXISTS' && (
          <div className="register-notice" style={styles.notice}>
            <h2 className="register-message-title" style={styles.messageTitle}>{copy.pendingTitle}</h2>
            <p>{copy.pendingLine1} <b>{result.email}</b></p>
            <p>{copy.pendingLine2}</p>
          </div>
        )}

        {result?.result_type === 'USER_ALREADY_EXISTS' && (
          <div className="register-success" style={styles.success}>
            <h2 className="register-message-title" style={styles.messageTitle}>{copy.existsTitle}</h2>
            <p>{copy.existsLine1} <b>{result.email}</b></p>
            <p>{result.qr_code ? copy.existsQr : copy.existsPending}</p>
          </div>
        )}
      </section>
    </main>
  )
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function isValidName(value: string) {
  if (value.length < 2 || value.length > NAME_MAX_LENGTH) return false
  if (!/\p{L}/u.test(value)) return false

  return /^[\p{L}\p{M} .'-]+$/u.test(value)
}

function isValidEmail(value: string) {
  if (value.length > EMAIL_MAX_LENGTH) return false

  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

function normalizePhone(value: string) {
  const text = value.trim()
  if (!text) return ''

  const compact = text.replace(/[\s().-]/g, '')

  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return ''

  return compact
}

const styles: Record<string, CSSProperties> = {
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
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0
  },
  topControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10
  },
  topLogo: {
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
    margin: '12px 0 28px',
    fontSize: 19,
    lineHeight: 1.45,
    fontWeight: 700
  },
  grid: {
    display: 'grid',
    gap: 14
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 18,
    padding: '15px 17px',
    fontSize: 17,
    outline: 'none',
    background: '#fff',
    color: '#000',
    fontWeight: 700
  },
  groupPicker: {
    position: 'relative',
    display: 'grid',
    zIndex: 2
  },
  groupField: {
    display: 'grid',
    gap: 7
  },
  groupLabel: {
    paddingLeft: 3,
    fontSize: 14,
    fontWeight: 900
  },
  groupList: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    width: '100%',
    maxHeight: 190,
    overflowY: 'auto',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 5,
    background: '#fff',
    boxShadow: '6px 6px 0 #000'
  },
  groupOption: {
    width: '100%',
    border: 0,
    borderRadius: 12,
    padding: '10px 12px',
    background: '#fff',
    color: '#000',
    textAlign: 'left',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer'
  },
  groupEmpty: {
    padding: '10px 12px',
    color: '#6b7280',
    fontSize: 15,
    fontWeight: 700
  },
  groupClearButton: {
    position: 'absolute',
    top: '50%',
    right: 10,
    width: 32,
    height: 32,
    transform: 'translateY(-50%)',
    border: '2px solid #000',
    borderRadius: 999,
    background: '#fff',
    color: '#000',
    fontSize: 22,
    fontWeight: 900,
    lineHeight: 1,
    cursor: 'pointer'
  },
  privacyBox: {
    marginTop: 16,
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    gap: 10,
    alignItems: 'start',
    background: '#f6f2ff',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 750
  },
  privacyCheckbox: {
    width: 20,
    height: 20,
    margin: 0,
    accentColor: '#7417e8'
  },
  privacyLink: {
    color: '#7417e8',
    fontWeight: 950
  },
  button: {
    width: '100%',
    marginTop: 22,
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '16px 22px',
    fontSize: 19,
    fontWeight: 900
  },
  success: {
    marginTop: 24,
    padding: 18,
    borderRadius: 20,
    background: '#56db3f',
    border: '3px solid #000',
    fontWeight: 700
  },
  notice: {
    marginTop: 24,
    padding: 18,
    borderRadius: 20,
    background: '#f25be6',
    border: '3px solid #000',
    fontWeight: 700
  },
  messageTitle: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 900
  }
}
