import Link from 'next/link'
import type { CSSProperties } from 'react'

export default function OfflinePage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.kicker}>OFFLINE REŽIM</div>
        <h1 style={styles.title}>Aplikácia je bez internetu</h1>
        <p style={styles.text}>
          Ak bolo toto zariadenie predtým pripravené, otvor hlavný Výdaj stravy. Výdaj bude používať posledné uložené
          offline dáta a po návrate internetu sa udalosti zosynchronizujú.
        </p>
        <div style={styles.notice}>
          Ak sa stránka výdaja ešte nikdy nenačítala online alebo v zariadení nie sú offline dáta, najprv sa pripoj na internet.
        </div>
        <div style={styles.actions}>
          <Link href="/dashboard/vydaj-stravy" style={styles.button}>
            Otvoriť výdaj stravy
          </Link>
          <Link href="/dashboard" style={styles.secondaryButton}>
            Dashboard
          </Link>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#7417e8',
    color: '#111827',
    display: 'grid',
    placeItems: 'center',
    padding: 18,
    fontFamily: 'Arial, Helvetica, sans-serif'
  },
  card: {
    width: 'min(100%, 520px)',
    border: '2px solid #000',
    borderRadius: 22,
    background: '#fff',
    boxShadow: '8px 8px 0 #000',
    padding: 22,
    display: 'grid',
    gap: 14
  },
  kicker: {
    width: 'fit-content',
    border: '2px solid #000',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#14532d',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 950,
    color: '#111827',
    letterSpacing: 0
  },
  text: {
    margin: 0,
    color: '#374151',
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.45
  },
  notice: {
    border: '1px solid #fed7aa',
    borderRadius: 10,
    background: '#fff7ed',
    color: '#9a3412',
    padding: 12,
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.35
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  button: {
    minHeight: 44,
    border: '2px solid #000',
    borderRadius: 10,
    background: '#22c55e',
    color: '#052e16',
    boxShadow: '4px 4px 0 #000',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 14px',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 950
  },
  secondaryButton: {
    minHeight: 44,
    border: '2px solid #000',
    borderRadius: 10,
    background: '#fff',
    color: '#111827',
    boxShadow: '4px 4px 0 #000',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 14px',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 950
  }
}
