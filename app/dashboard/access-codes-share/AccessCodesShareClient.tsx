'use client'

import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type SharePerson = {
  id: string
  fullName: string
  meno: string
  priezvisko: string
  email: string
  telefon: string
  loginType: 'EMAIL' | 'CODE' | 'NONE'
  loginLabel: string
  accessCode: string
  loginUrl: string
  message: string
}

function cleanPhone(value: string, whatsapp = false) {
  return String(value || '').replace(whatsapp ? /[^\d]/g : /[^\d+]/g, '')
}

function openSms(phone: string, message: string) {
  const normalizedPhone = cleanPhone(phone)
  const isApple = /iPad|iPhone|iPod/i.test(navigator.userAgent)
  const separator = isApple ? '&' : '?'

  window.location.href = `sms:${normalizedPhone}${separator}body=${encodeURIComponent(message)}`
}

function openWhatsapp(phone: string, message: string) {
  const url = `https://wa.me/${cleanPhone(phone, true)}?text=${encodeURIComponent(message)}`

  window.open(url, '_blank', 'noopener,noreferrer')
}

function openedStorageKey() {
  return `pohoda-access-codes-opened:${window.location.pathname}${window.location.search}`
}

function isReloadNavigation() {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined

  return navigation?.type === 'reload'
}

