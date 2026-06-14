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
        title: 'Send access codes',
        subtitle: 'Choose a person and send their prepared login message by SMS or WhatsApp.',
        search: 'Search name, phone or email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        noPhone: 'No phone number',
        empty: 'No matching people found.',
        back: 'Back',
        home: 'Home',
        signedIn: 'Signed in',
        group: 'Registration group'
      }
    : {
        title: 'Odoslat pristupove kody',
        subtitle: 'Vyber osobu a odosli jej pripravenu prihlasovaciu spravu cez SMS alebo WhatsApp.',
        search: 'Hladat meno, telefon alebo email',
        sms: 'SMS',
        whatsapp: 'WhatsApp',
        noPhone: 'Bez telefonu',
        empty: 'Nenasli sa ziadne osoby.',
        back: 'Spat',
        home: 'Domov',
        signedIn: 'Prihlaseny',
        group: 'Skupina'
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

  const goBack = () => {
    setPressedAction('back')

    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.href = '/dashboard'
  }

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.topBar}>
          <div style={styles.userBox}>
            <span>{copy.signedIn}</span>
            <b>{currentUserName || currentUserEmail || '-'}</b>
          </div>
          <div style={styles.topActions}>
            <button
              type="button"
              style={{
                ...styles.backButton,
                ...(pressedAction === 'back' ? styles.backButtonPressed : {})
              }}
              onPointerDown={() => setPressedAction('back')}
              onPointerUp={() => window.setTimeout(() => setPressedAction(''), 180)}
              onPointerLeave={() => setPressedAction('')}
              onClick={goBack}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={styles.homeIcon}>
                <path
                  d="M10.8 5.2a1 1 0 0 1 0 1.4L6.4 11H20a1 1 0 1 1 0 2H6.4l4.4 4.4a1 1 0 1 1-1.4 1.4l-6.1-6.1a1 1 0 0 1 0-1.4l6.1-6.1a1 1 0 0 1 1.4 0Z"
                  fill="currentColor"
                />
              </svg>
              {copy.back}
            </button>
            <Link
              href="/dashboard"
              style={{
                ...styles.homeButton,
                ...(pressedAction === 'home' ? styles.homeButtonPressed : {})
              }}
              onPointerDown={() => setPressedAction('home')}
              onClick={() => setPressedAction('home')}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={styles.homeIcon}>
                <path
                  d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5v-9Z"
                  fill="currentColor"
                />
              </svg>
              {copy.home}
            </Link>
          </div>
        </div>

        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>{copy.title}</h1>
            <p style={styles.subtitle}>{copy.subtitle}</p>
          </div>
          <div style={styles.groupBox}>
            <span>{copy.group}</span>
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
                  <b>
                    {person.loginType === 'CODE'
                      ? `${person.loginLabel} ${person.accessCode}`
                      : person.loginLabel}
                  </b>
                </div>

                <div style={styles.actions}>
                  {disabled ? (
                    <>
                      <button type="button" disabled style={styles.disabledActionButton}>
                        {copy.sms}
                      </button>
                      <button type="button" disabled style={styles.disabledActionButton}>
                        {copy.whatsapp}
                      </button>
                    </>
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
    gap: 10
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
  topActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'
  },
  backButton: {
    background: '#fff',
    color: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '9px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    boxShadow: '3px 3px 0 #000',
    fontWeight: 950,
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease'
  },
  backButtonPressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: '1px 1px 0 #000',
    background: '#f6f2ff'
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
    textDecoration: 'none',
    transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease'
  },
  homeButtonPressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: '1px 1px 0 #000',
    background: '#45c832'
  },
  homeIcon: {
    display: 'block'
  },
  header: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 14,
    boxShadow: '4px 4px 0 #000',
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: 24,
    lineHeight: 1.05,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0',
    fontSize: 13,
    lineHeight: 1.35,
    fontWeight: 700
  },
  groupBox: {
    minWidth: 150,
    background: '#000',
    color: '#fff',
    borderRadius: 12,
    padding: 10,
    display: 'grid',
    gap: 2,
    fontSize: 13
  },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    border: '2px solid #000',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 800,
    outline: 'none'
  },
  list: {
    display: 'grid',
    gap: 7
  },
  personRow: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 12,
    padding: 8,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
    gap: 8,
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
    gap: 1,
    fontSize: 13
  },
  codeBox: {
    background: '#f6f2ff',
    border: '1px solid #c8b5f6',
    borderRadius: 999,
    padding: '6px 9px',
    textAlign: 'center',
    display: 'grid',
    gap: 1,
    fontSize: 12,
    fontWeight: 850
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6
  },
  smsButton: {
    background: '#7417e8',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '8px 10px',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'pointer',
    fontSize: 13
  },
  whatsappButton: {
    background: '#16a34a',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '8px 10px',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'pointer',
    fontSize: 13
  },
  actionButtonPressed: {
    transform: 'translate(2px, 2px)',
    boxShadow: 'inset 0 0 0 999px rgba(255, 255, 255, 0.22)'
  },
  disabledActionButton: {
    background: '#e5e7eb',
    color: '#6b7280',
    border: '2px solid #9ca3af',
    borderRadius: 999,
    padding: '8px 10px',
    fontWeight: 950,
    textAlign: 'center',
    cursor: 'not-allowed',
    fontSize: 13
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
