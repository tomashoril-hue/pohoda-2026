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
  personId: string
  issueId: string
  active: boolean
  updatedAt: string
}

export type OfflineIssueEvent = {
  offlineEventId: string
  deviceId: string
  snapshotId: string
  operation: 'ISSUE' | 'CANCEL_ISSUE'
  qrCode: string
  entitlementId: string
  personId: string
  mealDate: string
  mealType: 'OBED' | 'VECERA'
  issueLocation: string
  createdAt: string
  preparedByUserId: string
  syncStatus: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'FAILED_RETRY' | 'IGNORED_DUPLICATE'
  targetOfflineEventId?: string
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
}

const DB_NAME = 'pohoda-pass-offline-issue'
const DB_VERSION = 2

const STORES = {
  snapshots: 'offline_snapshots',
  entitlements: 'offline_entitlements',
  qrCodes: 'offline_qr_codes',
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

export async function listOfflineSnapshots() {
  const store = await readonlyStore(STORES.snapshots)
  return requestToPromise<OfflineSnapshot[]>(store.getAll())
}

export async function countOfflinePendingEvents() {
  const store = await readonlyStore(STORES.events)
  const index = store.index('syncStatus')
  return requestToPromise<number>(index.count('PENDING'))
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
  const total = Math.max(1, payload.entitlements.length + payload.qrCodes.length + 1)
  let done = 0

  const report = (label: string) => {
    done += 1
    onProgress?.(Math.min(99, Math.round((done / total) * 100)), label)
  }

  const transaction = db.transaction([STORES.snapshots, STORES.entitlements, STORES.qrCodes], 'readwrite')
  const snapshotStore = transaction.objectStore(STORES.snapshots)
  const entitlementStore = transaction.objectStore(STORES.entitlements)
  const qrStore = transaction.objectStore(STORES.qrCodes)

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
