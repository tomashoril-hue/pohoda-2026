import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
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

function foodLabel(value: any) {
  const normalized = text(value).toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIĂ‰TA') return 'DIETA'

  return 'NEZADANE'
}

function fullName(user: any) {
  return `${text(user?.meno)} ${text(user?.priezvisko)}`.trim() || text(user?.email) || 'Bez mena'
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function buildQrPrintHtml({
  title,
  groupName,
  items
}: {
  title: string
  groupName: string
  items: Array<{
    userId: string
    fullName: string
    food: string
    qrCode: string
  }>
}) {
  const qrImages = new Map<string, string>()

  await Promise.all(items.map(async item => {
    const image = await QRCode.toDataURL(item.qrCode, {
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M'
    })

    qrImages.set(item.userId, image)
  }))

  const pages = chunkItems(items, 20)
  const pageHtml = pages.map((pageItems, pageIndex) => `
    <section class="print-sheet">
      <header class="sheet-header">
        <b>${htmlEscape(title)}</b>
        <span>Strana ${pageIndex + 1} / ${pages.length}</span>
      </header>
      <div class="print-grid">
        ${pageItems.map(item => `
          <article class="card">
            <div class="qr-box">
              <img src="${qrImages.get(item.userId)}" alt="QR kod">
            </div>
            <div class="person-name">${htmlEscape(item.fullName)}</div>
            <div class="meta">${htmlEscape(groupName)}</div>
            <div class="food">${htmlEscape(foodLabel(item.food))}</div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('')

  return `<!doctype html>
<html lang="sk">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e5e7eb; color: #111827; font-family: Arial, Helvetica, sans-serif; }
    .toolbar { max-width: 980px; margin: 12px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .toolbar b { display: block; font-size: 16px; }
    .toolbar span { display: block; margin-top: 3px; font-size: 12px; font-weight: 800; color: #6b7280; }
    .print-sheet { width: 190mm; min-height: 277mm; margin: 0 auto 12px auto; background: #fff; padding: 5mm; break-after: page; page-break-after: always; }
    .print-sheet:last-child { break-after: auto; page-break-after: auto; }
    .sheet-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 3mm; margin-bottom: 3mm; font-size: 12px; }
    .print-grid { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 47mm; gap: 2.5mm; }
    .card { border: 1px solid #d1d5db; border-radius: 5px; padding: 2mm; display: grid; grid-template-rows: 25mm auto auto auto; align-items: center; text-align: center; overflow: hidden; }
    .qr-box img { width: 24mm; height: 24mm; display: block; margin: 0 auto; }
    .person-name { font-size: 10px; line-height: 1.12; font-weight: 900; overflow: hidden; }
    .meta { font-size: 8px; line-height: 1.12; font-weight: 800; color: #6b7280; overflow: hidden; }
    .food { justify-self: center; margin-top: 1mm; border-radius: 999px; padding: 1mm 2mm; background: #eef2ff; color: #3730a3; font-size: 8px; font-weight: 950; }
    @media print {
      body { background: #fff; }
      .toolbar { display: none; }
      .print-sheet { margin: 0 auto; min-height: auto; }
      .print-grid { grid-auto-rows: 47mm; gap: 2.5mm; }
    }
  </style>
</head>
<body>
  <section class="toolbar">
    <div>
      <b>${htmlEscape(title)}</b>
      <span>${items.length} QR pripravenych na tlac. Subor otvor a vytlac cez prehliadac.</span>
    </div>
  </section>
  ${pageHtml}
</body>
</html>`
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
    const includeAccessCodes = body.includeAccessCodes !== false
    const includeQrCodes = body.includeQrCodes === true

    if (!recipientEmail) {
      return NextResponse.json({ error: 'Zadaj platny e-mail prijemcu.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (!includeAccessCodes && !includeQrCodes) {
      return NextResponse.json({ error: 'Vyber aspon jednu prilohu.' }, { status: 400 })
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
        .select('id, meno, priezvisko, email, typ_stravy')
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
    const { data: qrRows, error: qrError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_qr_codes')
        .select('user_id, qr_code')
        .in('user_id', activeUserIds)
        .eq('active', true)
      : { data: [], error: null }

    if (qrError) {
      return NextResponse.json({ error: qrError.message }, { status: 500 })
    }

    const qrByUser = new Map((qrRows || []).map((row: any) => [row.user_id, row.qr_code]))
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

    if (includeAccessCodes && exportRows.length === 0) {
      return NextResponse.json({ error: 'V tejto registracnej skupine nie je ziadny aktivny pristupovy kod.' }, { status: 404 })
    }

    const qrItems = activeUsers
      .map((user: any) => ({
        userId: user.id,
        fullName: fullName(user),
        food: user.typ_stravy || '',
        qrCode: text(qrByUser.get(user.id))
      }))
      .filter(item => item.qrCode)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))

    if (includeQrCodes && qrItems.length === 0) {
      return NextResponse.json({ error: 'V tejto registracnej skupine nie je ziadny aktivny QR kod.' }, { status: 404 })
    }

    if (includeQrCodes && qrItems.length > 300) {
      return NextResponse.json({ error: 'QR prilohu posielaj po mensich skupinach, maximum je 300 QR v jednom e-maile.' }, { status: 400 })
    }

    const attachments = []
    const fileBase = `${fileSafe(group?.name || 'registracna-skupina')}-${new Date().toISOString().slice(0, 10)}`

    if (includeAccessCodes) {
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

      attachments.push({
        filename: `${fileBase}-pristupove-kody.csv`,
        content: Buffer.from(`\uFEFF${csv}`, 'utf8').toString('base64'),
        contentType: 'text/csv; charset=utf-8'
      })
    }

    if (includeQrCodes) {
      const qrHtml = await buildQrPrintHtml({
        title: `QR kody - ${group?.name || 'Registracna skupina'}`,
        groupName: group?.name || '',
        items: qrItems
      })

      attachments.push({
        filename: `${fileBase}-qr-kody.html`,
        content: Buffer.from(qrHtml, 'utf8').toString('base64'),
        contentType: 'text/html; charset=utf-8'
      })
    }

    const attachmentText = [
      includeAccessCodes ? `CSV pristupove kody: ${exportRows.length}` : '',
      includeQrCodes ? `QR tlacova priloha: ${qrItems.length}` : ''
    ].filter(Boolean).join(' | ')
    const result = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: recipientEmail,
      subject: includeQrCodes ? 'PohodaPass - prihlasovacie udaje a QR kody' : 'PohodaPass - prihlasovacie udaje',
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
          <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
            <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">PohodaPass</div>
            <h1 style="font-size:26px;margin:20px 0 10px;">Prihlasovacie udaje${includeQrCodes ? ' a QR kody' : ''}</h1>
            <p>${htmlEscape(note)}</p>
            <p>V prilohe najdes pripravene subory. Prihlasenie je dostupne na:</p>
            <p><a href="${loginUrl}">${loginUrl}</a></p>
            <p style="font-size:13px;color:#555;">${htmlEscape(attachmentText)}</p>
          </div>
        </div>
      `,
      text: `${note}\n\nPrihlasenie: ${loginUrl}\n${attachmentText}`,
      attachments
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
      qrCount: qrItems.length,
      attachments: attachments.map(attachment => attachment.filename)
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
