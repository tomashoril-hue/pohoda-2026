'use client'

export type OfflineSnapshot = {
  snapshotId: string
  preparedByUserId: string
  preparedByName: string
  preparedByRole: string
  preparedAt: string
  deviceId: string
  mealDate: string
  mealType: 'OBED' | 'VECERA'
  issueLocation: string
  entitlementCount: number
  validUntil: string
  schemaVersion: number
  syncStatus: 'READY' | 'SYNCING' | 'SYNCED' | 'CONFLICTS'
}

export type OfflineEntitlement = {
  entitlementId: string
  snapshotId: string
  mode: 'GROUP_ISSUE' | 'INDIVIDUAL'
  issueId: string
  issueTitle: string
  personId: string
  qrCode: string
  qrCodes: string[]
  fullName: string
  registrationGroupName: string
  choice: 'MASO' | 'VEGE' | 'DIETA'
  mealDate: string
  mealType: 'OBED' | 'VECERA'
  issueLocation: string
  entitlementStatus: 'VALID' | 'BLOCKED'
  issuedStatus: 'NOT_ISSUED' | 'ISSUED' | 'CANCELLED'
  localIssuedEventId: string
  updatedAt: string
}

export type OfflineQrCode = {
  qrCode: string
  snapshotId: string
  entitlementId: string
  entitlementIds: string[]
  personId: string
  mode: 'GROUP_ISSUE' | 'INDIVIDUAL' | 'PICKUP_USER'
  modes: Array<'GROUP_ISSUE' | 'INDIVIDUAL' | 'PICKUP_USER'>
  issueId: string
  issueIds: string[]
  pickupIssueIds: string[]
  active: boolean
  updatedAt: string
}

export type OfflinePickupUser = {
  id: string
  snapshotId: string
  issueId: string
  personId: string
  fullName: string
  qrCodes: string[]
  updatedAt: string
}

export type OfflineIssueEvent = {
  offlineEventId: string
  deviceId: string
  snapshotId: string
  operation: 'ISSUE' | 'CANCEL_ISSUE'
  issueAction?: 'INDIVIDUAL' | 'REGISTRATION_GROUP_BULK'
  qrCode: string
  entitlementId: string
  personId: string
  registrationGroupIssueId?: string
  issuedPersonIds?: string[]
  issuedCount?: number
  choiceSummary?: ChoiceSummary
  mealDate: string
  mealType: 'OBED' | 'VECERA'
  issueLocation: string
  createdAt: string
  preparedByUserId: string
  syncStatus: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED_RETRY' | 'IGNORED_DUPLICATE'
  targetOfflineEventId?: string
}

export type ChoiceSummary = {
  MASO: number
  VEGE: number
  DIETA: number
}

export type OfflineBulkIssueOption = {
  id: string
  groupName: string
  count: number
  summary: ChoiceSummary
  includesScannedPerson: boolean
}

export type OfflineIssueDecision = {
  qrCode: string
  personName: string
  choice: string
  individual: {
    available: boolean
    alreadyIssued: boolean
    hasEntitlement: boolean
  }
  bulkIssues: OfflineBulkIssueOption[]
}

export type OfflineIssueScanResult = {
  ok: boolean
  status: string
  tone: 'success' | 'error' | 'warning'
  message: string
  personName?: string
  choice?: string
  method?: string
  groupName?: string
  issuedCount?: number
  summary?: ChoiceSummary
  decision?: OfflineIssueDecision
}

export type OfflineConflict = {
  id: string
  offlineEventId: string
  deviceId: string
  snapshotId: string
  conflictType: string
  message: string
  payload?: unknown
  status: 'OPEN' | 'RESOLVED'
  createdAt: string
}

export type OfflineSyncEventResult = {
  offlineEventId: string
  resultStatus: 'SYNCED' | 'CONFLICT' | 'FAILED_RETRY' | 'IGNORED_DUPLICATE'
  conflictType?: string
  message?: string
  createdIssueIds?: string[]
}

export type OfflineDeviceMeta = {
  key: string
  value: string
  updatedAt: string
}

