import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'

export default async function GoogleSheetsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const access = await getGlobalAccess(user.id)

  if (!access.canUsePersonalista) {
    redirect('/dashboard/personalista')
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Personalista / Google Sheets</div>
          <h1 style={styles.title}>Google Sheets napojenie</h1>
          <p style={styles.subtitle}>
            Google tabuľka bude volať API aplikácie cez Apps Script a výsledky zapisovať späť do riadkov.
          </p>
        </div>

        <a href="/dashboard/personalista" style={styles.lightButton}>
          Späť
        </a>
      </header>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>Postup</h2>

        <ol style={styles.list}>
          <li>V deploy prostredí nastav `GOOGLE_SHEETS_IMPORT_TOKEN`.</li>
          <li>Voliteľne nastav `GOOGLE_SHEETS_IMPORT_ACTOR_USER_ID` na ID admina alebo personalistu.</li>
          <li>V Google Sheets otvor `Extensions - Apps Script`.</li>
          <li>Vlož obsah súboru `docs/google-sheets/pohoda-apps-script.js`.</li>
          <li>V skripte nastav `POHODA_API_BASE` a `POHODA_TOKEN`.</li>
          <li>Obnov tabuľku. Pribudne menu `POHODA`.</li>
          <li>Spusti `POHODA - Nastaviť výberové zoznamy`.</li>
        </ol>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>Stĺpce tabuľky</h2>

        <code style={styles.code}>
          meno, priezvisko, email, telefon, strava, skupina, od, do, obed, vecera, qr
        </code>

        <p style={styles.note}>
          Apps Script automaticky doplní výstupné stĺpce `stav`, `sprava`, `user_id`, `qr_kod`, `skupiny_app`,
          `narok_dni`, `obedy`, `vecere` a `aktualizovane`.
        </p>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>API</h2>

        <div style={styles.endpointGrid}>
          <div style={styles.endpointBox}>
            <b>Výberové zoznamy</b>
            <code>/api/personalista/google-sheets/options</code>
          </div>

          <div style={styles.endpointBox}>
            <b>Import</b>
            <code>/api/personalista/google-sheets/import-batch</code>
          </div>

          <div style={styles.endpointBox}>
            <b>Synchronizácia späť</b>
            <code>/api/personalista/google-sheets/sync-batch</code>
          </div>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  header: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center'
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: 850,
    color: '#6b7280'
  },
  title: {
    margin: '3px 0 0 0',
    fontSize: 25,
    lineHeight: 1.1,
    fontWeight: 950
  },
  subtitle: {
    margin: '5px 0 0 0',
    fontSize: 13,
    fontWeight: 750,
    color: '#6b7280'
  },
  lightButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer'
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 14,
    display: 'grid',
    gap: 10
  },
  sectionTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 950
  },
  list: {
    margin: 0,
    paddingLeft: 22,
    display: 'grid',
    gap: 7,
    fontSize: 13,
    fontWeight: 800,
    color: '#374151'
  },
  code: {
    display: 'block',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    fontWeight: 850,
    overflowWrap: 'anywhere'
  },
  note: {
    margin: 0,
    fontSize: 13,
    fontWeight: 780,
    color: '#4b5563',
    lineHeight: 1.45
  },
  endpointGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: 10
  },
  endpointBox: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 12,
    display: 'grid',
    gap: 6,
    background: '#f9fafb'
  }
}
