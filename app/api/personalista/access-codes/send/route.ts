import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function emailValue(value: any) {
  const email = text(value).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function csvCell(value: any) {
  return `"${text(value).replace(/"/g, '""')}"`
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

async function getCurrentRegistrationGroupUserIds(registrationGroupId: string) {
  const today = slovakiaDateIso(0)

  const { data: periodRows, error: periodError } = await supabaseServer
    .from('user_registration_group_periods')
    .select('user_id')
    .eq('registration_group_id', registrationGroupId)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  if (periodError) throw periodError

  const userIds = new Set((periodRows || []).map((row: any) => row.user_id).filter(Boolean))

  const { data: fallbackUsers, error: fallbackError } = await supabaseServer
    .from('users')
    .select('id')
    .eq('registration_group_id', registrationGroupId)

  if (fallbackError) throw fallbackError

  const fallbackUserIds = (fallbackUsers || []).map((row: any) => row.id).filter(Boolean)
  const fallbackCurrentPeriods = fallbackUserIds.length > 0
    ? await supabaseServer
      .from('user_registration_group_periods')
      .select('user_id')
      .in('user_id', fallbackUserIds)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
    : { data: [], error: null }

  if (fallbackCurrentPeriods.error) throw fallbackCurrentPeriods.error

  const usersWithCurrentPeriod = new Set((fallbackCurrentPeriods.data || []).map((row: any) => row.user_id).filter(Boolean))

  fallbackUserIds.forEach((userId: string) => {
    if (!usersWithCurrentPeriod.has(userId)) userIds.add(userId)
  })

  return Array.from(userIds)
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

    const body = await req.json().catch(() => ({}))
    const recipientEmail = emailValue(body.email)
    const registrationGroupId = text(body.registrationGroupId)
    const note = text(body.note) || 'Ahoj, v prilohe posielam prihlasovacie udaje jednotlivych uzivatelov. Dobre si ich uchovaj a poskytni ich svojim kolegom.'

    if (!recipientEmail) {
      return NextResponse.json({ error: 'Zadaj platny e-mail prijemcu.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    const userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)
    const { data: users, error: usersError } = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email')
        .in('id', userIds)
        .eq('aktivny', 'ANO')
      : { data: [], error: null }

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const activeUsers = users || []
    const activeUserIds = activeUsers.map((user: any) => user.id)
    const { data: codeRows, error: codeError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_access_codes')
        .select('user_id, access_code_plain')
        .in('user_id', activeUserIds)
        .eq('active', true)
        .not('access_code_plain', 'is', null)
      : { data: [], error: null }

    if (codeError) {
      return NextResponse.json({ error: codeError.message }, { status: 500 })
    }

    const codeByUser = new Map((codeRows || []).map((row: any) => [row.user_id, row.access_code_plain]))
    const loginUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/login`
    const exportRows = activeUsers
      .map((user: any) => ({
        registrationGroup: group?.name || '',
        meno: text(user.meno),
        priezvisko: text(user.priezvisko),
        email: text(user.email),
        accessCode: text(codeByUser.get(user.id)),
        loginUrl
      }))
      .filter(row => row.accessCode)
      .sort((a, b) => `${a.priezvisko} ${a.meno}`.localeCompare(`${b.priezvisko} ${b.meno}`, 'sk'))

    if (exportRows.length === 0) {
      return NextResponse.json({ error: 'V tejto registracnej skupine nie je ziadny aktivny pristupovy kod.' }, { status: 404 })
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
    const filename = `${fileSafe(group?.name || 'registracna-skupina')}-${new Date().toISOString().slice(0, 10)}.csv`
    const result = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: recipientEmail,
      subject: 'PohodaPass - prihlasovacie udaje',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
          <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
            <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">PohodaPass</div>
            <h1 style="font-size:26px;margin:20px 0 10px;">Prihlasovacie udaje</h1>
            <p>${htmlEscape(note)}</p>
            <p>V prilohe je CSV tabulka s pristupovymi kodmi. Prihlasenie je dostupne na:</p>
            <p><a href="${loginUrl}">${loginUrl}</a></p>
            <p style="font-size:13px;color:#555;">Pocet odoslanych pristupov: ${exportRows.length}</p>
          </div>
        </div>
      `,
      text: `${note}\n\nPrihlasenie: ${loginUrl}\nPocet pristupov: ${exportRows.length}`,
      attachments: [{
        filename,
        content: Buffer.from(`\uFEFF${csv}`, 'utf8').toString('base64'),
        contentType: 'text/csv; charset=utf-8'
      }]
    })

    await supabaseServer.from('personnel_email_log').insert({
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