export type OfflinePinState = {
  enabled: boolean
  updatedAt: string
}

export type OfflineSnapshotPayload = {
  snapshot: OfflineSnapshot
  entitlements: OfflineEntitlement[]
  qrCodes: OfflineQrCode[]
  pickupUsers?: OfflinePickupUser[]
}

const DB_NAME = 'pohoda-pass-offline-issue'
const DB_VERSION = 3

const STORES = {
  snapshots: 'offline_snapshots',
  entitlements: 'offline_entitlements',
  qrCodes: 'offline_qr_codes',
  pickupUsers: 'offline_pickup_users',
  events: 'offline_issue_events',
  syncResults: 'offline_sync_results',
  conflicts: 'offline_conflicts',
  deviceMeta: 'offline_device_meta'
} as const

type StoreName = typeof STORES[keyof typeof STORES]

function getIndexedDb() {
  if (typeof window === 'undefined') return null
  return window.indexedDB || null
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'))
  })
}

export function openOfflineIssueDb() {
  const indexedDb = getIndexedDb()

  if (!indexedDb) {
    return Promise.reject(new Error('IndexedDB nie je v tomto prehliadači dostupná.'))
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORES.snapshots)) {
        const store = db.createObjectStore(STORES.snapshots, { keyPath: 'snapshotId' })
        store.createIndex('meal', ['mealDate', 'mealType'], { unique: false })
        store.createIndex('deviceId', 'deviceId', { unique: false })
        store.createIndex('syncStatus', 'syncStatus', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.entitlements)) {
        const store = db.createObjectStore(STORES.entitlements, { keyPath: 'entitlementId' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
        store.createIndex('issueId', 'issueId', { unique: false })
        store.createIndex('qrCode', 'qrCode', { unique: false })
        store.createIndex('issuedStatus', 'issuedStatus', { unique: false })
      } else {
        const store = request.transaction?.objectStore(STORES.entitlements)
        if (store && !store.indexNames.contains('issueId')) {
          store.createIndex('issueId', 'issueId', { unique: false })
        }
      }

      if (!db.objectStoreNames.contains(STORES.qrCodes)) {
        const store = db.createObjectStore(STORES.qrCodes, { keyPath: 'qrCode' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
        store.createIndex('entitlementId', 'entitlementId', { unique: false })
        store.createIndex('personId', 'personId', { unique: false })
        store.createIndex('issueId', 'issueId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.pickupUsers)) {
        const store = db.createObjectStore(STORES.pickupUsers, { keyPath: 'id' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
        store.createIndex('issueId', 'issueId', { unique: false })
        store.createIndex('personId', 'personId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.events)) {
        const store = db.createObjectStore(STORES.events, { keyPath: 'offlineEventId' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
        store.createIndex('syncStatus', 'syncStatus', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.syncResults)) {
        const store = db.createObjectStore(STORES.syncResults, { keyPath: 'offlineEventId' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.conflicts)) {
        const store = db.createObjectStore(STORES.conflicts, { keyPath: 'id' })
        store.createIndex('snapshotId', 'snapshotId', { unique: false })
        store.createIndex('status', 'status', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORES.deviceMeta)) {
        db.createObjectStore(STORES.deviceMeta, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB sa nepodarilo otvoriť.'))
  })
}

async function readonlyStore(storeName: StoreName) {
  const db = await openOfflineIssueDb()
  const transaction = db.transaction(storeName, 'readonly')
  return transaction.objectStore(storeName)
}

async function readwriteStore(storeName: StoreName) {
  const db = await openOfflineIssueDb()
  const transaction = db.transaction(storeName, 'readwrite')
  return transaction.objectStore(storeName)
}

function txDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'))
  })
}

function indexGetAll<T>(index: IDBIndex, query?: IDBValidKey | IDBKeyRange | null) {
  return requestToPromise<T[]>(index.getAll(query ?? null))
}

function choiceSummary(rows: OfflineEntitlement[]): ChoiceSummary {
  return rows.reduce<ChoiceSummary>((summary, row) => {
    summary[row.choice] += 1
    return summary
  }, { MASO: 0, VEGE: 0, DIETA: 0 })
}

function choiceLabel(value: string) {
  if (value === 'MASO') return 'MÄSO'
  if (value === 'VEGE') return 'VEGE'
  if (value === 'DIETA') return 'DIÉTA'
  return value || ''
}

function firstExisting<T>(values: Array<T | null | undefined>) {
  return values.find(Boolean) || null
}

async function getLatestSnapshotFromDb(db: IDBDatabase) {
  const snapshots = await requestToPromise<OfflineSnapshot[]>(
    db.transaction(STORES.snapshots, 'readonly').objectStore(STORES.snapshots).getAll()
  )

  return snapshots
    .slice()
    .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))[0] || null
}

async function getEntitlementsBySnapshot(db: IDBDatabase, snapshotId: string) {
  const transaction = db.transaction(STORES.entitlements, 'readonly')
  const store = transaction.objectStore(STORES.entitlements)
  return indexGetAll<OfflineEntitlement>(store.index('snapshotId'), snapshotId)
}

function isAlreadyIssued(entitlements: OfflineEntitlement[], personId: string) {
  return entitlements.some(row => row.personId === personId && row.issuedStatus === 'ISSUED')
}

function buildBulkOptions({
  entitlements,
  issueIds,
  scannedPersonId
}: {
  entitlements: OfflineEntitlement[]
  issueIds: string[]
  scannedPersonId: string
}) {
  return issueIds.flatMap(issueId => {
    const rows = entitlements.filter(row => {
      return row.mode === 'GROUP_ISSUE' &&
        row.issueId === issueId &&
        row.entitlementStatus === 'VALID' &&
        row.issuedStatus === 'NOT_ISSUED'
    })

    if (rows.length === 0) return []

    return [{
      id: issueId,
      groupName: rows[0]?.issueTitle || rows[0]?.registrationGroupName || 'Skupinový výdaj',
      count: rows.length,
      summary: choiceSummary(rows),
      includesScannedPerson: rows.some(row => row.personId === scannedPersonId)
    }]
  })
}

function makeIssueEventId() {
  return `${Date.now()}-${crypto.randomUUID()}`
}

export async function processOfflineIssueQr({
  qrCode,
  issueAction,
  bulkIssueId
}: {
  qrCode: string
  issueAction?: 'INDIVIDUAL' | 'BULK'
  bulkIssueId?: string
}): Promise<OfflineIssueScanResult> {
  const cleanQr = String(qrCode || '').trim()
  if (!cleanQr) {
    return { ok: false, status: 'EMPTY_QR', tone: 'error', message: 'QR kód je prázdny.' }
  }

  const db = await openOfflineIssueDb()
  const snapshot = await getLatestSnapshotFromDb(db)

  if (!snapshot) {
    return { ok: false, status: 'NO_OFFLINE_DATA', tone: 'error', message: 'Offline dáta nie sú stiahnuté.' }
  }

  const lookupTx = db.transaction([STORES.qrCodes, STORES.entitlements], 'readonly')
  const qrRow = await requestToPromise<OfflineQrCode | undefined>(
    lookupTx.objectStore(STORES.qrCodes).get(cleanQr)
  )

  if (!qrRow || qrRow.snapshotId !== snapshot.snapshotId) {
    return { ok: false, status: 'UNKNOWN_QR', tone: 'error', message: 'QR kód nie je v offline dátach.' }
  }

  const entitlements = await getEntitlementsBySnapshot(db, snapshot.snapshotId)
  const personEntitlements = entitlements.filter(row => row.personId === qrRow.personId)
  const alreadyIssued = isAlreadyIssued(entitlements, qrRow.personId)
  const individual = personEntitlements.find(row => row.mode === 'INDIVIDUAL' && row.entitlementStatus === 'VALID') || null
  const individualAvailable = Boolean(individual && individual.issuedStatus === 'NOT_ISSUED' && !alreadyIssued)
  const pickupIssueIds = qrRow.pickupIssueIds || []
  const bulkOptions = buildBulkOptions({
    entitlements,
    issueIds: pickupIssueIds,
    scannedPersonId: qrRow.personId
  })
  const scannedName = firstExisting(personEntitlements.map(row => row.fullName)) || 'Bez mena'
  const scannedChoice = individual?.choice || firstExisting(personEntitlements.map(row => row.choice)) || ''

  if (!issueAction && bulkOptions.length > 0) {
    return {
      ok: false,
      status: 'ISSUE_DECISION_REQUIRED',
      tone: 'warning',
      message: 'Vyber spôsob výdaja.',
      decision: {
        qrCode: cleanQr,
        personName: scannedName,
        choice: scannedChoice,
        individual: {
          available: individualAvailable,
          alreadyIssued,
          hasEntitlement: Boolean(individual)
        },
        bulkIssues: bulkOptions
      }
    }
  }

  if (issueAction === 'BULK') {
    const issueId = String(bulkIssueId || '').replace(/^registration:/, '')
    if (!issueId || !pickupIssueIds.includes(issueId)) {
      return { ok: false, status: 'BULK_NOT_AVAILABLE', tone: 'error', message: 'Tento QR kód nemá oprávnenie prevziať vybraný skupinový výdaj.' }
    }

    const rowsToIssue = entitlements.filter(row => {
      return row.mode === 'GROUP_ISSUE' &&
        row.issueId === issueId &&
        row.entitlementStatus === 'VALID' &&
        row.issuedStatus === 'NOT_ISSUED'
    })

    if (rowsToIssue.length === 0) {
      return { ok: false, status: 'ALREADY_ISSUED', tone: 'error', message: 'Skupinový výdaj už nemá žiadne vydateľné položky.' }
    }

    const eventId = makeIssueEventId()
    const issuedPersonIds = Array.from(new Set(rowsToIssue.map(row => row.personId)))
    const now = new Date().toISOString()
    const writeTx = db.transaction([STORES.entitlements, STORES.events], 'readwrite')
    const entitlementStore = writeTx.objectStore(STORES.entitlements)
    const eventStore = writeTx.objectStore(STORES.events)

    entitlements
      .filter(row => issuedPersonIds.includes(row.personId) && row.issuedStatus === 'NOT_ISSUED')
      .forEach(row => {
        entitlementStore.put({
          ...row,
          issuedStatus: 'ISSUED',
          localIssuedEventId: eventId,
          updatedAt: now
        })
      })

    const summary = choiceSummary(rowsToIssue)
    eventStore.put({
      offlineEventId: eventId,
      deviceId: snapshot.deviceId,
      snapshotId: snapshot.snapshotId,
      operation: 'ISSUE',
      issueAction: 'REGISTRATION_GROUP_BULK',
      qrCode: cleanQr,
      entitlementId: rowsToIssue[0]?.entitlementId || '',
      personId: qrRow.personId,
      registrationGroupIssueId: issueId,
      issuedPersonIds,
      issuedCount: rowsToIssue.length,
      choiceSummary: summary,
      mealDate: snapshot.mealDate,
      mealType: snapshot.mealType,
      issueLocation: snapshot.issueLocation,
      createdAt: now,
      preparedByUserId: snapshot.preparedByUserId,
      syncStatus: 'PENDING'
    } satisfies OfflineIssueEvent)

    await txDone(writeTx)

    return {
      ok: true,
      status: 'ISSUED',
      tone: 'success',
      message: `Vydané skupinovo: ${rowsToIssue.length} porcií.`,
      personName: scannedName,
      method: 'REGISTRATION_GROUP_BULK',
      groupName: rowsToIssue[0]?.issueTitle || 'Skupinový výdaj',
      issuedCount: rowsToIssue.length,
      summary
    }
  }

  if (alreadyIssued) {
    return { ok: false, status: 'ALREADY_ISSUED', tone: 'error', message: 'Už vydané', personName: scannedName, choice: scannedChoice }
  }

  if (!individual) {
    return { ok: false, status: 'NO_ENTITLEMENT', tone: 'error', message: 'Bez osobného nároku', personName: scannedName }
  }

  if (!individualAvailable) {
    return { ok: false, status: 'ALREADY_ISSUED', tone: 'error', message: 'Už vydané', personName: scannedName, choice: individual.choice }
  }

  const eventId = makeIssueEventId()
  const now = new Date().toISOString()
  const registrationGroupEntitlement = personEntitlements.find(row => {
    return row.mode === 'GROUP_ISSUE' && row.entitlementStatus === 'VALID' && row.issueId
  }) || null
  const writeTx = db.transaction([STORES.entitlements, STORES.events], 'readwrite')
  const entitlementStore = writeTx.objectStore(STORES.entitlements)
  const eventStore = writeTx.objectStore(STORES.events)

  entitlements
    .filter(row => row.personId === individual.personId && row.issuedStatus === 'NOT_ISSUED')
    .forEach(row => {
      entitlementStore.put({
        ...row,
        issuedStatus: 'ISSUED',
        localIssuedEventId: eventId,
        updatedAt: now
      })
    })

  eventStore.put({
    offlineEventId: eventId,
    deviceId: snapshot.deviceId,
    snapshotId: snapshot.snapshotId,
    operation: 'ISSUE',
    issueAction: 'INDIVIDUAL',
    qrCode: cleanQr,
    entitlementId: individual.entitlementId,
    personId: individual.personId,
    registrationGroupIssueId: registrationGroupEntitlement?.issueId || undefined,
    issuedPersonIds: [individual.personId],
    issuedCount: 1,
    choiceSummary: choiceSummary([individual]),
    mealDate: snapshot.mealDate,
    mealType: snapshot.mealType,
    issueLocation: snapshot.issueLocation,
    createdAt: now,
    preparedByUserId: snapshot.preparedByUserId,
    syncStatus: 'PENDING'
  } satisfies OfflineIssueEvent)

  await txDone(writeTx)

  return {
    ok: true,
    status: 'ISSUED',
    tone: 'success',
    message: `Vydané osobne: ${choiceLabel(individual.choice)}.`,
    personName: individual.fullName,
    choice: individual.choice,
    method: 'INDIVIDUAL',
    issuedCount: 1,
    summary: choiceSummary([individual])
  }
}

export async function cancelLastOfflineIssue(): Promise<OfflineIssueScanResult> {
  const db = await openOfflineIssueDb()
  const snapshot = await getLatestSnapshotFromDb(db)

  if (!snapshot) {
    return { ok: false, status: 'NO_OFFLINE_DATA', tone: 'error', message: 'Offline dáta nie sú stiahnuté.' }
  }

  const events = await requestToPromise<OfflineIssueEvent[]>(
    db.transaction(STORES.events, 'readonly').objectStore(STORES.events).getAll()
  )
  const snapshotEvents = events.filter(event => event.snapshotId === snapshot.snapshotId)
  const cancelledEventIds = new Set(
    snapshotEvents
      .filter(event => event.operation === 'CANCEL_ISSUE' && event.targetOfflineEventId)
      .map(event => event.targetOfflineEventId as string)
  )
  const targetEvent = snapshotEvents
    .filter(event => event.operation === 'ISSUE' && !cancelledEventIds.has(event.offlineEventId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null

  if (!targetEvent) {
    return { ok: false, status: 'NO_OFFLINE_ISSUE_TO_CANCEL', tone: 'error', message: 'Nie je čo stornovať.' }
  }

  const entitlements = await getEntitlementsBySnapshot(db, snapshot.snapshotId)
  const issuedPersonIds = targetEvent.issuedPersonIds?.length
    ? targetEvent.issuedPersonIds
    : [targetEvent.personId]
  const rowsToRestore = entitlements.filter(row => {
    return issuedPersonIds.includes(row.personId) &&
      row.issuedStatus === 'ISSUED' &&
      row.localIssuedEventId === targetEvent.offlineEventId
  })

  if (rowsToRestore.length === 0) {
    return { ok: false, status: 'NO_OFFLINE_ISSUE_TO_CANCEL', tone: 'error', message: 'Posledný výdaj už nie je možné stornovať.' }
  }

  const now = new Date().toISOString()
  const cancelEventId = makeIssueEventId()
  const summary = choiceSummary(rowsToRestore)
  const firstRow = rowsToRestore[0]
  const writeTx = db.transaction([STORES.entitlements, STORES.events], 'readwrite')
  const entitlementStore = writeTx.objectStore(STORES.entitlements)
  const eventStore = writeTx.objectStore(STORES.events)

  rowsToRestore.forEach(row => {
    entitlementStore.put({
      ...row,
      issuedStatus: 'NOT_ISSUED',
      localIssuedEventId: '',
      updatedAt: now
    })
  })

  eventStore.put({
    offlineEventId: cancelEventId,
    deviceId: snapshot.deviceId,
    snapshotId: snapshot.snapshotId,
    operation: 'CANCEL_ISSUE',
    issueAction: targetEvent.issueAction,
    qrCode: targetEvent.qrCode,
    entitlementId: targetEvent.entitlementId,
    personId: targetEvent.personId,
    registrationGroupIssueId: targetEvent.registrationGroupIssueId,
    issuedPersonIds: Array.from(new Set(rowsToRestore.map(row => row.personId))),
    issuedCount: rowsToRestore.length,
    choiceSummary: summary,
    mealDate: snapshot.mealDate,
    mealType: snapshot.mealType,
    issueLocation: snapshot.issueLocation,
    createdAt: now,
    preparedByUserId: snapshot.preparedByUserId,
    syncStatus: 'PENDING',
    targetOfflineEventId: targetEvent.offlineEventId
  } satisfies OfflineIssueEvent)

  await txDone(writeTx)

  return {
    ok: true,
    status: 'CANCELLED',
    tone: 'warning',
    message: `Storno offline výdaja hotové: ${rowsToRestore.length} porcií.`,
    personName: firstRow?.fullName || 'Bez mena',
    choice: firstRow?.choice || '',
    method: targetEvent.issueAction || 'INDIVIDUAL',
    groupName: firstRow?.issueTitle || firstRow?.registrationGroupName || '',
    issuedCount: rowsToRestore.length,
    summary
  }
}

export async function listOfflineSnapshots() {
  const store = await readonlyStore(STORES.snapshots)
  return requestToPromise<OfflineSnapshot[]>(store.getAll())
}

export async function countOfflinePendingEvents() {
  const store = await readonlyStore(STORES.events)
  const index = store.index('syncStatus')
  const [pending, retry] = await Promise.all([
    requestToPromise<number>(index.count('PENDING')),
    requestToPromise<number>(index.count('FAILED_RETRY'))
  ])

  return pending + retry
}

export async function listOfflinePendingEvents() {
  const store = await readonlyStore(STORES.events)
  const index = store.index('syncStatus')
  const [pendingRows, retryRows] = await Promise.all([
    requestToPromise<OfflineIssueEvent[]>(index.getAll('PENDING')),
    requestToPromise<OfflineIssueEvent[]>(index.getAll('FAILED_RETRY'))
  ])
  const rows = [...pendingRows, ...retryRows]

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function applyOfflineSyncResults(results: OfflineSyncEventResult[]) {
  if (results.length === 0) return

  const db = await openOfflineIssueDb()
  const now = new Date().toISOString()
  const transaction = db.transaction([STORES.events, STORES.syncResults, STORES.conflicts], 'readwrite')
  const eventStore = transaction.objectStore(STORES.events)
  const syncStore = transaction.objectStore(STORES.syncResults)
  const conflictStore = transaction.objectStore(STORES.conflicts)

  for (const result of results) {
    const event = await requestToPromise<OfflineIssueEvent | undefined>(eventStore.get(result.offlineEventId))
    if (!event) continue

    const syncStatus = result.resultStatus === 'SYNCED' || result.resultStatus === 'IGNORED_DUPLICATE'
      ? 'SYNCED'
      : result.resultStatus === 'CONFLICT'
        ? 'CONFLICT'
        : 'FAILED_RETRY'

    eventStore.put({
      ...event,
      syncStatus
    })

    syncStore.put({
      offlineEventId: result.offlineEventId,
      snapshotId: event.snapshotId,
      resultStatus: result.resultStatus,
      conflictType: result.conflictType || '',
      message: result.message || '',
      createdIssueIds: result.createdIssueIds || [],
      updatedAt: now
    })

    if (result.resultStatus === 'CONFLICT') {
      conflictStore.put({
        id: result.offlineEventId,
        offlineEventId: result.offlineEventId,
        deviceId: event.deviceId,
        snapshotId: event.snapshotId,
        conflictType: result.conflictType || 'CONFLICT',
        message: result.message || 'Offline udalosť skončila konfliktom.',
        payload: result,
        status: 'OPEN',
        createdAt: now
      } satisfies OfflineConflict)
    }
  }

  await txDone(transaction)
}

export async function countOfflineOpenConflicts() {
  const store = await readonlyStore(STORES.conflicts)
  const index = store.index('status')
  return requestToPromise<number>(index.count('OPEN'))
}

export async function getOrCreateOfflineDeviceId() {
  const store = await readwriteStore(STORES.deviceMeta)
  const existing = await requestToPromise<OfflineDeviceMeta | undefined>(store.get('device_id'))

  if (existing?.value) return existing.value

  const value = crypto.randomUUID()
  await requestToPromise(store.put({
    key: 'device_id',
    value,
    updatedAt: new Date().toISOString()
  }))

  return value
}

export async function saveOfflineSnapshotPayload(
  payload: OfflineSnapshotPayload,
  onProgress?: (percent: number, label: string) => void
) {
  const db = await openOfflineIssueDb()
  const pickupUsers = payload.pickupUsers || []
  const total = Math.max(1, payload.entitlements.length + payload.qrCodes.length + pickupUsers.length + 1)
  let done = 0

  const report = (label: string) => {
    done += 1
    onProgress?.(Math.min(99, Math.round((done / total) * 100)), label)
  }

  const transaction = db.transaction([STORES.snapshots, STORES.entitlements, STORES.qrCodes, STORES.pickupUsers], 'readwrite')
  const snapshotStore = transaction.objectStore(STORES.snapshots)
  const entitlementStore = transaction.objectStore(STORES.entitlements)
  const qrStore = transaction.objectStore(STORES.qrCodes)
  const pickupStore = transaction.objectStore(STORES.pickupUsers)

  await requestToPromise(snapshotStore.put(payload.snapshot))
  report('Ukladám snapshot.')

  for (const entitlement of payload.entitlements) {
    await requestToPromise(entitlementStore.put(entitlement))
    report('Ukladám nároky.')
  }

  for (const qrCode of payload.qrCodes) {
    await requestToPromise(qrStore.put(qrCode))
    report('Ukladám QR kódy.')
  }

  for (const pickupUser of pickupUsers) {
    await requestToPromise(pickupStore.put(pickupUser))
    report('Ukladám oprávnenia na prevzatie.')
  }

  onProgress?.(100, 'Offline dáta sú uložené.')
}

export async function getOfflinePinState(): Promise<OfflinePinState> {
  const store = await readonlyStore(STORES.deviceMeta)
  const existing = await requestToPromise<OfflineDeviceMeta | undefined>(store.get('operator_pin'))

  return {
    enabled: Boolean(existing?.value),
    updatedAt: existing?.updatedAt || ''
  }
}

export async function setOfflineOperatorPin(pin: string) {
  const cleanPin = String(pin || '').trim()

  if (!/^\d{4,8}$/.test(cleanPin)) {
    throw new Error('PIN musí mať 4 až 8 číslic.')
  }

  const store = await readwriteStore(STORES.deviceMeta)
  await requestToPromise(store.put({
    key: 'operator_pin',
    value: cleanPin,
    updatedAt: new Date().toISOString()
  }))
}

export async function clearOfflineOperatorPin() {
  const store = await readwriteStore(STORES.deviceMeta)
  await requestToPromise(store.delete('operator_pin'))
}

export async function clearOfflineIssueData() {
  const db = await openOfflineIssueDb()
  const transaction = db.transaction(Object.values(STORES), 'readwrite')

  await Promise.all(Object.values(STORES).map(storeName => {
    return requestToPromise(transaction.objectStore(storeName).clear())
  }))
}
