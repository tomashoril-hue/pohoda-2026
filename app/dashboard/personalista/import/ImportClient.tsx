'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type GroupItem = {
  id: string
  name: string
}

type ParsedRow = {
  id?: string
  rowNumber: number
  raw: Record<string, string>
  meno: string
  priezvisko: string
  email: string
  telefon: string
  typStravy: string
  registrationGroupId: string
  registrationGroupName: string
  validFrom: string
  validTo: string
  obed: boolean
  vecera: boolean
  assignQr: boolean
  generateAccessCode: boolean
  accessCode?: string
  welcomeEmailStatus?: string
  status: 'READY' | 'SKIP' | 'OK' | 'ERROR'
  message: string
}

type BulkEdit = {
  registrationGroupId: string
  validFrom: string
  validTo: string
  obed: '' | 'true' | 'false'
  vecera: '' | 'true' | 'false'
  assignQr: '' | 'true' | 'false'
  generateAccessCode: '' | 'true' | 'false'
}

type ImportBatchSummary = {
  id: string
  name: string
  sourceFileName: string
  status: string
  createdAt: string
  importedAt?: string
  stats: {
    total: number
    imported: number
    ready: number
    error: number
    skipped: number
    codes: number
    emailsSent: number
  }
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
  if (food === 'DIETA' || food === 'DIÉTA') return 'DIETA'

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

function namesFromText(value: string) {
  return String(value || '')
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
}

function emptyBulkEdit(): BulkEdit {
  return {
    registrationGroupId: '',
    validFrom: '',
    validTo: '',
    obed: '',
    vecera: '',
    assignQr: '',
    generateAccessCode: ''
  }
}

export default function ImportClient({
  registrationGroups,
  fromDate,
  toDate
}: {
  registrationGroups: GroupItem[]
  fromDate: string
  toDate: string
}) {
  const router = useRouter()
  const [batchId, setBatchId] = useState('')
  const [batchName, setBatchName] = useState('')
  const [sourceFileName, setSourceFileName] = useState('')
  const [defaultRegistrationGroupId, setDefaultRegistrationGroupId] = useState('')
  const [defaultFrom, setDefaultFrom] = useState(fromDate)
  const [defaultTo, setDefaultTo] = useState(toDate)
  const [defaultObed, setDefaultObed] = useState(true)
  const [defaultVecera, setDefaultVecera] = useState(false)
  const [defaultAssignQr, setDefaultAssignQr] = useState(true)
  const [defaultGenerateAccessCode, setDefaultGenerateAccessCode] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [selectedRows, setSelectedRows] = useState<number[]>([])
  const [bulkEdit, setBulkEdit] = useState<BulkEdit>(emptyBulkEdit())
  const [emailRegistrationGroupId, setEmailRegistrationGroupId] = useState('')
  const [accessCodesEmail, setAccessCodesEmail] = useState('')
  const [accessCodesRegistrationGroupId, setAccessCodesRegistrationGroupId] = useState('')
  const [accessCodesNote, setAccessCodesNote] = useState(
    'Ahoj, posielam prihlasovacie udaje jednotlivych uzivatelov. Dobre si ich uchovaj a poskytni ich svojim kolegom.'
  )
  const [importBatches, setImportBatches] = useState<ImportBatchSummary[]>([])
  const [showImportBatches, setShowImportBatches] = useState(false)
  const [activeTool, setActiveTool] = useState<'bulk' | 'welcome' | 'codes' | ''>('')
  const [tableRegistrationGroupFilterId, setTableRegistrationGroupFilterId] = useState('')
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeAction, setActiveAction] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'ok' | 'error' | ''>('')

  const registrationGroupByName = useMemo(() => {
    return new Map(registrationGroups.map(group => [normalizeKey(group.name), group]))
  }, [registrationGroups])

  const registrationGroupById = useMemo(() => {
    return new Map(registrationGroups.map(group => [group.id, group]))
  }, [registrationGroups])

  const selectedSet = useMemo(() => new Set(selectedRows), [selectedRows])

  const formatDateTime = (value: string) => {
    if (!value) return '-'

    return new Date(value).toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const buttonStyle = (base: React.CSSProperties, action: string, disabled = false) => ({
    ...base,
    ...(activeAction === action ? styles.buttonBusy : {}),
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  })

  const compactDateInput = (
    value: string,
    onChange: (value: string) => void,
    disabled = false
  ) => (
    <input
      type="date"
      value={value}
      onChange={event => onChange(event.target.value)}
      style={styles.compactDateInput}
      disabled={disabled}
    />
  )

  const stats = useMemo(() => {
    return {
      total: rows.length,
      ready: rows.filter(row => row.status === 'READY').length,
      ok: rows.filter(row => row.status === 'OK').length,
      error: rows.filter(row => row.status === 'ERROR').length,
      skip: rows.filter(row => row.status === 'SKIP').length,
      selected: selectedRows.length,
      withEmail: rows.filter(row => row.email && row.status === 'OK').length,
      sent: rows.filter(row => row.welcomeEmailStatus === 'SENT').length
    }
  }, [rows, selectedRows.length])

  const importedGroupOptions = useMemo(() => {
    const groupIds = new Set(rows.map(row => row.registrationGroupId).filter(Boolean))
    return registrationGroups.filter(group => groupIds.has(group.id))
  }, [registrationGroups, rows])

  const visibleRows = useMemo(() => {
    if (!tableRegistrationGroupFilterId) return rows
    return rows.filter(row => row.registrationGroupId === tableRegistrationGroupFilterId)
  }, [rows, tableRegistrationGroupFilterId])

  const visibleEditableRows = useMemo(() => {
    return visibleRows.filter(row => row.status !== 'OK').map(row => row.rowNumber)
  }, [visibleRows])

  const loadImportBatches = async () => {
    setLoadingBatches(true)
    setActiveAction('load-batches')

    try {
      const res = await fetch('/api/personalista/import-batches')
      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Davky sa nepodarilo nacitat.')
        setMessageType('error')
        return
      }

      setImportBatches(json.batches || [])
    } finally {
      setLoadingBatches(false)
      setActiveAction('')
    }
  }

  useEffect(() => {
    void loadImportBatches()
  }, [])

  const loadBatchRows = async (id: string) => {
    setLoading(true)
    setActiveAction(`load-batch-${id}`)
    setMessage('')
    setMessageType('')

    try {
      const res = await fetch(`/api/personalista/import-batches/${id}/rows`)
      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Davku sa nepodarilo nacitat.')
        setMessageType('error')
        return
      }

      const loadedRows = (json.rows || []).map((row: any) => {
        const registrationGroupId = row.registrationGroupId || ''

        return {
          id: row.id,
          rowNumber: Number(row.rowNumber || 0),
          raw: row.raw || {},
          meno: row.meno || '',
          priezvisko: row.priezvisko || '',
          email: row.email || '',
          telefon: row.telefon || '',
          typStravy: row.typStravy || 'MASO',
          registrationGroupId,
          registrationGroupName: registrationGroupById.get(registrationGroupId)?.name || '',
          validFrom: row.validFrom || '',
          validTo: row.validTo || '',
          obed: row.obed === true,
          vecera: row.vecera === true,
          assignQr: row.assignQr !== false,
          generateAccessCode: row.generateAccessCode === true,
          accessCode: row.accessCode || '',
          welcomeEmailStatus: row.welcomeEmailStatus || '',
          status: row.status === 'IMPORTED' ? 'OK' : row.status,
          message: row.message || ''
        } satisfies ParsedRow
      })

      setBatchId(json.batch.id)
      setBatchName(json.batch.name || 'Import')
      setSourceFileName(json.batch.sourceFileName || '')
      setRows(loadedRows)
      setSelectedRows([])
      setTableRegistrationGroupFilterId('')
      setMessage(`Davka "${json.batch.name || 'Import'}" je nacitana.`)
      setMessageType('ok')
    } finally {
      setLoading(false)
      setActiveAction('')
    }
  }

  const updateRow = (rowNumber: number, patch: Partial<ParsedRow>) => {
    setRows(current => current.map(row => {
      if (row.rowNumber !== rowNumber) return row

      const next = { ...row, ...patch }

      if (patch.registrationGroupId !== undefined) {
        next.registrationGroupName = registrationGroupById.get(patch.registrationGroupId)?.name || ''
      }

      if (next.status === 'OK') return next

      if (!next.meno || !next.priezvisko) {
        next.status = 'SKIP'
        next.message = 'Chyba meno alebo priezvisko.'
      } else if (!next.validFrom || !next.validTo || next.validTo < next.validFrom) {
        next.status = 'ERROR'
        next.message = 'Neplatne datumy od/do.'
      } else if (!next.obed && !next.vecera) {
        next.status = 'SKIP'
        next.message = 'Bez naroku na obed alebo veceru.'
      } else {
        next.status = 'READY'
        next.message = ''
      }

      return next
    }))
  }

  const parseFile = async (file: File) => {
    setMessage('')
    setMessageType('')
    setBatchId('')
    setSelectedRows([])
    setSourceFileName(file.name)
    setBatchName(file.name.replace(/\.[^.]+$/, '') || `Import ${new Date().toLocaleString('sk-SK')}`)
    setTableRegistrationGroupFilterId('')
    setActiveTool('')

    const text = await file.text()
    const table = parseDelimited(text)

    if (table.length < 2) {
      setRows([])
      setMessage('Subor musi obsahovat hlavicku a aspon jeden riadok.')
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

      const registrationGroupText = firstValue(raw, [
        'registracna_skupina',
        'reg_skupina',
        'registration_group',
        'skupina',
        'group'
      ])
      const requestedRegistrationGroups = namesFromText(registrationGroupText)
      const matchedRegistrationGroups = requestedRegistrationGroups
        .map(name => registrationGroupByName.get(normalizeKey(name)))
        .filter(Boolean) as GroupItem[]
      const fallbackRegistrationGroup = defaultRegistrationGroupId
        ? registrationGroupById.get(defaultRegistrationGroupId)
        : null
      const registrationGroup = matchedRegistrationGroups[0] || fallbackRegistrationGroup || null

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
        rowMessage = 'Chyba meno alebo priezvisko.'
      } else if (!obed && !vecera) {
        status = 'SKIP'
        rowMessage = 'Bez naroku na obed alebo veceru.'
      } else if (requestedRegistrationGroups.length > 1) {
        status = 'SKIP'
        rowMessage = 'Pouzi iba jednu registracnu skupinu.'
      } else if (requestedRegistrationGroups.length === 1 && matchedRegistrationGroups.length === 0) {
        status = 'SKIP'
        rowMessage = 'Registracna skupina sa nenasla.'
      }

      return {
        rowNumber: index + 2,
        raw,
        meno,
        priezvisko,
        email: firstValue(raw, ['email', 'e_mail', 'mail']),
        telefon: firstValue(raw, ['telefon', 'telefón', 'phone', 'tel']),
        typStravy: normalizeFood(firstValue(raw, ['typ_stravy', 'strava', 'jedlo', 'food'])),
        registrationGroupId: registrationGroup?.id || '',
        registrationGroupName: registrationGroup?.name || '',
        validFrom,
        validTo,
        obed,
        vecera,
        assignQr: boolValue(firstValue(raw, ['qr', 'assign_qr', 'priradit_qr']), defaultAssignQr),
        generateAccessCode: boolValue(firstValue(raw, ['kod', 'access_code', 'pristupovy_kod']), defaultGenerateAccessCode),
        status,
        message: rowMessage
      }
    })

    setRows(parsed)
    setMessage(`Nacitane riadky: ${parsed.length}. Skontroluj ich a potom uloz davku alebo spusti import.`)
    setMessageType('ok')
  }

  const createOrUpdateBatch = async () => {
    if (rows.length === 0) {
      setMessage('Nie je co ulozit.')
      setMessageType('error')
      return null
    }

    setLoading(true)
    setActiveAction(batchId ? 'save-batch' : 'create-batch')
    setMessage('')
    setMessageType('')

    try {
      const method = batchId ? 'PATCH' : 'POST'
      const url = batchId
        ? `/api/personalista/import-batches/${batchId}/rows`
        : '/api/personalista/import-batches'
      const body = batchId
        ? { rows }
        : { name: batchName || 'Import', sourceFileName, rows }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Davku sa nepodarilo ulozit.')
        setMessageType('error')
        return null
      }

      const nextBatchId = json.batch?.id || batchId

      if (nextBatchId) {
        setBatchId(nextBatchId)
      }

      const rowStatusByNumber = new Map((json.rows || []).map((row: any) => [Number(row.row_number), row]))
      const mergedRows = rows.map(row => {
        const saved: any = rowStatusByNumber.get(row.rowNumber)
        if (!saved) return row

        return {
          ...row,
          id: saved.id || row.id,
          status: saved.status === 'IMPORTED' ? 'OK' : saved.status,
          message: saved.message || ''
        }
      })

      setRows(mergedRows)
      setMessage('Importna davka je ulozena.')
      setMessageType('ok')
      void loadImportBatches()
      return { batchId: nextBatchId, rows: mergedRows }
    } finally {
      setLoading(false)
      setActiveAction('')
    }
  }

  const runImport = async () => {
    const savedBatch = await createOrUpdateBatch()

    if (!savedBatch?.batchId) return

    const activeBatchId = savedBatch.batchId
    const activeRows = savedBatch.rows.length > 0 ? savedBatch.rows : rows
    const readyRows = activeRows.filter(row => row.status === 'READY')

    if (readyRows.length === 0) {
      setMessage('Nie je co importovat.')
      setMessageType('error')
      return
    }

    setLoading(true)
    setActiveAction('run-import')
    setMessage('')
    setMessageType('')

    const nextRows = [...activeRows]

    for (const row of readyRows) {
      const index = nextRows.findIndex(item => item.rowNumber === row.rowNumber)

      try {
        const res = await fetch('/api/personalista/people/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importBatchId: activeBatchId,
            importRowId: row.id,
            meno: row.meno,
            priezvisko: row.priezvisko,
            email: row.email,
            telefon: row.telefon,
            typStravy: row.typStravy,
            registrationGroupId: row.registrationGroupId,
            validFrom: row.validFrom,
            validTo: row.validTo,
            obed: row.obed,
            vecera: row.vecera,
            assignQr: row.assignQr,
            generateAccessCode: row.generateAccessCode
          })
        })

        const text = await res.text()
        let json: any = {}

        try {
          json = text ? JSON.parse(text) : {}
        } catch {
          json = { error: 'Server vratil neplatnu odpoved.' }
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
            accessCode: json.accessCode || nextRows[index].accessCode,
            message: json.message || 'Importovane.'
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
    setActiveAction('')
    setMessage('Import dokonceny.')
    setMessageType('ok')
    void loadImportBatches()
    router.refresh()
  }

  const toggleSelected = (rowNumber: number) => {
    setSelectedRows(current => {
      if (current.includes(rowNumber)) return current.filter(item => item !== rowNumber)
      return [...current, rowNumber]
    })
  }

  const toggleAll = () => {
    setSelectedRows(current => {
      const selectedVisible = visibleEditableRows.filter(rowNumber => current.includes(rowNumber))

      if (visibleEditableRows.length > 0 && selectedVisible.length === visibleEditableRows.length) {
        return current.filter(rowNumber => !visibleEditableRows.includes(rowNumber))
      }

      return Array.from(new Set([...current, ...visibleEditableRows]))
    })
  }

  const applyBulkEdit = () => {
    if (selectedRows.length === 0) {
      setMessage('Najprv oznac riadky.')
      setMessageType('error')
      return
    }

    setRows(current => current.map(row => {
      if (!selectedSet.has(row.rowNumber) || row.status === 'OK') return row

      const patch: Partial<ParsedRow> = {}

      if (bulkEdit.registrationGroupId) {
        patch.registrationGroupId = bulkEdit.registrationGroupId
        patch.registrationGroupName = registrationGroupById.get(bulkEdit.registrationGroupId)?.name || ''
      }

      if (bulkEdit.validFrom) patch.validFrom = bulkEdit.validFrom
      if (bulkEdit.validTo) patch.validTo = bulkEdit.validTo
      if (bulkEdit.obed) patch.obed = bulkEdit.obed === 'true'
      if (bulkEdit.vecera) patch.vecera = bulkEdit.vecera === 'true'
      if (bulkEdit.assignQr) patch.assignQr = bulkEdit.assignQr === 'true'
      if (bulkEdit.generateAccessCode) patch.generateAccessCode = bulkEdit.generateAccessCode === 'true'

      return { ...row, ...patch, status: 'READY', message: '' }
    }))

    setBulkEdit(emptyBulkEdit())
    setActiveAction('bulk-edit')
    window.setTimeout(() => setActiveAction(''), 350)
    setMessage(`Hromadna uprava pouzita na ${selectedRows.length} riadkov.`)
    setMessageType('ok')
  }

  const sendWelcomeEmails = async (selectedOnly = false) => {
    if (!batchId) {
      setMessage('Najprv uloz a importuj davku.')
      setMessageType('error')
      return
    }

    setLoading(true)
    setActiveAction(selectedOnly ? 'send-welcome-selected' : 'send-welcome')
    setMessage('')
    setMessageType('')

    try {
      const rowIds = selectedOnly
        ? rows.filter(row => selectedSet.has(row.rowNumber) && row.id).map(row => row.id)
        : []

      const res = await fetch(`/api/personalista/import-batches/${batchId}/send-welcome-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationGroupId: emailRegistrationGroupId,
          rowIds,
          resend: false
        })
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'E-maily sa nepodarilo odoslat.')
        setMessageType('error')
        return
      }

      setRows(current => current.map(row => {
        const matchesSelection = !selectedOnly || selectedSet.has(row.rowNumber)
        const matchesGroup = !emailRegistrationGroupId || row.registrationGroupId === emailRegistrationGroupId
        if (row.status !== 'OK' || !row.email || !matchesSelection || !matchesGroup) return row
        return { ...row, welcomeEmailStatus: 'SENT' }
      }))

      setMessage(`E-maily odoslane: ${json.sent}, chyby: ${json.failed}.`)
      setMessageType(json.failed ? 'error' : 'ok')
    } finally {
      setLoading(false)
      setActiveAction('')
    }
  }

  const sendAccessCodes = async (selectedOnly = false) => {
    if (!batchId) {
      setMessage('Najprv uloz a importuj davku.')
      setMessageType('error')
      return
    }

    if (!accessCodesEmail.trim()) {
      setMessage('Zadaj e-mail, kam sa ma poslat CSV s kodmi.')
      setMessageType('error')
      return
    }

    setLoading(true)
    setActiveAction(selectedOnly ? 'send-codes-selected' : 'send-codes')
    setMessage('')
    setMessageType('')

    try {
      const rowIds = selectedOnly
        ? rows.filter(row => selectedSet.has(row.rowNumber) && row.id).map(row => row.id)
        : []

      const res = await fetch(`/api/personalista/import-batches/${batchId}/send-access-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accessCodesEmail,
          registrationGroupId: selectedOnly ? '' : accessCodesRegistrationGroupId,
          rowIds,
          note: accessCodesNote
        })
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Kody sa nepodarilo odoslat.')
        setMessageType('error')
        return
      }

      setMessage(`CSV s kodmi odoslane na ${accessCodesEmail}. Pocet pristupov: ${json.count}.`)
      setMessageType('ok')
    } finally {
      setLoading(false)
      setActiveAction('')
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.breadcrumb}>Personalistika / Import</div>
          <h1 style={styles.title}>Import Excel/CSV</h1>
          <p style={styles.subtitle}>
            CSV stlpce: meno, priezvisko, email, telefon, strava, skupina, od, do, obed, vecera, qr, kod.
            Stlpec skupina je registracna skupina.
          </p>
        </div>

        <a href="/dashboard/personalista" style={styles.lightButton}>
          Spat
        </a>
      </header>

      <section style={styles.panel}>
        <div style={styles.panelTop}>
          <div>
            <div style={styles.sectionTitle}>Importne davky</div>
            <p style={styles.sectionText}>
              Historia importov je schovana, aby hlavna obrazovka ostala hlavne na kontrolu aktualnej davky.
            </p>
          </div>
          <div style={styles.fileRow}>
            <button
              type="button"
              style={buttonStyle(styles.lightButton, 'toggle-batches', loadingBatches)}
              onClick={() => setShowImportBatches(value => !value)}
              disabled={loadingBatches}
            >
              {showImportBatches ? 'Skryt davky' : 'Zobrazit davky'}
            </button>
            {showImportBatches && (
              <button type="button" style={buttonStyle(styles.lightButton, 'load-batches', loadingBatches)} onClick={() => void loadImportBatches()} disabled={loadingBatches}>
                {loadingBatches ? 'Nacitavam...' : 'Obnovit davky'}
              </button>
            )}
          </div>
        </div>

        {showImportBatches && (
          importBatches.length === 0 ? (
            <div style={styles.emptyLine}>Zatial tu nie je ziadna importna davka.</div>
          ) : (
            <div style={styles.batchTable}>
              <div style={styles.batchHeader}>
                <span>Nazov</span>
                <span>Stav</span>
                <span>Riadky</span>
                <span>Kody</span>
                <span>Vytvorene</span>
                <span></span>
              </div>

              {importBatches.map(batch => (
                <div
                  key={batch.id}
                  style={{
                    ...styles.batchRow,
                    background: batch.id === batchId ? '#eef2ff' : '#fff'
                  }}
                >
                  <div style={styles.batchNameCell}>
                    <b>{batch.name}</b>
                    {batch.sourceFileName && <small>{batch.sourceFileName}</small>}
                  </div>
                  <span style={styles.plainBadge}>{batch.status}</span>
                  <span>{batch.stats.imported}/{batch.stats.total}</span>
                  <span>{batch.stats.codes}</span>
                  <span>{formatDateTime(batch.createdAt)}</span>
                  <button
                    type="button"
                    style={buttonStyle(styles.tinyButton, `load-batch-${batch.id}`, loading)}
                    onClick={() => void loadBatchRows(batch.id)}
                    disabled={loading}
                  >
                    Nacitat
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </section>

      <section style={styles.panel}>
        <div style={styles.settingsGrid}>
          <label style={styles.field}>
            <span>Nazov davky</span>
            <input
              value={batchName}
              onChange={event => setBatchName(event.target.value)}
              style={styles.input}
              disabled={loading || !!batchId}
              placeholder="Import dodavatelov"
            />
          </label>

          <label style={styles.field}>
            <span>Predvolena registracna skupina</span>
            <select
              value={defaultRegistrationGroupId}
              onChange={event => setDefaultRegistrationGroupId(event.target.value)}
              style={styles.input}
              disabled={loading}
            >
              <option value="">Ziadna registracna skupina</option>
              {registrationGroups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.field}>
            <span>Od</span>
            {compactDateInput(defaultFrom, setDefaultFrom, loading)}
          </label>

          <label style={styles.field}>
            <span>Do</span>
            {compactDateInput(defaultTo, setDefaultTo, loading)}
          </label>
        </div>

        <div style={styles.checkGrid}>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={defaultObed} onChange={event => setDefaultObed(event.target.checked)} disabled={loading} />
            <span>Predvolene obed</span>
          </label>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={defaultVecera} onChange={event => setDefaultVecera(event.target.checked)} disabled={loading} />
            <span>Predvolene vecera</span>
          </label>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={defaultAssignQr} onChange={event => setDefaultAssignQr(event.target.checked)} disabled={loading} />
            <span>Priradit volny QR</span>
          </label>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={defaultGenerateAccessCode} onChange={event => setDefaultGenerateAccessCode(event.target.checked)} disabled={loading} />
            <span>Generovat pristupovy kod</span>
          </label>
        </div>

        <div style={styles.fileRow}>
          <input
            type="file"
            accept=".csv,.txt,.tsv"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void parseFile(file)
            }}
            style={styles.fileInput}
            disabled={loading}
          />

          <button type="button" style={buttonStyle(styles.lightButton, batchId ? 'save-batch' : 'create-batch', loading || rows.length === 0)} disabled={loading || rows.length === 0} onClick={() => void createOrUpdateBatch()}>
            {batchId ? 'Ulozit upravy davky' : 'Ulozit davku'}
          </button>

          <button type="button" style={buttonStyle(styles.primaryButton, 'run-import', loading || stats.ready === 0)} disabled={loading || stats.ready === 0} onClick={runImport}>
            {loading ? 'Pracujem...' : `Importovat ${stats.ready}`}
          </button>
        </div>

        {batchId && (
          <div style={styles.batchInfo}>
            Davka ulozena: <b>{batchId}</b>
          </div>
        )}

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
        <div style={styles.statCard}><b>{stats.ok}</b><span>Importovane</span></div>
        <div style={styles.statCard}><b>{stats.error}</b><span>Chyby</span></div>
        <div style={styles.statCard}><b>{stats.skip}</b><span>Preskocene</span></div>
        <div style={styles.statCard}><b>{stats.selected}</b><span>Oznacene</span></div>
      </section>

      {rows.length > 0 && (
        <section style={styles.panel}>
          <div style={styles.panelTop}>
            <label style={{ ...styles.field, ...styles.groupFilterField }}>
              <span>Zobrazit registracnu skupinu</span>
              <select
                value={tableRegistrationGroupFilterId}
                onChange={event => {
                  const nextGroupId = event.target.value
                  setTableRegistrationGroupFilterId(nextGroupId)
                  setEmailRegistrationGroupId(nextGroupId)
                  setAccessCodesRegistrationGroupId(nextGroupId)
                  setSelectedRows([])
                }}
                style={styles.input}
              >
                <option value="">Vsetky skupiny v davke</option>
                {importedGroupOptions.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>

            <div style={styles.filterSummary}>
              Zobrazenych {visibleRows.length} z {rows.length} riadkov.
              {tableRegistrationGroupFilterId && ` Vybrana skupina: ${registrationGroupById.get(tableRegistrationGroupFilterId)?.name || '-'}.`}
            </div>
          </div>

          <div style={styles.toolBar}>
            <button
              type="button"
              style={buttonStyle(activeTool === 'bulk' ? styles.primaryButton : styles.lightButton, 'tool-bulk')}
              onClick={() => setActiveTool(value => value === 'bulk' ? '' : 'bulk')}
            >
              Hromadna uprava oznacenych
            </button>
            {batchId && stats.ok > 0 && (
              <button
                type="button"
                style={buttonStyle(activeTool === 'welcome' ? styles.primaryButton : styles.lightButton, 'tool-welcome')}
                onClick={() => setActiveTool(value => value === 'welcome' ? '' : 'welcome')}
              >
                Uvitacie e-maily
              </button>
            )}
            {batchId && stats.ok > 0 && (
              <button
                type="button"
                style={buttonStyle(activeTool === 'codes' ? styles.primaryButton : styles.lightButton, 'tool-codes')}
                onClick={() => setActiveTool(value => value === 'codes' ? '' : 'codes')}
              >
                Odoslat tabulku pristupovych kodov
              </button>
            )}
          </div>
        </section>
      )}

      {rows.length > 0 && activeTool === 'bulk' && (
        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Hromadna uprava oznacenych</div>
          <div style={styles.settingsGrid}>
            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select value={bulkEdit.registrationGroupId} onChange={event => setBulkEdit(prev => ({ ...prev, registrationGroupId: event.target.value }))} style={styles.input}>
                <option value="">Bez zmeny</option>
                {registrationGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <label style={styles.field}><span>Od</span>{compactDateInput(bulkEdit.validFrom, value => setBulkEdit(prev => ({ ...prev, validFrom: value })))}</label>
            <label style={styles.field}><span>Do</span>{compactDateInput(bulkEdit.validTo, value => setBulkEdit(prev => ({ ...prev, validTo: value })))}</label>
            <label style={styles.field}><span>Obed</span><select value={bulkEdit.obed} onChange={event => setBulkEdit(prev => ({ ...prev, obed: event.target.value as BulkEdit['obed'] }))} style={styles.input}><option value="">Bez zmeny</option><option value="true">Ano</option><option value="false">Nie</option></select></label>
            <label style={styles.field}><span>Vecera</span><select value={bulkEdit.vecera} onChange={event => setBulkEdit(prev => ({ ...prev, vecera: event.target.value as BulkEdit['vecera'] }))} style={styles.input}><option value="">Bez zmeny</option><option value="true">Ano</option><option value="false">Nie</option></select></label>
            <label style={styles.field}><span>QR</span><select value={bulkEdit.assignQr} onChange={event => setBulkEdit(prev => ({ ...prev, assignQr: event.target.value as BulkEdit['assignQr'] }))} style={styles.input}><option value="">Bez zmeny</option><option value="true">Ano</option><option value="false">Nie</option></select></label>
            <label style={styles.field}><span>Kod</span><select value={bulkEdit.generateAccessCode} onChange={event => setBulkEdit(prev => ({ ...prev, generateAccessCode: event.target.value as BulkEdit['generateAccessCode'] }))} style={styles.input}><option value="">Bez zmeny</option><option value="true">Ano</option><option value="false">Nie</option></select></label>
          </div>
          <button type="button" style={buttonStyle(styles.primaryButton, 'bulk-edit', selectedRows.length === 0 || loading)} onClick={applyBulkEdit} disabled={selectedRows.length === 0 || loading}>
            Pouzit na oznacene
          </button>
        </section>
      )}

      {batchId && stats.ok > 0 && activeTool === 'welcome' && (
        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Uvitacie e-maily</div>
          <div style={styles.fileRow}>
            <select value={emailRegistrationGroupId} onChange={event => setEmailRegistrationGroupId(event.target.value)} style={styles.input}>
              <option value="">Vsetky registracne skupiny</option>
              {registrationGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <button type="button" style={buttonStyle(styles.primaryButton, 'send-welcome', loading)} disabled={loading} onClick={() => void sendWelcomeEmails(false)}>
              Odoslat neodoslane
            </button>
            <button type="button" style={buttonStyle(styles.lightButton, 'send-welcome-selected', loading || selectedRows.length === 0)} disabled={loading || selectedRows.length === 0} onClick={() => void sendWelcomeEmails(true)}>
              Odoslat oznacenym
            </button>
          </div>
          <div style={styles.batchInfo}>
            Importovani s e-mailom: {stats.withEmail}. Odoslane lokalne oznacene: {stats.sent}.
          </div>
        </section>
      )}

      {batchId && stats.ok > 0 && activeTool === 'codes' && (
        <section style={styles.panel}>
          <div>
            <div style={styles.sectionTitle}>Odoslat tabulku pristupovych kodov</div>
            <p style={styles.sectionText}>
              Odosle CSV prilohu s menom, priezviskom, registracnou skupinou, login URL a pristupovym kodom.
            </p>
          </div>

          <div style={styles.settingsGrid}>
            <label style={styles.field}>
              <span>E-mail prijemcu</span>
              <input
                value={accessCodesEmail}
                onChange={event => setAccessCodesEmail(event.target.value)}
                style={styles.input}
                placeholder="veduci@firma.sk"
                type="email"
              />
            </label>

            <label style={styles.field}>
              <span>Registracna skupina</span>
              <select
                value={accessCodesRegistrationGroupId}
                onChange={event => setAccessCodesRegistrationGroupId(event.target.value)}
                style={styles.input}
              >
                <option value="">Vsetky importovane s kodom</option>
                {registrationGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
          </div>

          <label style={styles.field}>
            <span>Sprava do e-mailu</span>
            <textarea
              value={accessCodesNote}
              onChange={event => setAccessCodesNote(event.target.value)}
              style={styles.textarea}
              rows={3}
            />
          </label>

          <div style={styles.fileRow}>
            <button type="button" style={buttonStyle(styles.primaryButton, 'send-codes', loading || !accessCodesEmail.trim())} disabled={loading || !accessCodesEmail.trim()} onClick={() => void sendAccessCodes(false)}>
              Odoslat CSV podla filtra
            </button>
            <button type="button" style={buttonStyle(styles.lightButton, 'send-codes-selected', loading || !accessCodesEmail.trim() || selectedRows.length === 0)} disabled={loading || !accessCodesEmail.trim() || selectedRows.length === 0} onClick={() => void sendAccessCodes(true)}>
              Odoslat CSV oznacenym
            </button>
          </div>
        </section>
      )}

      <section style={styles.tableCard}>
        {rows.length === 0 ? (
          <div style={styles.emptyState}>
            Vyber CSV subor. Stlpec skupina sa paruje na registracnu skupinu v aplikacii.
          </div>
        ) : (
          <>
            <div style={styles.tableHeader}>
              <span style={styles.headerCheck}>
                <input
                  type="checkbox"
                  checked={visibleEditableRows.length > 0 && visibleEditableRows.every(rowNumber => selectedSet.has(rowNumber))}
                  onChange={toggleAll}
                />
              </span>
              <span>Meno</span>
              <span>Priezvisko</span>
              <span>E-mail</span>
              <span>Telefon</span>
              <span>Strava</span>
              <span>Reg skupina</span>
              <span>Od</span>
              <span>Do</span>
              <span>Obed</span>
              <span>Vecera</span>
              <span>QR</span>
              <span>Kod</span>
              <span>Pristupovy kod</span>
              <span>Uv. e-mail</span>
              <span>Stav</span>
              <span>Poznamka</span>
            </div>

            {visibleRows.slice(0, 500).map(row => (
              <div key={row.rowNumber} style={styles.tableRow}>
                <span>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(row.rowNumber)}
                    onChange={() => toggleSelected(row.rowNumber)}
                    disabled={row.status === 'OK'}
                  />
                  <small>#{row.rowNumber}</small>
                </span>
                <input value={row.meno} onChange={event => updateRow(row.rowNumber, { meno: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'} />
                <input value={row.priezvisko} onChange={event => updateRow(row.rowNumber, { priezvisko: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'} />
                <input value={row.email} onChange={event => updateRow(row.rowNumber, { email: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'} placeholder="email nepovinny" />
                <input value={row.telefon} onChange={event => updateRow(row.rowNumber, { telefon: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'} placeholder="telefon" />
                <select value={row.typStravy} onChange={event => updateRow(row.rowNumber, { typStravy: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'}>
                  <option value="MASO">MASO</option>
                  <option value="VEGE">VEGE</option>
                  <option value="DIETA">DIETA</option>
                </select>
                <select value={row.registrationGroupId} onChange={event => updateRow(row.rowNumber, { registrationGroupId: event.target.value })} style={styles.smallInput} disabled={row.status === 'OK'}>
                  <option value="">Bez registracnej skupiny</option>
                  {registrationGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                {compactDateInput(row.validFrom, value => updateRow(row.rowNumber, { validFrom: value }), row.status === 'OK')}
                {compactDateInput(row.validTo, value => updateRow(row.rowNumber, { validTo: value }), row.status === 'OK')}
                <span style={styles.centerCell}><input type="checkbox" checked={row.obed} onChange={event => updateRow(row.rowNumber, { obed: event.target.checked })} disabled={row.status === 'OK'} /></span>
                <span style={styles.centerCell}><input type="checkbox" checked={row.vecera} onChange={event => updateRow(row.rowNumber, { vecera: event.target.checked })} disabled={row.status === 'OK'} /></span>
                <span style={styles.centerCell}><input type="checkbox" checked={row.assignQr} onChange={event => updateRow(row.rowNumber, { assignQr: event.target.checked })} disabled={row.status === 'OK'} /></span>
                <span style={styles.centerCell}><input type="checkbox" checked={row.generateAccessCode} onChange={event => updateRow(row.rowNumber, { generateAccessCode: event.target.checked })} disabled={row.status === 'OK'} /></span>
                <span style={styles.codeCell}>{row.accessCode || '-'}</span>
                <span
                  style={{
                    ...styles.emailStatusCell,
                    background: row.welcomeEmailStatus === 'SENT' ? '#dcfce7' : row.email ? '#fef3c7' : '#f3f4f6',
                    color: row.welcomeEmailStatus === 'SENT' ? '#166534' : row.email ? '#92400e' : '#6b7280'
                  }}
                >
                  {row.welcomeEmailStatus === 'SENT' ? 'odoslany' : row.email ? 'neodoslany' : '-'}
                </span>
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
                  {row.status}
                </span>
                <span style={styles.noteCell}>
                  {row.message || ''}
                </span>
              </div>
            ))}
            {visibleRows.length > 500 && (
              <div style={styles.tableLimitNotice}>
                Zobrazenych prvych 500 riadkov z filtra. Zuz vyber registracnou skupinou, ak potrebujes pracovat s mensim zoznamom.
              </div>
            )}
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
    borderRadius: 10,
    padding: 10,
    display: 'grid',
    gap: 10
  },
  panelTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap'
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 950
  },
  sectionText: {
    margin: '4px 0 0 0',
    fontSize: 12,
    fontWeight: 750,
    color: '#6b7280'
  },
  settingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
    gap: 8
  },
  field: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 950,
    color: '#6b7280'
  },
  groupFilterField: {
    minWidth: 260,
    flex: '1 1 300px'
  },
  filterSummary: {
    border: '1px solid #e5e7eb',
    borderRadius: 7,
    padding: '8px 10px',
    background: '#f9fafb',
    fontSize: 12,
    fontWeight: 850,
    color: '#374151'
  },
  toolBar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  input: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    padding: '7px 8px',
    fontSize: 12,
    fontWeight: 850,
    background: '#fff',
    color: '#111827'
  },
  textarea: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    padding: '8px',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 750,
    background: '#fff',
    color: '#111827',
    resize: 'vertical'
  },
  smallInput: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minInlineSize: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    padding: '5px 6px',
    fontSize: 11,
    fontWeight: 800,
    background: '#fff',
    color: '#111827',
    outline: 'none'
  },
  compactDateInput: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    height: 26,
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    padding: '3px 4px',
    fontSize: 10,
    fontWeight: 900,
    background: '#fff',
    color: '#111827',
    colorScheme: 'light',
    outline: 'none'
  },
  checkGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  },
  checkRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 7,
    padding: '6px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 900
  },
  miniCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 850
  },
  fileRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  fileInput: {
    border: '1px solid #d1d5db',
    borderRadius: 7,
    padding: 7,
    background: '#fff',
    fontSize: 12,
    fontWeight: 850
  },
  primaryButton: {
    border: '1px solid #16a34a',
    background: '#22c55e',
    color: '#052e16',
    borderRadius: 7,
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 950,
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, filter 120ms ease'
  },
  lightButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    borderRadius: 7,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 950,
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, filter 120ms ease'
  },
  buttonBusy: {
    transform: 'translateY(1px)',
    boxShadow: 'inset 0 0 0 2px rgba(17,24,39,0.18)',
    filter: 'saturate(1.18) brightness(0.97)'
  },
  message: {
    border: '1px solid',
    borderRadius: 12,
    padding: 10,
    fontSize: 12,
    fontWeight: 850
  },
  batchInfo: {
    border: '1px dashed #d1d5db',
    borderRadius: 7,
    padding: 8,
    fontSize: 12,
    fontWeight: 850,
    color: '#374151',
    overflowWrap: 'anywhere'
  },
  batchTable: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    overflowX: 'auto'
  },
  batchHeader: {
    minWidth: 760,
    display: 'grid',
    gridTemplateColumns: 'minmax(190px, 1.4fr) 90px 78px 62px 150px 86px',
    gap: 4,
    padding: '7px 8px',
    background: '#eef2f7',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  batchRow: {
    minWidth: 760,
    display: 'grid',
    gridTemplateColumns: 'minmax(190px, 1.4fr) 90px 78px 62px 150px 86px',
    gap: 4,
    padding: '6px 8px',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'center',
    fontSize: 11,
    fontWeight: 850
  },
  batchNameCell: {
    display: 'grid',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere'
  },
  plainBadge: {
    display: 'inline-flex',
    justifyContent: 'center',
    border: '1px solid #d1d5db',
    borderRadius: 999,
    padding: '3px 7px',
    background: '#fff',
    fontSize: 10,
    fontWeight: 950
  },
  tinyButton: {
    border: '1px solid #111827',
    background: '#111827',
    color: '#fff',
    borderRadius: 6,
    padding: '5px 7px',
    fontSize: 11,
    fontWeight: 950,
    cursor: 'pointer'
  },
  emptyLine: {
    border: '1px dashed #d1d5db',
    borderRadius: 7,
    padding: 10,
    fontSize: 12,
    fontWeight: 850,
    color: '#6b7280',
    background: '#f9fafb'
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
    borderRadius: 10,
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
    minWidth: 1440,
    display: 'grid',
    gridTemplateColumns: '48px 112px 128px 210px 92px 76px 168px 92px 92px 48px 52px 42px 46px 86px 82px 72px minmax(140px, 1fr)',
    gap: 4,
    padding: '7px 8px',
    background: '#eef2f7',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 10,
    fontWeight: 950,
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  tableRow: {
    minWidth: 1440,
    display: 'grid',
    gridTemplateColumns: '48px 112px 128px 210px 92px 76px 168px 92px 92px 48px 52px 42px 46px 86px 82px 72px minmax(140px, 1fr)',
    gap: 4,
    padding: '6px 8px',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'start',
    fontSize: 11,
    fontWeight: 850
  },
  headerCheck: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  centerCell: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26
  },
  statusBadge: {
    borderRadius: 6,
    padding: '5px 6px',
    fontSize: 10,
    fontWeight: 900,
    textAlign: 'center',
    overflowWrap: 'anywhere'
  },
  codeCell: {
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    padding: '5px 6px',
    minHeight: 26,
    boxSizing: 'border-box',
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0.5,
    background: '#fef3c7',
    color: '#111827',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  emailStatusCell: {
    borderRadius: 6,
    padding: '5px 6px',
    minHeight: 26,
    boxSizing: 'border-box',
    fontSize: 10,
    fontWeight: 900,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  noteCell: {
    minHeight: 26,
    padding: '5px 6px',
    boxSizing: 'border-box',
    fontSize: 10,
    fontWeight: 800,
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  tableLimitNotice: {
    minWidth: 1440,
    padding: '8px 10px',
    borderTop: '1px solid #e5e7eb',
    background: '#fffbeb',
    color: '#92400e',
    fontSize: 12,
    fontWeight: 850
  }
}