export default function AccessCodesShareClient({
  groupName,
  language,
  currentUserName,
  currentUserEmail,
  people
}: {
  groupName: string
  language: 'SK' | 'EN'
  currentUserName: string
  currentUserEmail: string
  people: SharePerson[]
}) {
  const [search, setSearch] = useState('')
  const [openedPersonIds, setOpenedPersonIds] = useState<Set<string>>(() => new Set())
  const [pressedAction, setPressedAction] = useState('')
  const q = search.trim().toLowerCase()
  const filteredPeople = useMemo(() => {
    if (!q) return people

    return people.filter(person => (
      person.fullName.toLowerCase().includes(q) ||
      person.email.toLowerCase().includes(q) ||
      person.telefon.toLowerCase().includes(q)
    ))
  }, [people, q])
  const copy = language === 'EN'
    ? {
        badge: 'Login details',
        title: 'Send access codes',
        subtitle: 'Choose a person and send their prepared login message by SMS or WhatsApp.',
        search: 'Search name, phone or email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        noPhone: 'No phone number',
        noCode: 'No login details',
        login: 'Login',
        empty: 'No matching people found.',
        home: 'Home',
        signedIn: 'Signed in'
      }
    : {
        badge: 'Prihlasovacie udaje',
        title: 'Odoslat pristupove kody',
        subtitle: 'Vyber osobu a odosli jej pripravenu prihlasovaciu spravu cez SMS alebo WhatsApp.',
        search: 'Hladat meno, telefon alebo email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        noPhone: 'Bez telefonu',
        noCode: 'Bez prihlasenia',
        login: 'Prihlasenie',
        empty: 'Nenasli sa ziadne osoby.',
        home: 'Domov',
        signedIn: 'Prihlaseny'
      }

  useEffect(() => {
    const key = openedStorageKey()

    if (isReloadNavigation()) {
      sessionStorage.removeItem(key)
      setOpenedPersonIds(new Set())
      return
    }

    try {
      const storedIds = JSON.parse(sessionStorage.getItem(key) || '[]')

      if (Array.isArray(storedIds)) {
        setOpenedPersonIds(new Set(storedIds.filter(id => typeof id === 'string')))
      }
    } catch {
      sessionStorage.removeItem(key)
    }
  }, [])

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.topBar}>
          <div style={styles.userBox}>
            <span>{copy.signedIn}</span>
            <b>{currentUserName || currentUserEmail || '-'}</b>
          </div>
          <Link href="/dashboard" style={styles.homeButton}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={styles.homeIcon}>
              <path
                d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5v-9Z"
                fill="currentColor"
              />
            </svg>
            {copy.home}
          </Link>
        </div>

        <header style={styles.header}>
          <div>
            <div style={styles.badge}>{copy.badge}</div>
            <h1 style={styles.title}>{copy.title}</h1>
            <p style={styles.subtitle}>{copy.subtitle}</p>
          </div>
          <div style={styles.groupBox}>
            <span>Skupina</span>
            <b>{groupName}</b>
          </div>
        </header>

        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={copy.search}
          style={styles.search}
        />

        <div style={styles.list}>
          {filteredPeople.length === 0 && (
            <div style={styles.empty}>{copy.empty}</div>
          )}

          {filteredPeople.map(person => {
            const disabled = !person.telefon || !person.loginUrl
            const opened = openedPersonIds.has(person.id)
            const markOpened = (action: 'sms' | 'whatsapp') => {
              const actionKey = `${person.id}:${action}`

              setOpenedPersonIds(previous => {
                const next = new Set(previous)
                next.add(person.id)

                try {
                  sessionStorage.setItem(openedStorageKey(), JSON.stringify(Array.from(next)))
                } catch {
                  // Visual helper only. If storage is unavailable, in-memory state is enough.
                }

                return next
              })
              setPressedAction(actionKey)
              window.setTimeout(() => setPressedAction(current => current === actionKey ? '' : current), 900)
            }

            return (
              <article
                key={person.id}
                style={{
                  ...styles.personRow,
                  ...(opened ? styles.personRowOpened : {})
                }}
              >
                <div style={styles.personMain}>
                  <b>{person.fullName}</b>
                  <span>{person.telefon || copy.noPhone}</span>
                  <small>{person.email || '-'}</small>
                </div>

                <div style={styles.codeBox}>
                  <span>{copy.login}</span>
                  <b>{person.loginLabel}</b>
                  {person.loginType === 'CODE' && <small>{person.accessCode}</small>}
                </div>

                <div style={styles.actions}>
                  {disabled ? (
                    <span style={styles.disabledNote}>{!person.telefon ? copy.noPhone : copy.noCode}</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          markOpened('sms')
                          window.setTimeout(() => openSms(person.telefon, person.message), 140)
                        }}
                        style={{
                          ...styles.smsButton,
                          ...(pressedAction === `${person.id}:sms` ? styles.actionButtonPressed : {})
                        }}
                      >
                        {copy.sms}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          markOpened('whatsapp')
                          window.setTimeout(() => openWhatsapp(person.telefon, person.message), 140)
                        }}
                        style={{
                          ...styles.whatsappButton,
                          ...(pressedAction === `${person.id}:whatsapp` ? styles.actionButtonPressed : {})
                        }}
                      >
                        {copy.whatsapp}
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f6f2ff',
    color: '#000',
    fontFamily: 'Arial, Helvetica, sans-serif',
    padding: 16
  },
  shell: {
    maxWidth: 980,
    margin: '0 auto',
    display: 'grid',
    gap: 14
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  userBox: {
    minWidth: 0,
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '8px 13px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    boxShadow: '3px 3px 0 #000',
    fontSize: 13
  },
  homeButton: {
    background: '#56db3f',
    color: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '9px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    boxShadow: '3px 3px 0 #000',
    fontWeight: 950,
    textDecoration: 'none'
  },
  homeIcon: {
    display: 'block'
  },
  header: {
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 20,
    boxShadow: '8px 8px 0 #000',
    padding: 18,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 14,
    alignItems: 'center'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '6px 12px',
    fontWeight: 950,
    marginBottom: 10
  },
  title: {
    margin: 0,
    fontSize: 34,
    lineHeight: 1.05,
    fontWeight: 950
  },
  subtitle: {
    margin: '8px 0 0',
    fontSize: 15,
    lineHeight: 1.35,
    fontWeight: 750
  },
  groupBox: {
    minWidth: 170,
    background: '#000',
    color: '#fff',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 3
  },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    border: '3px solid #000',
    borderRadius: 16,
    padding: '13px 15px',
    fontSize: 16,
    fontWeight: 800,
    outline: 'none'
  },
  list: {
    display: 'grid',
    gap: 10
  },
  personRow: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
    alignItems: 'center',
    transition: 'background 140ms ease, border-color 140ms ease, box-shadow 140ms ease'
  },
  personRowOpened: {
    background: '#f5efff',
    borderColor: '#c8b5f6',
    boxShadow: 'inset 5px 0 0 #d7c5ff'
  },
  personMain: {
    minWidth: 0,
    display: 'grid',
    gap: 3
  },
  codeBox: {
    background: '#f6f2ff',
    border: '2px solid #000',
    borderRadius: 12,
    padding: 8,
    textAlign: 'center',
    display: 'grid',
    gap: 2
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8
  },
  smsButton: {
    background: '#7417e8',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '11px 12px',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'pointer',
    fontSize: 14
  },
  whatsappButton: {
    background: '#16a34a',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '11px 12px',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'pointer',
    fontSize: 14
  },
  actionButtonPressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: 'inset 0 0 0 999px rgba(255, 255, 255, 0.22)'
  },
  disabledNote: {
    gridColumn: '1 / -1',
    background: '#fee2e2',
    color: '#991b1b',
    border: '2px solid #fecaca',
    borderRadius: 12,
    padding: 10,
    fontWeight: 900,
    textAlign: 'center'
  },
  empty: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 16,
    padding: 18,
    fontWeight: 900,
    textAlign: 'center'
  }
}
