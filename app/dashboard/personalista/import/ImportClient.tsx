'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type GroupItem = {
  id: string
  name: string
}

type ParsedRow = {
  rowNumber: number
  raw: Record<string, string>
  meno: string
  priezvisko: string
  email: string
  telefon: string
  typStravy: string
  groupIds: string[]
  validFrom: string
  validTo: string
  obed: boolean
  vecera: boolean
  assignQr: boolean
  status: 'READY' | 'SKIP' | 'OK' | 'ERROR'
  message: string
}

function normalizeKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function firstValue(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && String(value).trim()) return String(value).trim()
  }

  return ''
}

function normalizeFood(value: string) {
  const food = String(value || '').trim().toUpperCase()

  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA' || food === 'DIĂ‰TA') return 'DIETA'

  return 'MASO'
}

function boolValue(value: string, fallback: boolean) {
  const text = String(value || '').trim().toLowerCase()

  if (!text) return fallback
  if (['1', 'ano', 'áno', 'yes', 'true', 'x', 'obed', 'vecera', 'večera'].includes(text)) return true
  if (['0', 'nie', 'no', 'false', '-'].includes(text)) return false

  return fallback
}

function parseDate(value: string, fallback: string) {
  const text = String(value || '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)

  if (match) {
    const day = match[1].padStart(2, '0')
    const month = match[2].padStart(2, '0')
    return `${match[3]}-${month}-${day}`
  }

  return fallback
}

function detectDelimiter(line: string) {
  const candidates = [';', ',', '\t']
  let best = ';'
  let bestCount = -1

  candidates.forEach(candidate => {
    const count = line.split(candidate).length
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  })

  return best
}

function parseDelimited(text: string) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = clean.split('\n').find(line => line.trim()) || ''
  const delimiter = detectDelimiter(firstLine)
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    const next = clean[index + 1]

    if (char === '"' && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim())
      current = ''
      continue
    }

    if (char === '\n' && !inQuotes) {
      row.push(current.trim())
      current = ''
      if (row.some(cell => cell.trim())) rows.push(row)
      row = []
      continue
    }

    current += char
  }

  row.push(current.trim())
  if (row.some(cell => cell.trim())) rows.push(row)

  return rows
}

function groupNamesFromText(value: string) {
  return String(value || '')
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
}

