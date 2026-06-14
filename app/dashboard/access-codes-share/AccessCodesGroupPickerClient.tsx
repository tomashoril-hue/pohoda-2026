'use client'

import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
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
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const filteredGroups = useMemo(() => {
    if (!q) return groups

    return groups.filter(group => group.name.toLowerCase().includes(q))
  }, [groups, q])
  const copy = language === 'EN'
    ? {
        title: 'Access details',
        subtitle: 'Choose a registration group and send prepared login messages by SMS or WhatsApp.',
        search: 'Search registration group',
        empty: 'No matching registration group found.',
        open: 'Open',
        signedIn: 'Signed in',
        home: 'Home',
        groups: 'Groups'
      }
    : {
        title: 'Pristupove udaje',
        subtitle: 'Vyber registracnu skupinu a odosli pripravene prihlasovacie spravy cez SMS alebo WhatsApp.',
        search: 'Hladat registracnu skupinu',
        empty: 'Nenasla sa ziadna registracna skupina.',
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

        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder={copy.search}
          style={styles.search}
        />

        <div style={styles.list}>
          {filteredGroups.length === 0 && (
            <div style={styles.empty}>{copy.empty}</div>
          )}

          {filteredGroups.map(group => (
            <Link
              key={group.id}
              href={groupHref(group.id, language)}
              style={styles.groupRow}
            >
              <b>{group.name}</b>
              <span>{copy.open}</span>
            </Link>
          ))}
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
  groupRow: {
    background: '#fff',
    color: '#000',
    border: '2px solid #000',
    borderRadius: 12,
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    textDecoration: 'none',
    boxShadow: '3px 3px 0 #000',
    fontSize: 14,
    fontWeight: 900
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
