import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function welcomeEmailHtml(meno: string, loginUrl: string) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
        <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">
          PohodaPass
        </div>
        <h1 style="font-size:28px;margin:20px 0 10px;">Boli ste pridaný do stravovacieho systému</h1>
        <p>Dobrý deň${meno ? `, ${meno}` : ''},</p>
        <p>práve sme vás registrovali do stravovacieho systému aplikácie PohodaPass.</p>
        <p>Do aplikácie sa môžete prihlásiť cez svoju e-mailovú adresu.</p>
        <p style="margin:26px 0;">
          <a href="${loginUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:900;">
            Otvoriť PohodaPass
          </a>
        </p>
        <p style="font-size:13px;color:#555;">Adresa aplikácie: <a href="${loginUrl}">${loginUrl}</a></p>
      </div>
    </div>
  `
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

    const { batchId } = await params
    const body = await req.json().catch(() => ({}))
    const registrationGroupId = text(body.registrationGroupId)
    const rowIds = Array.isArray(body.rowIds)
      ? body.rowIds.map((id: any) => text(id)).filter(Boolean)
      : []
    const resend = body.resend === true

    let query = supabaseServer
      .from('personnel_import_rows')
      .select('id, batch_id, row_number, meno, priezvisko, email, registration_group_id, created_user_id, welcome_email_status')
      .eq('batch_id', batchId)
      .eq('status', 'IMPORTED')
      .not('created_user_id', 'is', null)
      .not('email', 'is', null)

    if (registrationGroupId) {
      query = query.eq('registration_group_id', registrationGroupId)
    }

    if (rowIds.length > 0) {
      query = query.in('id', rowIds)
    }

    if (!resend) {
      query = query.neq('welcome_email_status', 'SENT')
    }

    const { data: rows, error: rowsError } = await query
      .order('row_number', { ascending: true })
      .limit(200)

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 })
    }

    const loginUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/login`
    let sent = 0
    let failed = 0

    for (const row of rows || []) {
      const email = text(row.email).toLowerCase()

      if (!email) continue

      try {
        const result = await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: email,
          subject: 'Boli ste pridaný do stravovacieho systému PohodaPass',
          html: welcomeEmailHtml(row.meno || '', loginUrl),
          text: `Dobrý deň ${row.meno || ''}, boli ste pridaný do stravovacieho systému PohodaPass. Aplikáciu otvoríte na ${loginUrl}`
        })

        await supabaseServer.from('personnel_email_log').insert({
          import_batch_id: batchId,
          import_row_id: row.id,
          user_id: row.created_user_id,
          email,
          type: 'WELCOME_IMPORTED_USER',
          status: 'SENT',
          provider: result.provider,
          provider_message_id: result.messageId || null,
          sent_by: currentUser.id
        })

        await supabaseServer
          .from('personnel_import_rows')
          .update({
            welcome_email_status: 'SENT',
            welcome_email_sent_at: new Date().toISOString(),
            welcome_email_sent_by: currentUser.id,
            welcome_email_error: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id)

        sent += 1
      } catch (err: any) {
        const message = err?.message || String(err)

        await supabaseServer.from('personnel_email_log').insert({
          import_batch_id: batchId,
          import_row_id: row.id,
          user_id: row.created_user_id,
          email,
          type: 'WELCOME_IMPORTED_USER',
          status: 'FAILED',
          error_message: message,
          sent_by: currentUser.id
        })

        await supabaseServer
          .from('personnel_import_rows')
          .update({
            welcome_email_status: 'FAILED',
            welcome_email_error: message,
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id)

        failed += 1
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: rows?.length || 0
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
