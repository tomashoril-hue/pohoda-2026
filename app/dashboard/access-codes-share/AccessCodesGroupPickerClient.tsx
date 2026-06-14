'use client'

import type { CSSProperties } from 'react'
import { useState } from 'react'
import Link from 'next/link'

type GroupOption = {
  id: string
  name: string
}

function groupHref(groupId: string, language: 'SK' | 'EN') {
  const params = new URLSearchParams()
  params.set('registrationGroupId', groupId)
  params.set('language', language)

  return `/dashboard/access-codes-share?${params.toString()}`
}

export default function AccessCodesGroupPickerClient({
  groups,
  language,
  currentUserName,
  currentUserEmail
}: {
  groups: GroupOption[]
  language: 'SK' | 'EN'
  currentUserName: string
  currentUserEmail: string
}) {
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const copy = language === 'EN'
    ? {
        title: 'Access details',
        subtitle: 'Choose a registration group and send prepared login messages by SMS or WhatsApp.',
        select: 'Registration group',
        placeholder: 'Choose registration group',
        open: 'Open',
        signedIn: 'Signed in',
        home: 'Home',
        groups: 'Groups'
      }
    : {
        title: 'Pristupove udaje',
        subtitle: 'Vyber registracnu skupinu a odosli pripravene prihlasovacie spravy cez SMS alebo WhatsApp.',
        select: 'Registracna skupina',
        placeholder: 'Vyber registracnu skupinu',
        open: 'Otvorit',
        signedIn: 'Prihlaseny',
        home: 'Domov',
        groups: 'Skupiny'
      }

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.topBar}>
          <div style={styles.userBox}>
            <span>{copy.signedIn}</span>
            <b>{currentUserName || currentUserEmail || '-'}</b>
          </div>
          <Link href="/dashboard" style={styles.homeButton}>
            {copy.home}
          </Link>
        </div>

        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>{copy.title}</h1>
            <p style={styles.subtitle}>{copy.subtitle}</p>
          </div>
          <div style={styles.countBox}>
            <span>{copy.groups}</span>
            <b>{groups.length}</b>
          </div>
        </header>

        <section style={styles.formBox}>
          <label style={styles.fieldLabel} htmlFor="registration-group-select">
            {copy.select}
          </label>
          <select
            id="registration-group-select"
            value={selectedGroupId}
            onChange={event => setSelectedGroupId(event.target.value)}
            style={styles.select}
          >
            <option value="">{copy.placeholder}</option>
            {groups.map(group => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={!selectedGroupId}
            onClick={() => {
              if (!selectedGroupId) return
              window.location.href = groupHref(selectedGroupId, language)
            }}
            style={{
              ...styles.openButton,
              ...(!selectedGroupId ? styles.openButtonDisabled : {})
            }}
          >
            {copy.open}
          </button>
        </section>
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
    maxWidth: 860,
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
  homeButton: {
    background: '#56db3f',
    color: '#000',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '9px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    boxShadow: '3px 3px 0 #000',
    fontWeight: 950,
    textDecoration: 'none'
  },
  header: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 14,
    boxShadow: '4px 4px 0 #000',
    padding: 12,
    display: 'grid',
    gridTemplateColumns: '1fr auto',
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
  countBox: {
    background: '#000',
    color: '#fff',
    borderRadius: 12,
    padding: '9px 12px',
    display: 'grid',
    gap: 2,
    fontSize: 13,
    textAlign: 'center'
  },
  formBox: {
    background: '#fff',
    border: '2px solid #000',
    borderRadius: 14,
    boxShadow: '4px 4px 0 #000',
    padding: 12,
    display: 'grid',
    gap: 8
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    border: '2px solid #000',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 800,
    outline: 'none',
    background: '#fff'
  },
  openButton: {
    justifySelf: 'start',
    background: '#7417e8',
    color: '#fff',
    border: '2px solid #000',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 950,
    boxShadow: '3px 3px 0 #000',
    cursor: 'pointer'
  },
  openButtonDisabled: {
    background: '#e5e7eb',
    color: '#6b7280',
    borderColor: '#9ca3af',
    boxShadow: 'none',
    cursor: 'not-allowed'
  }
}
