import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAccessCode, hashAccessCode, normalizeAccessName } from '@/lib/accessCode'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

type ImportResult = {
  rowNumber: number
  ok: boolean
  status: 'OK' | 'ERROR'
  userId?: string
  accessCode?: string | null
  message: string
}

type PreparedRow = {
  rowNumber: number
  userId: string
  isExistingUser: boolean
  meno: string
  priezvisko: string
  email: string | null
  telefon: string | null
  typStravy: string
  validFrom: string
  validTo: string
  dates: string[]
  registrationGroupId: string | null
  generateAccessCode: boolean
  accessCodePlain: string | null
  obed: boolean
  vecera: boolean
  assignQr: boolean
  selfOrdering: boolean
  shouldSetBaseRegistrationGroup: boolean
}

type ExistingUser = {
  id: string
  email: string | null
  qr_code: string | null
  registration_group_id: string | null
}

function normalizeText(value: any) {
  return String(value || '').trim()
}

function normalizeEmail(value: any) {
  const email = normalizeText(value).toLowerCase()
  return email || null
}

function normalizeFood(value: any) {
  const food = normalizeText(value).toUpperCase()

  if (food === 'MASO') return 'MASO'
  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA' || food === 'DIÄ‚â€°TA') return 'DIETA'

  return ''
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`)
  }

  return dates
}

function errorResult(rowNumber: number, message: string): ImportResult {
  return {
    rowNumber,
    ok: false,
    status: 'ERROR',
    message
  }
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function periodOverlaps(period: any, validFrom: string, validTo: string | null) {
  const existingTo = period.valid_to || '9999-12-31'
  const newTo = validTo || '9999-12-31'

  return validFrom <= existingTo && period.valid_from <= newTo
}

async function insertInChunks(table: string, rows: any[], size = 1000) {
  for (const chunk of chunkArray(rows, size)) {
    if (chunk.length === 0) continue

    const { error } = await supabaseServer
      .from(table)
      .insert(chunk)

    if (error) throw error
  }
}

async function rollbackUsers(userIds: string[]) {
  if (userIds.length === 0) return

  for (const chunk of chunkArray(userIds, 200)) {
    await supabaseServer
      .from('users')
      .delete()
      .in('id', chunk)
  }
}

async function refreshCurrentRegistrationGroups(userIds: string[]) {
  const today = slovakiaDateIso()
  const activeRows: any[] = []

  for (const userIdChunk of chunkArray(userIds, 250)) {
    const { data, error } = await supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to, note')
      .in('user_id', userIdChunk)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('valid_from', { ascending: false })

    if (error) throw error

    activeRows.push(...(data || []))
  }

  const currentByUserId = new Map<string, any>()

  activeRows.forEach(row => {
    if (!currentByUserId.has(row.user_id)) currentByUserId.set(row.user_id, row)
  })

  return currentByUserId
}

function prepareRow(
  row: any,
  activeRegistrationGroupIds: Set<string>,
  existingUsersByEmail: Map<string, ExistingUser>,
  duplicateImportEmails: Set<string>,
  selfOrderingImport: boolean
): { prepared?: PreparedRow; result?: ImportResult } {
  const rowNumber = Number(row.rowNumber || 0)
  const meno = normalizeText(row.meno)
  const priezvisko = normalizeText(row.priezvisko)
  const email = normalizeEmail(row.email)
  const telefon = normalizeText(row.telefon) || null
  const typStravy = selfOrderingImport ? normalizeFood(row.typStravy || 'MASO') : normalizeFood(row.typStravy)
  const validFrom = normalizeText(row.validFrom)
  const validTo = normalizeText(row.validTo)
  const registrationGroupId = normalizeText(row.registrationGroupId) || null
  const generateAccessCode = row.generateAccessCode === true
  const obed = !!row.obed
  const vecera = !!row.vecera
  const assignQr = row.assignQr !== false
  const hasAnyPeriodDate = !!validFrom || !!validTo
  const hasValidPeriod = isIsoDate(validFrom) && isIsoDate(validTo) && validTo >= validFrom

  if (!meno || !priezvisko) return { result: errorResult(rowNumber, 'Meno a priezvisko su povinne.') }
  if (!email) return { result: errorResult(rowNumber, 'E-mail je povinny.') }
  if (!typStravy) return { result: errorResult(rowNumber, 'Vyber typ stravy.') }
  if (selfOrderingImport && !registrationGroupId) return { result: errorResult(rowNumber, 'Registracna skupina je povinna.') }
  if (!selfOrderingImport && (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom)) return { result: errorResult(rowNumber, 'Zadaj platne obdobie prace.') }
  if (selfOrderingImport && hasAnyPeriodDate && !hasValidPeriod) return { result: errorResult(rowNumber, 'Ak zadavas obdobie, zadaj platne datumy od/do.') }
  if (!selfOrderingImport && !obed && !vecera) return { result: errorResult(rowNumber, 'Vyber aspon jeden narok na stravu.') }
  if (selfOrderingImport && hasValidPeriod && !obed && !vecera) return { result: errorResult(rowNumber, 'Ak zadavas obdobie, vyber aspon jeden narok na stravu.') }
  if (registrationGroupId && !activeRegistrationGroupIds.has(registrationGroupId)) return { result: errorResult(rowNumber, 'Registracna skupina neexistuje.') }
  if (email && duplicateImportEmails.has(email)) return { result: errorResult(rowNumber, 'Duplicita e-mailu v importovanom subore.') }

  const dates = (!selfOrderingImport || hasValidPeriod) ? dateRange(validFrom, validTo) : []

  if (dates.length > 120) return { result: errorResult(rowNumber, 'Obdobie moze mat najviac 120 dni.') }

  const accessCodePlain = generateAccessCode ? createAccessCode() : null
  const existingUser = email ? existingUsersByEmail.get(email) || null : null
  const shouldSetBaseRegistrationGroup = !!existingUser && !!registrationGroupId && !existingUser.registration_group_id

  return {
    prepared: {
      rowNumber,
      userId: existingUser?.id || crypto.randomUUID(),
      isExistingUser: !!existingUser,
      meno,
      priezvisko,
      email,
      telefon,
      typStravy,
      validFrom,
      validTo,
      dates,
      registrationGroupId,
      generateAccessCode: existingUser ? false : generateAccessCode,
      accessCodePlain: existingUser ? null : accessCodePlain,
      obed,
      vecera,
      assignQr: existingUser ? assignQr && !existingUser.qr_code : assignQr,
      selfOrdering: selfOrderingImport,
      shouldSetBaseRegistrationGroup
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const globalAccess = await getGlobalAccess(currentUser.id)

    if (!globalAccess.canUsePersonalista) {
      return NextResponse.json({ error: 'Personalistiku moze pouzivat iba ADMIN alebo PERSONALISTA.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const rows = Array.isArray(body.rows) ? body.rows : []
    const selfOrderingImport = body.selfOrdering === true

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nie je co importovat.' }, { status: 400 })
    }

    if (rows.length > 300) {
      return NextResponse.json({ error: 'Naraz je mozne importovat najviac 300 riadkov.' }, { status: 400 })
    }

    const { data: registrationGroups, error: registrationGroupsError } = await supabaseServer
      .from('registration_groups')
      .select('id')
      .eq('active', true)

    if (registrationGroupsError) {
      return NextResponse.json({ error: registrationGroupsError.message }, { status: 500 })
    }

    const activeRegistrationGroupIds = new Set((registrationGroups || []).map((group: any) => group.id).filter(Boolean))
    const importEmails = rows.map((row: any) => normalizeEmail(row.email)).filter(Boolean) as string[]
    const emails = Array.from(new Set(importEmails))
    const { data: existingEmailRows, error: existingEmailError } = emails.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, email, qr_code, registration_group_id')
        .in('email', emails)
      : { data: [], error: null }

    if (existingEmailError) {
      return NextResponse.json({ error: existingEmailError.message }, { status: 500 })
    }

    const existingUsersByEmail = new Map<string, ExistingUser>()

    ;(existingEmailRows || []).forEach((row: any) => {
      const email = normalizeEmail(row.email)
      if (!email) return

      existingUsersByEmail.set(email, {
        id: row.id,
        email,
        qr_code: row.qr_code || null,
        registration_group_id: row.registration_group_id || null
      })
    })

    const seenImportEmails = new Set<string>()
    const duplicateImportEmails = new Set<string>()

    importEmails.forEach(email => {
      if (seenImportEmails.has(email)) duplicateImportEmails.add(email)
      seenImportEmails.add(email)
    })

    const results: ImportResult[] = []
    const preparedRows: PreparedRow[] = []

    rows.forEach((row: any) => {
      const { prepared, result } = prepareRow(row, activeRegistrationGroupIds, existingUsersByEmail, duplicateImportEmails, selfOrderingImport)

      if (result) {
        results.push(result)
        return
      }

      if (prepared) preparedRows.push(prepared)
    })

    const periodRowsToCheck = preparedRows.filter(row => row.registrationGroupId && row.dates.length > 0)

    if (periodRowsToCheck.length > 0) {
      const uniqueUserIds = Array.from(new Set(periodRowsToCheck.map(row => row.userId)))
      const existingPeriods: any[] = []

      for (const userIdChunk of chunkArray(uniqueUserIds, 250)) {
        const { data, error } = await supabaseServer
          .from('user_registration_group_periods')
          .select('id, user_id, registration_group_id, valid_from, valid_to')
          .in('user_id', userIdChunk)
          .order('valid_from', { ascending: true })

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        existingPeriods.push(...(data || []))
      }

      const periodsByUserId = new Map<string, any[]>()

      existingPeriods.forEach(period => {
        const list = periodsByUserId.get(period.user_id) || []
        list.push(period)
        periodsByUserId.set(period.user_id, list)
      })

      const conflictingRowNumbers = new Set<number>()

      periodRowsToCheck.forEach(row => {
        const overlaps = (periodsByUserId.get(row.userId) || [])
          .filter(period => periodOverlaps(period, row.validFrom, row.validTo))

        if (overlaps.length === 0) return

        conflictingRowNumbers.add(row.rowNumber)
        const firstOverlap = overlaps[0]
        const overlapTo = firstOverlap.valid_to || 'bez konca'
        results.push(errorResult(
          row.rowNumber,
          `Obdobie sa prekryva s existujucim zaradenim (${firstOverlap.valid_from} - ${overlapTo}). Uprav datumy.`
        ))
      })

      for (let index = preparedRows.length - 1; index >= 0; index -= 1) {
        if (conflictingRowNumbers.has(preparedRows[index].rowNumber)) {
          preparedRows.splice(index, 1)
        }
      }
    }

    if (preparedRows.length === 0) {
      return NextResponse.json({
        ok: false,
        imported: 0,
        failed: results.length,
        results: results.sort((a, b) => a.rowNumber - b.rowNumber)
      })
    }

    const now = new Date().toISOString()
    const newRows = preparedRows.filter(row => !row.isExistingUser)
    const existingRows = preparedRows.filter(row => row.isExistingUser)
    const insertedUserIds = newRows.map(row => row.userId)

    try {
      await insertInChunks('users', newRows.map(row => ({
        id: row.userId,
        meno: row.meno,
        priezvisko: row.priezvisko,
        email: row.email,
        telefon: row.telefon,
        typ_stravy: row.typStravy,
        qr_code: null,
        zdroj: 'PERSONALISTA',
        aktivny: 'ANO',
        registration_group_id: row.registrationGroupId,
        self_ordering_required: row.selfOrdering,
        self_ordering_opened_at: null,
        self_ordering_completed_at: null,
        manual_created_by: currentUser.id,
        updated_at: now
      })), 300)

      const existingSelfOrderingRows = existingRows.filter(row => row.selfOrdering)

      if (existingSelfOrderingRows.length > 0) {
        for (const userIdChunk of chunkArray(existingSelfOrderingRows.map(row => row.userId), 250)) {
          const { error: updateSelfOrderingError } = await supabaseServer
            .from('users')
            .update({
              self_ordering_required: true,
              updated_at: now
            })
            .in('id', userIdChunk)

          if (updateSelfOrderingError) throw updateSelfOrderingError
        }
      }

      const existingRowsWithoutBaseGroup = existingRows.filter(row => row.shouldSetBaseRegistrationGroup && row.registrationGroupId)

      for (const row of existingRowsWithoutBaseGroup) {
        const { error: updateBaseGroupError } = await supabaseServer
          .from('users')
          .update({
            registration_group_id: row.registrationGroupId,
            updated_at: now
          })
          .eq('id', row.userId)
          .is('registration_group_id', null)

        if (updateBaseGroupError) throw updateBaseGroupError
      }

      const registrationPeriodRows = preparedRows
        .filter(row => row.registrationGroupId && row.dates.length > 0)
        .map(row => ({
          user_id: row.userId,
          registration_group_id: row.registrationGroupId,
          valid_from: row.validFrom,
          valid_to: row.validTo,
          note: 'Zaradene pri importe osoby.',
          created_by: currentUser.id
        }))

      await insertInChunks('user_registration_group_periods', registrationPeriodRows, 500)

      await insertInChunks('personnel_work_periods', preparedRows.filter(row => row.dates.length > 0).map(row => ({
        user_id: row.userId,
        valid_from: row.validFrom,
        valid_to: row.validTo,
        source: 'MANUAL',
        created_by: currentUser.id,
        updated_by: currentUser.id
      })), 500)

      const entitlementRows = preparedRows.filter(row => row.dates.length > 0).flatMap(row => (
        row.dates.map(datum => ({
          user_id: row.userId,
          datum,
          obed: row.obed,
          vecera: row.vecera,
          source: 'PERSONALISTA',
          created_by: currentUser.id,
          updated_by: currentUser.id,
          updated_at: now
        }))
      ))

      for (const row of preparedRows.filter(item => item.dates.length > 0)) {
        for (const dateChunk of chunkArray(row.dates, 120)) {
          const { error: deleteEntitlementError } = await supabaseServer
            .from('user_food_entitlements')
            .delete()
            .eq('user_id', row.userId)
            .in('datum', dateChunk)

          if (deleteEntitlementError) throw deleteEntitlementError
        }
      }

      await insertInChunks('user_food_entitlements', entitlementRows, 1000)

      await refreshCurrentRegistrationGroups(Array.from(new Set(preparedRows.map(row => row.userId))))

      const selfOrderingRoleRows = preparedRows
        .filter(row => row.selfOrdering)
        .map(row => ({
          user_id: row.userId,
          role: 'SAMOSTATNE_OBJEDNAVANIE_STRAVY',
          active: true,
          created_by: currentUser.id,
          updated_at: now
        }))

      if (selfOrderingRoleRows.length > 0) {
        const { error: selfOrderingRoleError } = await supabaseServer
          .from('app_user_roles')
          .upsert(selfOrderingRoleRows, {
            onConflict: 'user_id,role'
          })

        if (selfOrderingRoleError) throw selfOrderingRoleError
      }

      const accessCodeRows = preparedRows
        .filter(row => row.generateAccessCode && row.accessCodePlain)
        .map(row => ({
          user_id: row.userId,
          code_hash: hashAccessCode(row.meno, row.priezvisko, row.accessCodePlain || ''),
          access_code_plain: row.accessCodePlain,
          meno_key: normalizeAccessName(row.meno),
          priezvisko_key: normalizeAccessName(row.priezvisko),
          label: 'Importny pristupovy kod',
          created_by: currentUser.id
        }))

      await insertInChunks('user_access_codes', accessCodeRows, 500)

      const qrUserIds = preparedRows
        .filter(row => row.assignQr)
        .map(row => row.userId)

      let assignedQrByUserId = new Map<string, string>()

      if (qrUserIds.length > 0) {
        const { data: assignedQrRows, error: assignQrError } = await supabaseServer
          .rpc('assign_free_qr_to_users_bulk', {
            p_user_ids: qrUserIds,
            p_assigned_by: currentUser.id,
            p_note: 'Priradene z tabulky qr_codes pri importe osoby.'
          })

        if (assignQrError) {
          const message = assignQrError.message.includes('NO_FREE_QR_AVAILABLE')
            ? 'Nie je dostupny dostatocny pocet volnych QR kodov.'
            : assignQrError.message
          throw new Error(message)
        }

        assignedQrByUserId = new Map((assignedQrRows || []).map((row: any) => [row.user_id, row.qr_code]))
      }

      const auditRows = preparedRows.map(row => ({
        actor_user_id: currentUser.id,
        target_user_id: row.userId,
        group_id: null,
        action: row.isExistingUser ? 'PERSON_IMPORT_PERIOD_ADDED' : 'PERSON_CREATED',
        entity_table: row.isExistingUser ? 'user_registration_group_periods' : 'users',
        entity_id: row.userId,
        after_data: {
          meno: row.meno,
          priezvisko: row.priezvisko,
          email: row.email,
          telefon: row.telefon,
          typ_stravy: row.typStravy,
          registration_group_id: row.registrationGroupId,
          valid_from: row.validFrom,
          valid_to: row.validTo,
          obed: row.obed,
          vecera: row.vecera,
          qr_assigned: row.assignQr && assignedQrByUserId.has(row.userId),
          access_code_generated: !!row.accessCodePlain,
          self_ordering: row.selfOrdering,
          existing_user: row.isExistingUser,
          import_bulk: true
        }
      }))

      for (const chunk of chunkArray(auditRows, 500)) {
        const { error: auditError } = await supabaseServer
          .from('personnel_audit_log')
          .insert(chunk)

        if (auditError) {
          console.warn('Failed to write import audit rows.', auditError)
          break
        }
      }

      preparedRows.forEach(row => {
        results.push({
          rowNumber: row.rowNumber,
          ok: true,
          status: 'OK',
          userId: row.userId,
          accessCode: row.accessCodePlain,
          message: row.isExistingUser
            ? 'Doplnene dalsie zaradenie existujucej osobe.'
            : (row.selfOrdering ? 'Importovane pre samostatne objednavanie stravy.' : 'Importovane.')
        })
      })
    } catch (err: any) {
      await rollbackUsers(insertedUserIds)

      const message = err?.message || 'Import zlyhal.'
      preparedRows.forEach(row => {
        results.push(errorResult(row.rowNumber, message))
      })
    }

    const sortedResults = results.sort((a, b) => a.rowNumber - b.rowNumber)
    const imported = sortedResults.filter(result => result.ok).length
    const failed = sortedResults.length - imported

    return NextResponse.json({
      ok: failed === 0,
      imported,
      failed,
      results: sortedResults
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
