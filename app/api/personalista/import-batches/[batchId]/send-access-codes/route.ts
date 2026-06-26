import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { checkActorRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function emailValue(value: any) {
  const email = text(value).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function csvCell(value: any) {
  const safe = text(value).replace(/"/g, '""')
  return `"${safe}"`
}

function htmlEscape(value: any) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fileSafe(value: any) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pristupove-kody'
}

export async function POST(
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

    const sendLimit = checkActorRateLimit(currentUser.id, 'import-access-codes-email', 5, 10 * 60 * 1000)
    if (!sendLimit.ok) return rateLimitResponse(sendLimit, 'Prilis vela odoslanych exportov. Skuste znova neskor.')

    const { batchId } = await params
    const body = await req.json().catch(() => ({}))
    const recipientEmail = emailValue(body.email)
    const registrationGroupId = text(body.registrationGroupId)
    const note = text(body.note)
    const rowIds = Array.isArray(body.rowIds)
      ? body.rowIds.map((id: any) => text(id)).filter(Boolean)
      : []

    if (!recipientEmail) {
      return NextResponse.json({ error: 'Zadaj platny e-mail prijemcu.' }, { status: 400 })
    }

    let query = supabaseServer
      .from('personnel_import_rows')
      .select('id, row_number, meno, priezvisko, email, registration_group_id, access_code_plain, created_user_id')
      .eq('batch_id', batchId)
      .eq('status', 'IMPORTED')
      .not('created_user_id', 'is', null)
      .order('row_number', { ascending: true })
      .limit(500)

    if (registrationGroupId) {
      query = query.eq('registration_group_id', registrationGroupId)
    }

    if (rowIds.length > 0) {
      query = query.in('id', rowIds)
    }

    const { data: rows, error: rowsError } = await query

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    const importedRows = rows || []
    const userIds = importedRows.map((row: any) => row.created_user_id).filter(Boolean)

    const { data: codeRows, error: codesError } = userIds.length > 0
      ? await supabaseServer
        .from('user_access_codes')
        .select('user_id, access_code_plain')
        .in('user_id', userIds)
        .eq('active', true)
      : { data: [], error: null }

    if (codesError) {
      return NextResponse.json({ error: codesError.message }, { status: 500 })
    }

    const codeByUser = new Map(
      (codeRows || [])
        .filter((row: any) => row.access_code_plain)
        .map((row: any) => [row.user_id, row.access_code_plain])
    )

    const groupIds = Array.from(new Set(importedRows.map((row: any) => row.registration_group_id).filter(Boolean)))
    const { data: groupRows, error: groupsError } = groupIds.length > 0
      ? await supabaseServer
        .from('registration_groups')
        .select('id, name')
        .in('id', groupIds)
      : { data: [], error: null }

    if (groupsError) {
      return NextResponse.json({ error: groupsError.message }, { status: 500 })
    }

    const groupById = new Map((groupRows || []).map((group: any) => [group.id, group.name]))
    const loginUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/login`
    const exportRows = importedRows
      .map((row: any) => ({
        meno: text(row.meno),
        priezvisko: text(row.priezvisko),
        email: text(row.email),
        registrationGroup: groupById.get(row.registration_group_id) || '',
        accessCode: text(row.access_code_plain) || text(codeByUser.get(row.created_user_id)),
        loginUrl
      }))
      .filter(row => row.accessCode)

    if (exportRows.length === 0) {
      return NextResponse.json({ error: 'Nenasiel sa ziadny exportovatelny pristupovy kod.' }, { status: 404 })
    }

    const csv = [
      ['Registracna skupina', 'Meno', 'Priezvisko', 'Email', 'Prihlasovaci kod', 'Login URL']
        .map(csvCell)
        .join(';'),
      ...exportRows.map(row => [
        row.registrationGroup,
        row.meno,
        row.priezvisko,
        row.email,
        row.accessCode,
        row.loginUrl
      ].map(csvCell).join(';'))
    ].join('\r\n')
    const csvWithBom = `\uFEFF${csv}`
    const filenameBase = registrationGroupId
      ? fileSafe(groupById.get(registrationGroupId) || 'registracna-skupina')
      : 'pristupove-kody'
    const filename = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.csv`
    const subject = 'PohodaPass - prihlasovacie udaje'
    const safeNote = note || 'Ahoj, v prilohe posielam prihlasovacie udaje jednotlivych uzivatelov. Dobre si ich uchovaj a poskytni ich svojim kolegom.'
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
        <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
          <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">
            PohodaPass
          </div>
          <h1 style="font-size:26px;margin:20px 0 10px;">Prihlasovacie udaje</h1>
          <p>${htmlEscape(safeNote)}</p>
          <p>V prilohe je CSV tabulka s pristupovymi kodmi. Prihlasenie je dostupne na:</p>
          <p><a href="${loginUrl}">${loginUrl}</a></p>
          <p style="font-size:13px;color:#555;">Pocet odoslanych pristupov: ${exportRows.length}</p>
        </div>
      </div>
    `

    const result = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: recipientEmail,
      subject,
      html,
      text: `${safeNote}\n\nPrihlasenie: ${loginUrl}\nPocet pristupov: ${exportRows.length}`,
      attachments: [{
        filename,
        content: Buffer.from(csvWithBom, 'utf8').toString('base64'),
        contentType: 'text/csv; charset=utf-8'
      }]
    })

    await supabaseServer.from('personnel_email_log').insert({
      import_batch_id: batchId,
      email: recipientEmail,
      type: 'ACCESS_CODES_EXPORT',
      status: 'SENT',
      provider: result.provider,
      provider_message_id: result.messageId || null,
      sent_by: currentUser.id
    })

    return NextResponse.json({
      ok: true,
      sent: true,
      count: exportRows.length,
      filename
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
