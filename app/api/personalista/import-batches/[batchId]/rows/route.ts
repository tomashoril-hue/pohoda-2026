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

function isoDate(value: any) {
  const date = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const { batchId } = await params

    const { data: batch, error: batchError } = await supabaseServer
      .from('personnel_import_batches')
      .select('id, name, source_file_name, filename, status, created_at, imported_at')
      .eq('id', batchId)
      .maybeSingle()

    if (batchError) {
      return NextResponse.json({ error: batchError.message }, { status: 500 })
    }

    if (!batch) {
      return NextResponse.json({ error: 'Importna davka neexistuje.' }, { status: 404 })
    }

    const { data: rows, error: rowsError } = await supabaseServer
      .from('personnel_import_rows')
      .select(`
        id,
        row_number,
        raw_data,
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy,
        registration_group_id,
        valid_from,
        valid_to,
        obed,
        vecera,
        assign_qr,
        generate_access_code,
        access_code_plain,
        status,
        message,
        created_user_id,
        welcome_email_status
      `)
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true })
      .limit(1000)

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    const userIds = (rows || []).map((row: any) => row.created_user_id).filter(Boolean)
    const { data: codeRows, error: codeError } = userIds.length > 0
      ? await supabaseServer
        .from('user_access_codes')
        .select('user_id, access_code_plain')
        .in('user_id', userIds)
        .eq('active', true)
      : { data: [], error: null }

    if (codeError) {
      return NextResponse.json({ error: codeError.message }, { status: 500 })
    }

    const codeByUser = new Map(
      (codeRows || [])
        .filter((row: any) => row.access_code_plain)
        .map((row: any) => [row.user_id, row.access_code_plain])
    )

    return NextResponse.json({
      ok: true,
      batch: {
        id: batch.id,
        name: batch.name || batch.filename || batch.source_file_name || 'Import',
        sourceFileName: batch.source_file_name || batch.filename || '',
        status: batch.status,
        createdAt: batch.created_at,
        importedAt: batch.imported_at
      },
      rows: (rows || []).map((row: any) => ({
        id: row.id,
        rowNumber: row.row_number,
        raw: row.raw_data || {},
        meno: row.meno || '',
        priezvisko: row.priezvisko || '',
        email: row.email || '',
        telefon: row.telefon || '',
        typStravy: row.typ_stravy || 'MASO',
        registrationGroupId: row.registration_group_id || '',
        validFrom: row.valid_from || '',
        validTo: row.valid_to || '',
        obed: row.obed === true,
        vecera: row.vecera === true,
        assignQr: row.assign_qr !== false,
        generateAccessCode: row.generate_access_code === true,
        accessCode: row.access_code_plain || codeByUser.get(row.created_user_id) || '',
        status: row.status === 'IMPORTED' ? 'OK' : row.status,
        message: row.message || '',
        welcomeEmailStatus: row.welcome_email_status || ''
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const { batchId } = await params
    const body = await req.json()
    const rows = Array.isArray(body.rows) ? body.rows : []

    if (!batchId || rows.length === 0) {
      return NextResponse.json({ error: 'Chyba davka alebo riadky.' }, { status: 400 })
    }

    const { data: batch, error: batchError } = await supabaseServer
      .from('personnel_import_batches')
      .select('id, status')
      .eq('id', batchId)
      .maybeSingle()

    if (batchError) {
      return NextResponse.json({ error: batchError.message }, { status: 500 })
    }

    if (!batch) {
      return NextResponse.json({ error: 'Importna davka neexistuje.' }, { status: 404 })
    }

    if (batch.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Upravovat je mozne iba rozpracovanu davku.' }, { status: 409 })
    }

    const emails = rows.map((row: any) => emailValue(row.email)).filter(Boolean) as string[]
    const emailCounts = new Map<string, number>()
    emails.forEach(email => emailCounts.set(email, (emailCounts.get(email) || 0) + 1))

    const { data: existingUsers, error: existingError } = emails.length > 0
      ? await supabaseServer
        .from('users')
        .select('email')
        .in('email', Array.from(new Set(emails)))
      : { data: [], error: null }

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const existingEmails = new Set((existingUsers || []).map((user: any) => String(user.email || '').toLowerCase()))

    for (const row of rows) {
      const id = text(row.id)
      const meno = text(row.meno)
      const priezvisko = text(row.priezvisko)
      const email = emailValue(row.email)
      const validFrom = isoDate(row.validFrom)
      const validTo = isoDate(row.validTo)
      let status = 'READY'
      let message = ''

      if (!meno || !priezvisko) {
        status = 'SKIP'
        message = 'Chyba meno alebo priezvisko.'
      } else if (!validFrom || !validTo || validTo < validFrom) {
        status = 'ERROR'
        message = 'Neplatne datumy od/do.'
      } else if (row.obed !== true && row.vecera !== true) {
        status = 'SKIP'
        message = 'Bez naroku na obed alebo veceru.'
      } else if (email && existingEmails.has(email)) {
        status = 'ERROR'
        message = 'E-mail uz existuje v systeme.'
      } else if (email && (emailCounts.get(email) || 0) > 1) {
        status = 'ERROR'
        message = 'Duplicitny e-mail v importe.'
      }

      const { error: updateError } = await supabaseServer
        .from('personnel_import_rows')
        .update({
          meno,
          priezvisko,
          email,
          telefon: text(row.telefon) || null,
          typ_stravy: foodValue(row.typStravy),
          registration_group_id: text(row.registrationGroupId) || null,
          valid_from: validFrom,
          valid_to: validTo,
          obed: row.obed === true,
          vecera: row.vecera === true,
          assign_qr: row.assignQr !== false,
          generate_access_code: row.generateAccessCode === true,
          status,
          message: message || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('batch_id', batchId)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    const { data: updatedRows, error: selectError } = await supabaseServer
      .from('personnel_import_rows')
      .select('id, row_number, status, message')
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true })

    if (selectError) {
      return NextResponse.json({ error: selectError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, rows: updatedRows || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
