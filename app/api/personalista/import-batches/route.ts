import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function emailValue(value: any) {
  const email = text(value).toLowerCase()
  return email || null
}

function foodValue(value: any) {
  const food = text(value).toUpperCase()
  if (food === 'MASO') return 'MASO'
  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA') return 'DIETA'
  return 'MASO'
}

function boolValue(value: any) {
  return value === true
}

function isoDate(value: any) {
  const date = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const { data: batches, error: batchesError } = await supabaseServer
      .from('personnel_import_batches')
      .select('id, name, source_file_name, filename, status, created_at, imported_at, created_by')
      .order('created_at', { ascending: false })
      .limit(30)

    if (batchesError) {
      return NextResponse.json({ error: batchesError.message }, { status: 500 })
    }

    const batchIds = (batches || []).map((batch: any) => batch.id).filter(Boolean)
    const { data: rows, error: rowsError } = batchIds.length > 0
      ? await supabaseServer
        .from('personnel_import_rows')
        .select('batch_id, status, welcome_email_status, access_code_plain, created_user_id')
        .in('batch_id', batchIds)
      : { data: [], error: null }

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    const statsByBatch = new Map<string, {
      total: number
      imported: number
      ready: number
      error: number
      skipped: number
      codes: number
      emailsSent: number
    }>()

    for (const row of rows || []) {
      const stats = statsByBatch.get(row.batch_id) || {
        total: 0,
        imported: 0,
        ready: 0,
        error: 0,
        skipped: 0,
        codes: 0,
        emailsSent: 0
      }
      const status = String(row.status || '').toUpperCase()

      stats.total += 1
      if (status === 'IMPORTED') stats.imported += 1
      if (status === 'READY' || status === 'PENDING' || status === 'VALID') stats.ready += 1
      if (status === 'ERROR') stats.error += 1
      if (status === 'SKIP' || status === 'SKIPPED') stats.skipped += 1
      if (row.access_code_plain) stats.codes += 1
      if (row.welcome_email_status === 'SENT') stats.emailsSent += 1

      statsByBatch.set(row.batch_id, stats)
    }

    return NextResponse.json({
      ok: true,
      batches: (batches || []).map((batch: any) => ({
        id: batch.id,
        name: batch.name || batch.filename || batch.source_file_name || 'Import',
        sourceFileName: batch.source_file_name || batch.filename || '',
        status: batch.status,
        createdAt: batch.created_at,
        importedAt: batch.imported_at,
        stats: statsByBatch.get(batch.id) || {
          total: 0,
          imported: 0,
          ready: 0,
          error: 0,
          skipped: 0,
          codes: 0,
          emailsSent: 0
        }
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const body = await req.json()
    const inputRows = Array.isArray(body.rows) ? body.rows : []

    if (inputRows.length === 0) {
      return NextResponse.json({ error: 'Chybaju riadky importu.' }, { status: 400 })
    }

    if (inputRows.length > 1000) {
      return NextResponse.json({ error: 'Naraz je mozne importovat najviac 1000 riadkov.' }, { status: 400 })
    }

    const emails = inputRows.map((row: any) => emailValue(row.email)).filter(Boolean) as string[]
    const emailCounts = new Map<string, number>()
    emails.forEach(email => emailCounts.set(email, (emailCounts.get(email) || 0) + 1))

    const { data: existingUsers, error: existingUsersError } = emails.length > 0
      ? await supabaseServer
        .from('users')
        .select('email')
        .in('email', Array.from(new Set(emails)))
      : { data: [], error: null }

    if (existingUsersError) {
      return NextResponse.json({ error: existingUsersError.message }, { status: 500 })
    }

    const existingEmails = new Set((existingUsers || []).map((user: any) => String(user.email || '').toLowerCase()))

    const batchName = text(body.name) || `Import ${new Date().toLocaleString('sk-SK')}`
    const { data: batch, error: batchError } = await supabaseServer
      .from('personnel_import_batches')
      .insert({
        name: batchName,
        source: 'CSV',
        filename: text(body.sourceFileName) || null,
        source_file_name: text(body.sourceFileName) || null,
        total_rows: inputRows.length,
        created_by: currentUser.id
      })
      .select('id, name, status, created_at')
      .single()

    if (batchError || !batch) {
      return NextResponse.json({ error: batchError?.message || 'Davku sa nepodarilo vytvorit.' }, { status: 500 })
    }

    const rows = inputRows.map((row: any, index: number) => {
      const rowNumber = Number(row.rowNumber || index + 2)
      const meno = text(row.meno)
      const priezvisko = text(row.priezvisko)
      const email = emailValue(row.email)
      const validFrom = isoDate(row.validFrom)
      const validTo = isoDate(row.validTo)
      let status = text(row.status) || 'READY'
      let message = text(row.message)

      if (!meno || !priezvisko) {
        status = 'SKIP'
        message = 'Chyba meno alebo priezvisko.'
      } else if (!validFrom || !validTo || validTo < validFrom) {
        status = 'ERROR'
        message = 'Neplatne datumy od/do.'
      } else if (!boolValue(row.obed) && !boolValue(row.vecera)) {
        status = 'SKIP'
        message = 'Bez naroku na obed alebo veceru.'
      } else if (email && existingEmails.has(email)) {
        status = 'ERROR'
        message = 'E-mail uz existuje v systeme.'
      } else if (email && (emailCounts.get(email) || 0) > 1) {
        status = 'ERROR'
        message = 'Duplicitny e-mail v importe.'
      }

      if (!['READY', 'SKIP', 'ERROR'].includes(status)) {
        status = 'READY'
      }

      return {
        batch_id: batch.id,
        row_number: rowNumber,
        raw_data: row.raw || {},
        meno,
        priezvisko,
        email,
        telefon: text(row.telefon) || null,
        typ_stravy: foodValue(row.typStravy),
        registration_group_id: text(row.registrationGroupId) || null,
        valid_from: validFrom,
        valid_to: validTo,
        obed: boolValue(row.obed),
        vecera: boolValue(row.vecera),
        assign_qr: row.assignQr !== false,
        generate_access_code: row.generateAccessCode === true,
        status,
        message: message || null
      }
    })

    const { data: insertedRows, error: rowsError } = await supabaseServer
      .from('personnel_import_rows')
      .insert(rows)
      .select('id, row_number, status, message')
      .order('row_number', { ascending: true })

    if (rowsError) {
      await supabaseServer.from('personnel_import_batches').delete().eq('id', batch.id)
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      batch,
      rows: insertedRows || []
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
