import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAccessCode, hashAccessCode, normalizeAccessName } from '@/lib/accessCode'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

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
  if (food === 'DIETA' || food === 'DIĂ‰TA') return 'DIETA'

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

function errorResult(rowNumber: number, message: string) {
  return {
    rowNumber,
    ok: false,
    status: 'ERROR',
    message
  }
}

async function createImportedPerson({
  row,
  currentUserId,
  activeRegistrationGroupIds,
  existingEmails
}: {
  row: any
  currentUserId: string
  activeRegistrationGroupIds: Set<string>
  existingEmails: Set<string>
}) {
  const rowNumber = Number(row.rowNumber || 0)
  const meno = normalizeText(row.meno)
  const priezvisko = normalizeText(row.priezvisko)
  const email = normalizeEmail(row.email)
  const telefon = normalizeText(row.telefon) || null
  const typStravy = normalizeFood(row.typStravy)
  const validFrom = normalizeText(row.validFrom)
  const validTo = normalizeText(row.validTo)
  const importNote = normalizeText(row.importNote)
  const registrationGroupId = normalizeText(row.registrationGroupId) || null
  const generateAccessCode = row.generateAccessCode === true
  const obed = !!row.obed
  const vecera = !!row.vecera
  const assignQr = row.assignQr !== false

  if (!meno || !priezvisko) return errorResult(rowNumber, 'Meno a priezvisko su povinne.')
  if (!typStravy) return errorResult(rowNumber, 'Vyber typ stravy.')
  if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) return errorResult(rowNumber, 'Zadaj platne obdobie prace.')
  if (!obed && !vecera) return errorResult(rowNumber, 'Vyber aspon jeden narok na stravu.')

  const dates = dateRange(validFrom, validTo)

  if (dates.length > 120) return errorResult(rowNumber, 'Obdobie moze mat najviac 120 dni.')
  if (registrationGroupId && !activeRegistrationGroupIds.has(registrationGroupId)) return errorResult(rowNumber, 'Registracna skupina neexistuje.')
  if (email && existingEmails.has(email)) return errorResult(rowNumber, 'Pouzivatel s tymto emailom uz existuje.')

  const now = new Date().toISOString()
  let assignedQrCode: string | null = null
  let accessCodePlain: string | null = null

  const { data: newUser, error: userError } = await supabaseServer
    .from('users')
    .insert({
      meno,
      priezvisko,
      email,
      telefon,
      typ_stravy: typStravy,
      qr_code: null,
      zdroj: 'PERSONALISTA',
      aktivny: 'ANO',
      registration_group_id: registrationGroupId,
      personal_note: importNote || null,
      manual_created_by: currentUserId,
      updated_at: now
    })
    .select('id, meno, priezvisko, email')
    .single()

  if (userError || !newUser) {
    return errorResult(rowNumber, userError?.message || 'Osobu sa nepodarilo vytvorit.')
  }

  const rollbackUser = async () => {
    await supabaseServer.from('user_access_codes').delete().eq('user_id', newUser.id)
    await supabaseServer.from('user_qr_codes').delete().eq('user_id', newUser.id)
    await supabaseServer.from('users').delete().eq('id', newUser.id)
  }

  if (registrationGroupId) {
    const { error } = await supabaseServer
      .from('user_registration_group_periods')
      .insert({
        user_id: newUser.id,
        registration_group_id: registrationGroupId,
        valid_from: validFrom,
        valid_to: validTo,
        note: 'Zaradene pri importe osoby.',
        created_by: currentUserId
      })

    if (error) {
      await rollbackUser()
      return errorResult(rowNumber, error.message)
    }
  }

  const { error: workPeriodError } = await supabaseServer
    .from('personnel_work_periods')
    .insert({
      user_id: newUser.id,
      valid_from: validFrom,
      valid_to: validTo,
      source: 'MANUAL',
      created_by: currentUserId,
      updated_by: currentUserId
    })

  if (workPeriodError) {
    await rollbackUser()
    return errorResult(rowNumber, workPeriodError.message)
  }

  const { error: entitlementError } = await supabaseServer
    .from('user_food_entitlements')
    .insert(dates.map(datum => ({
      user_id: newUser.id,
      datum,
      obed,
      vecera,
      source: 'PERSONALISTA',
      created_by: currentUserId,
      updated_by: currentUserId,
      updated_at: now
    })))

  if (entitlementError) {
    await rollbackUser()
    return errorResult(rowNumber, entitlementError.message)
  }

  if (assignQr) {
    const { data: assignedQrRows, error: assignQrError } = await supabaseServer
      .rpc('assign_free_qr_to_user', {
        p_user_id: newUser.id,
        p_assigned_by: currentUserId,
        p_note: 'Priradene z tabulky qr_codes pri importe osoby.'
      })

    if (assignQrError) {
      await rollbackUser()
      return errorResult(rowNumber, assignQrError.message || 'Volny QR kod sa nepodarilo priradit.')
    }

    const assignedQr = Array.isArray(assignedQrRows) ? assignedQrRows[0] : assignedQrRows

    if (!assignedQr) {
      await rollbackUser()
      return errorResult(rowNumber, 'Nie je dostupny ziadny volny nepriradeny QR kod.')
    }

    assignedQrCode = assignedQr.qr_code
  }

  if (generateAccessCode) {
    accessCodePlain = createAccessCode()

    const { error: accessCodeError } = await supabaseServer
      .from('user_access_codes')
      .insert({
        user_id: newUser.id,
        code_hash: hashAccessCode(meno, priezvisko, accessCodePlain),
        access_code_plain: accessCodePlain,
        meno_key: normalizeAccessName(meno),
        priezvisko_key: normalizeAccessName(priezvisko),
        label: 'Importny pristupovy kod',
        created_by: currentUserId
      })

    if (accessCodeError) {
      await rollbackUser()
      return errorResult(rowNumber, accessCodeError.message || 'Pristupovy kod sa nepodarilo vytvorit.')
    }
  }

  await supabaseServer
    .from('personnel_audit_log')
    .insert({
      actor_user_id: currentUserId,
      target_user_id: newUser.id,
      group_id: null,
      action: 'PERSON_CREATED',
      entity_table: 'users',
      entity_id: newUser.id,
      after_data: {
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy: typStravy,
        registration_group_id: registrationGroupId,
        valid_from: validFrom,
        valid_to: validTo,
        import_note: importNote,
        obed,
        vecera,
        qr_assigned: !!assignedQrCode,
        access_code_generated: !!accessCodePlain,
        import_bulk: true
      }
    })

  if (email) existingEmails.add(email)

  return {
    rowNumber,
    ok: true,
    status: 'OK',
    userId: newUser.id,
    accessCode: accessCodePlain,
    message: 'Importovane.'
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
        .select('email')
        .in('email', emails)
      : { data: [], error: null }

    if (existingEmailError) {
      return NextResponse.json({ error: existingEmailError.message }, { status: 500 })
    }

    const existingEmails = new Set((existingEmailRows || []).map((row: any) => normalizeEmail(row.email)).filter(Boolean) as string[])
    const seenImportEmails = new Set<string>()
    const duplicateImportEmails = new Set<string>()

    importEmails.forEach(email => {
      if (seenImportEmails.has(email)) duplicateImportEmails.add(email)
      seenImportEmails.add(email)
    })

    const results = []

    for (const row of rows) {
      const rowNumber = Number(row.rowNumber || 0)
      const email = normalizeEmail(row.email)

      if (email && duplicateImportEmails.has(email)) {
        results.push(errorResult(rowNumber, 'Duplicita e-mailu v importovanom subore.'))
        continue
      }

      results.push(await createImportedPerson({
        row,
        currentUserId: currentUser.id,
        activeRegistrationGroupIds,
        existingEmails
      }))
    }

    const imported = results.filter(result => result.ok).length
    const failed = results.length - imported

    return NextResponse.json({
      ok: failed === 0,
      imported,
      failed,
      results
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