export default function ImportClient({
  groups,
  fromDate,
  toDate
}: {
  groups: GroupItem[]
  fromDate: string
  toDate: string
}) {
  const router = useRouter()
  const [defaultGroupId, setDefaultGroupId] = useState('')
  const [defaultFrom, setDefaultFrom] = useState(fromDate)
  const [defaultTo, setDefaultTo] = useState(toDate)
  const [defaultObed, setDefaultObed] = useState(true)
  const [defaultVecera, setDefaultVecera] = useState(false)
  const [defaultAssignQr, setDefaultAssignQr] = useState(true)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')

  const groupByName = useMemo(() => {
    return new Map(groups.map(group => [normalizeKey(group.name), group]))
  }, [groups])

  const stats = useMemo(() => {
    return {
      total: rows.length,
      ready: rows.filter(row => row.status === 'READY').length,
      ok: rows.filter(row => row.status === 'OK').length,
      error: rows.filter(row => row.status === 'ERROR').length,
      skip: rows.filter(row => row.status === 'SKIP').length
    }
  }, [rows])

  const parseFile = async (file: File) => {
    setMessage('')
    setMessageType('')

    const text = await file.text()
    const table = parseDelimited(text)

    if (table.length < 2) {
      setRows([])
      setMessage('Súbor musí obsahovať hlavičku a aspoň jeden riadok.')
      setMessageType('error')
      return
    }

    const headers = table[0].map(normalizeKey)
    const parsed = table.slice(1).map((cells, index) => {
      const raw: Record<string, string> = {}

      headers.forEach((header, headerIndex) => {
        if (!header) return
        raw[header] = cells[headerIndex] || ''
      })

      const groupText = firstValue(raw, ['skupina', 'skupiny', 'group', 'groups'])
      const groupIds = groupNamesFromText(groupText)
        .map(name => groupByName.get(normalizeKey(name))?.id || '')
        .filter(Boolean)

      if (groupIds.length === 0 && defaultGroupId) {
        groupIds.push(defaultGroupId)
      }

      const meno = firstValue(raw, ['meno', 'krstne_meno', 'first_name'])
      const priezvisko = firstValue(raw, ['priezvisko', 'surname', 'last_name'])
      const validFrom = parseDate(firstValue(raw, ['od', 'valid_from', 'zaciatok', 'datum_od']), defaultFrom)
      const validTo = parseDate(firstValue(raw, ['do', 'valid_to', 'koniec', 'datum_do']), defaultTo)
      const obed = boolValue(firstValue(raw, ['obed', 'lunch']), defaultObed)
      const vecera = boolValue(firstValue(raw, ['vecera', 'večera', 'dinner']), defaultVecera)

      let status: ParsedRow['status'] = 'READY'
      let rowMessage = ''

      if (!meno || !priezvisko) {
        status = 'SKIP'
        rowMessage = 'Chýba meno alebo priezvisko.'
      } else if (!obed && !vecera) {
        status = 'SKIP'
        rowMessage = 'Bez nároku na obed alebo večeru.'
      }

      return {
        rowNumber: index + 2,
        raw,
        meno,
        priezvisko,
        email: firstValue(raw, ['email', 'e_mail', 'mail']),
        telefon: firstValue(raw, ['telefon', 'telefón', 'phone', 'tel']),
        typStravy: normalizeFood(firstValue(raw, ['typ_stravy', 'strava', 'jedlo', 'food'])),
        groupIds,
        validFrom,
        validTo,
        obed,
        vecera,
        assignQr: boolValue(firstValue(raw, ['qr', 'assign_qr', 'priradit_qr']), defaultAssignQr),
        status,
        message: rowMessage
      }
    })

    setRows(parsed)
    setMessage(`Načítané riadky: ${parsed.length}.`)
    setMessageType('ok')
  }

  const runImport = async () => {
    const readyRows = rows.filter(row => row.status === 'READY')

    if (readyRows.length === 0) {
      setMessage('Nie je čo importovať.')
      setMessageType('error')
      return
    }

    setLoading(true)
    setMessage('')
    setMessageType('')

    const nextRows = [...rows]

    for (const row of readyRows) {
      const index = nextRows.findIndex(item => item.rowNumber === row.rowNumber)

      try {
        const res = await fetch('/api/personalista/people/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meno: row.meno,
            priezvisko: row.priezvisko,
            email: row.email,
            telefon: row.telefon,
            typStravy: row.typStravy,
            groupIds: row.groupIds,
            validFrom: row.validFrom,
            validTo: row.validTo,
            obed: row.obed,
            vecera: row.vecera,
            assignQr: row.assignQr
          })
        })

        const text = await res.text()
        let json: any = {}

        try {
          json = text ? JSON.parse(text) : {}
        } catch {
          json = { error: 'Server vrátil neplatnú odpoveď.' }
        }

        if (!res.ok || json.error) {
          nextRows[index] = {
            ...nextRows[index],
            status: 'ERROR',
            message: json.error || 'Import zlyhal.'
          }
        } else {
          nextRows[index] = {
            ...nextRows[index],
            status: 'OK',
            message: json.message || 'Importované.'
          }
        }
      } catch (err) {
        nextRows[index] = {
          ...nextRows[index],
          status: 'ERROR',
          message: err instanceof Error ? err.message : String(err)
        }
      }

      setRows([...nextRows])
    }

    setLoading(false)
    setMessage('Import dokončený.')
    setMessageType('ok')
    router.refresh()
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Personalistika / Import</div>
          <h1 style={styles.title}>Import Excel/CSV</h1>
          <p style={styles.subtitle}>
            Excel ulož ako CSV. Podporované stĺpce: meno, priezvisko, email, telefon, strava, skupina, od, do, obed, vecera, qr.
          </p>
        </div>

        <a href="/dashboard/personalista" style={styles.lightButton}>
          Späť
        </a>
      </header>

      <section style={styles.panel}>
        <div style={styles.settingsGrid}>
          <label style={styles.field}>
            <span>Predvolená skupina</span>
            <select
              value={defaultGroupId}
              onChange={event => setDefaultGroupId(event.target.value)}
              style={styles.input}
              disabled={loading}
            >
              <option value="">Žiadna skupina</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.field}>
            <span>Od</span>
            <input
              type="date"
              value={defaultFrom}
              onChange={event => setDefaultFrom(event.target.value)}
              style={styles.input}
              disabled={loading}
            />
          </label>

          <label style={styles.field}>
            <span>Do</span>
            <input
              type="date"
              value={defaultTo}
              onChange={event => setDefaultTo(event.target.value)}
              style={styles.input}
              disabled={loading}
            />
          </label>
        </div>

        <div style={styles.checkGrid}>
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={defaultObed}
              onChange={event => setDefaultObed(event.target.checked)}
              disabled={loading}
            />
            <span>Predvolene obed</span>
          </label>

          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={defaultVecera}
              onChange={event => setDefaultVecera(event.target.checked)}
              disabled={loading}
            />
            <span>Predvolene večera</span>
          </label>

          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={defaultAssignQr}
              onChange={event => setDefaultAssignQr(event.target.checked)}
              disabled={loading}
            />
            <span>Priradiť voľný QR</span>
          </label>
        </div>

        <div style={styles.fileRow}>
          <input
            type="file"
            accept=".csv,.txt,.tsv"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) parseFile(file)
            }}
            style={styles.fileInput}
            disabled={loading}
          />

          <button
            type="button"
            style={styles.primaryButton}
            disabled={loading || stats.ready === 0}
            onClick={runImport}
          >
            {loading ? 'Importujem...' : `Importovať ${stats.ready}`}
          </button>
        </div>

        {message && (
          <div
            style={{
              ...styles.message,
              background: messageType === 'ok' ? '#dcfce7' : '#fee2e2',
              color: messageType === 'ok' ? '#166534' : '#991b1b',
              borderColor: messageType === 'ok' ? '#86efac' : '#fecaca'
            }}
          >
            {message}
          </div>
        )}
      </section>

      <section style={styles.statsGrid}>
        <div style={styles.statCard}><b>{stats.total}</b><span>Riadkov</span></div>
        <div style={styles.statCard}><b>{stats.ready}</b><span>Na import</span></div>
        <div style={styles.statCard}><b>{stats.ok}</b><span>Hotovo</span></div>
        <div style={styles.statCard}><b>{stats.error}</b><span>Chyby</span></div>
        <div style={styles.statCard}><b>{stats.skip}</b><span>Preskočené</span></div>
      </section>

      <section style={styles.tableCard}>
        {rows.length === 0 ? (
          <div style={styles.emptyState}>
            Vyber CSV subor. Stravovacie skupiny v stlpci skupina oddeluj znakom |.
          </div>
        ) : (
          <>
            <div style={styles.tableHeader}>
              <span>Riadok</span>
              <span>Osoba</span>
              <span>Stravovacie skupiny</span>
              <span>Nárok</span>
              <span>Stav</span>
            </div>

            {rows.slice(0, 250).map(row => (
              <div key={row.rowNumber} style={styles.tableRow}>
                <span>{row.rowNumber}</span>
                <div style={styles.personCell}>
                  <b>{row.meno} {row.priezvisko}</b>
                  <span>{row.email || '-'}</span>
                </div>
                <span>{row.groupIds.length || 'Bez skupiny'}</span>
                <span>{row.validFrom} - {row.validTo} / {row.obed ? 'O' : '-'} {row.vecera ? 'V' : '-'}</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    background:
                      row.status === 'OK' ? '#dcfce7' :
                      row.status === 'ERROR' ? '#fee2e2' :
                      row.status === 'SKIP' ? '#fef3c7' :
                      '#eff6ff',
                    color:
                      row.status === 'OK' ? '#166534' :
                      row.status === 'ERROR' ? '#991b1b' :
                      row.status === 'SKIP' ? '#92400e' :
                      '#1d4ed8'
                  }}
                >
                  {row.status}{row.message ? ` - ${row.message}` : ''}
                </span>
              </div>
            ))}
          </>
        )}
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
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 12,
    display: 'grid',
    gap: 12
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 10
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '11px 10px',
    fontSize: 16,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  checkGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8
  },
  checkRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '9px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 900
  },
  fileRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  fileInput: {
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: 9,
    background: '#fff',
    fontSize: 13,
    fontWeight: 850
  },
  primaryButton: {
    border: '1px solid #16a34a',
    background: '#22c55e',
    color: '#052e16',
    borderRadius: 12,
    padding: '11px 12px',
    fontSize: 13,
    fontWeight: 950,
    cursor: 'pointer'
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
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 10
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 12,
    display: 'grid',
    gap: 3
  },
  tableCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflowX: 'auto'
  },
  emptyState: {
    padding: 18,
    fontSize: 13,
    fontWeight: 800,
    color: '#6b7280',
    textAlign: 'center'
  },
  tableHeader: {
    minWidth: 820,
    display: 'grid',
    gridTemplateColumns: '70px minmax(180px, 1.2fr) 100px minmax(190px, 1fr) minmax(220px, 1fr)',
    gap: 8,
    padding: '10px 12px',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  tableRow: {
    minWidth: 820,
    display: 'grid',
    gridTemplateColumns: '70px minmax(180px, 1.2fr) 100px minmax(190px, 1fr) minmax(220px, 1fr)',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 850
  },
  personCell: {
    display: 'grid',
    gap: 2,
    overflowWrap: 'anywhere'
  },
  statusBadge: {
    borderRadius: 10,
    padding: '7px 8px',
    fontSize: 11,
    fontWeight: 900,
    overflowWrap: 'anywhere'
  }
}
