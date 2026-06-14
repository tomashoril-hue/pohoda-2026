'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { PRIVACY_CONSENT_TEXT, PRIVACY_POLICY_URL } from '@/lib/privacyConsentConfig'

export default function RegisterPage() {
  const [registrationGroups, setRegistrationGroups] = useState<{ id: string; name: string }[]>([])
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
  const [result, setResult] = useState<any>(null)
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
    if (registrationGroupId === 'OTHER') return 'Iné'

    return registrationGroups.find(group => group.id === registrationGroupId)?.name || ''
  }, [registrationGroups, registrationGroupId])

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

  const sendConfirmationEmail = async (email: string, token: string) => {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token })
    })

    const json = await response.json()
    if (!response.ok || json.error) throw new Error(JSON.stringify(json))
  }

  const sendQrEmail = async (email: string, qrCode: string) => {
    const response = await fetch('/api/send-qr-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, qrCode })
    })

    const json = await response.json()
    if (!response.ok || json.error) throw new Error(JSON.stringify(json))
  }

  const handleSubmit = async () => {
    if (!meno.trim()) return alert('Zadaj meno')
    if (!priezvisko.trim()) return alert('Zadaj priezvisko')
    if (!email.trim()) return alert('Zadaj email')
    if (!registrationGroupId) return alert('Vyber registračnú skupinu alebo možnosť Iné')
    if (registrationGroupId === 'OTHER' && !registrationGroupNote.trim()) return alert('Doplň, pod koho patríš')
    if (!privacyAccepted) return alert('Potvrď oboznámenie s pravidlami ochrany osobných údajov.')

    setLoading(true)

    try {
      const ipRes = await fetch('https://api.ipify.org?format=json')
      const ipData = await ipRes.json()

      const { data, error } = await supabase.rpc('create_registration', {
        p_meno: meno.trim(),
        p_priezvisko: priezvisko.trim(),
        p_email: email.trim(),
        p_telefon: telefon.trim(),
        p_typ_stravy: typStravy,
        p_skupina: null,
        p_registration_group_id: registrationGroupId === 'OTHER' ? null : registrationGroupId,
        p_registration_group_note: registrationGroupId === 'OTHER' ? registrationGroupNote.trim() : null,
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
      alert('Registrácia prebehla, ale e-mail sa nepodarilo odoslať: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <a href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
          <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.topLogo} />
        </a>
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Registrácia stravy</div>

        <h1 style={styles.title}>POHODA 2026</h1>

        <p style={styles.subtitle}>
          Vyplňte údaje. Po registrácii vám príde potvrdzovací e-mail.
        </p>

        <div style={styles.grid}>
          <input style={styles.input} placeholder="Meno" value={meno} onChange={e => setMeno(e.target.value)} />
          <input style={styles.input} placeholder="Priezvisko" value={priezvisko} onChange={e => setPriezvisko(e.target.value)} />
          <input style={styles.input} placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} />
          <input style={styles.input} placeholder="Telefón" value={telefon} onChange={e => setTelefon(e.target.value)} />

          <select style={styles.input} value={typStravy} onChange={e => setTypStravy(e.target.value)}>
            <option value="MASO">MASO</option>
            <option value="VEGE">VEGE</option>
          </select>

          <div style={styles.groupField}>
            <span style={styles.groupLabel}>Registračná skupina</span>

            <div style={styles.groupPicker}>
              <input
                style={{
                  ...styles.input,
                  paddingRight: selectedRegistrationGroupName && !registrationGroupOpen ? 52 : 17
                }}
                placeholder="Začni písať názov skupiny..."
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
                  aria-label="Zrušiť výber skupiny"
                  title="Zrušiť výber skupiny"
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
                <div style={styles.groupList}>
                  {filteredRegistrationGroups.length === 0 && (
                    <div style={styles.groupEmpty}>
                      Nenašla sa žiadna skupina
                    </div>
                  )}

                  {filteredRegistrationGroups.map(group => (
                    <button
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
                    type="button"
                    style={styles.groupOption}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setRegistrationGroupId('OTHER')
                      setRegistrationGroupSearch('')
                      setRegistrationGroupOpen(false)
                    }}
                  >
                    Iné
                  </button>
                </div>
              )}
            </div>
          </div>

          {registrationGroupId === 'OTHER' && (
            <input
              style={styles.input}
              placeholder="Napíš, pod koho patríš"
              value={registrationGroupNote}
              onChange={e => setRegistrationGroupNote(e.target.value)}
            />
          )}
        </div>

        <label style={styles.privacyBox}>
          <input
            type="checkbox"
            checked={privacyAccepted}
            onChange={event => setPrivacyAccepted(event.target.checked)}
            style={styles.privacyCheckbox}
          />
          <span>
            {PRIVACY_CONSENT_TEXT}{' '}
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
              style={styles.privacyLink}
            >
              Pravidlá ochrany osobných údajov
            </a>
          </span>
        </label>

        <button
          style={{
            ...styles.button,
            opacity: loading || !privacyAccepted ? 0.65 : 1,
            cursor: loading || !privacyAccepted ? 'not-allowed' : 'pointer'
          }}
          onClick={handleSubmit}
          disabled={loading || !privacyAccepted}
        >
          {loading ? 'Spracovávam...' : 'Registrovať'}
        </button>

        {result && result.result_type === 'CREATED' && (
          <div style={styles.success}>
            <h2 style={styles.messageTitle}>Registrácia prijatá</h2>
            <p>Na e-mail <b>{result.email}</b> sme odoslali potvrdzovací link.</p>
            <p>Po potvrdení e-mailu registráciu skontroluje personalista. QR kód vám príde po schválení.</p>
          </div>
        )}

        {result && result.result_type === 'PENDING_ALREADY_EXISTS' && (
          <div style={styles.notice}>
            <h2 style={styles.messageTitle}>Registrácia už čaká na potvrdenie</h2>
            <p>Na e-mail <b>{result.email}</b> už bol odoslaný potvrdzovací link.</p>
            <p>Skontrolujte si spam.</p>
          </div>
        )}

        {result && result.result_type === 'USER_ALREADY_EXISTS' && (
          <div style={styles.success}>
            <h2 style={styles.messageTitle}>Už ste registrovaný</h2>
            <p>E-mail <b>{result.email}</b> už má potvrdenú registráciu.</p>
            <p>{result.qr_code ? 'QR kód sme poslali znova.' : 'Registrácia ešte čaká na kontrolu personalistom.'}</p>
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
    background: '#fff',
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
