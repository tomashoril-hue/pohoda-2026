import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { createQrPngAttachment } from '@/lib/qrEmailAttachment'
import { checkActorRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { createSelfOrderingToken, hashSelfOrderingToken } from '@/lib/selfOrderingToken'
import { supabaseServer } from '@/lib/supabaseServer'

const BATCH_SIZE = 50
const SELF_ORDERING_TOKEN_DAYS = 7

function text(value: any) {
  return String(value || '').trim()
}

function htmlEscape(value: any) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function languageValue(value: any) {
  return text(value).toUpperCase() === 'EN' ? 'EN' : 'SK'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function selfOrderingEmailHtml({
  meno,
  email,
  loginUrl,
  siteUrl,
  language,
  faviconUrl
}: {
  meno: string
  email: string
  loginUrl: string
  siteUrl: string
  language: 'SK' | 'EN'
  faviconUrl: string
}) {
  const isEnglish = language === 'EN'
  const copy = isEnglish
    ? {
        subject: 'PohodaPass meal ordering',
        heading: 'Hello Pohodak',
        greeting: `Hello${meno ? `, ${meno}` : ''},`,
        intro: 'we have registered you in the PohodaPass meal system.',
        body: 'Please choose your default meal type and order lunches or dinners for the days when you want to use catering. After that, you can change your selections in the Meal selection section of the app.',
        login: `This button signs you in automatically once. It is valid for ${SELF_ORDERING_TOKEN_DAYS} days.`,
        button: 'Open PohodaPass',
        fallback: 'Or sign in at PohodaPass with your login e-mail:',
        footer: 'Your QR code is attached as a PNG file.'
      }
    : {
        subject: 'Objednávanie stravy PohodaPass',
        heading: 'Ahoj Pohodák',
        greeting: `Ahoj${meno ? `, ${meno}` : ''},`,
        intro: 'práve sme ťa registrovali do stravovacieho systému PohodaPass.',
        body: 'Prosím vyber si predvolený typ stravy a objednaj si obedy alebo večere na dni, počas ktorých chceš stravu využívať. Následne si v aplikácii môžeš cez Výber stravy meniť jedlo na každý deň.',
        login: `Toto tlačidlo ťa automaticky prihlási jednorazovo. Platí ${SELF_ORDERING_TOKEN_DAYS} dní.`,
        button: 'Otvoriť PohodaPass',
        fallback: 'Alebo sa prihlás na PohodaPass prihlasovacím e-mailom:',
        footer: 'Tvoj QR kód nájdeš aj v prílohe ako PNG súbor.'
      }
  const safeLoginUrl = htmlEscape(loginUrl)
  const safeSiteUrl = htmlEscape(siteUrl)
  const safeEmail = htmlEscape(email)

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td align="left">
              <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">PohodaPass</div>
            </td>
            <td align="right" style="vertical-align:middle;padding-right:10px;">
              <img src="${htmlEscape(faviconUrl)}" alt="PohodaPass" width="42" height="42" style="display:block;width:42px;height:42px;">
            </td>
          </tr>
        </table>

        <h1 style="font-size:26px;line-height:1.12;margin:20px 0 10px;font-weight:950;">${htmlEscape(copy.heading)}</h1>
        <p style="font-size:16px;line-height:1.5;margin:0 0 12px;font-weight:800;">${htmlEscape(copy.greeting)}</p>
        <p style="font-size:15px;line-height:1.55;margin:0 0 10px;color:#333;">${htmlEscape(copy.intro)}</p>
        <p style="font-size:15px;line-height:1.55;margin:0 0 10px;color:#333;">${htmlEscape(copy.body)}</p>
        <p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#333;">${htmlEscape(copy.login)}</p>

        <p style="margin:20px 0;">
          <a href="${safeLoginUrl}" style="display:inline-block;background:#7417e8;color:#fff;border:3px solid #000;border-radius:999px;padding:12px 18px;font-weight:900;text-decoration:none;">${htmlEscape(copy.button)}</a>
        </p>

        <p style="font-size:13px;line-height:1.45;margin:18px 0 6px;color:#555;">${htmlEscape(copy.fallback)}</p>
        <p style="font-size:13px;line-height:1.45;margin:0;color:#333;">
          <a href="${safeSiteUrl}" style="color:#7417e8;font-weight:900;">${safeSiteUrl}</a><br>
          <span style="font-weight:900;">${safeEmail}</span>
        </p>

        <p style="font-size:12px;line-height:1.45;margin:20px 0 0;color:#666;">${htmlEscape(copy.footer)}</p>
      </div>
    </div>
  `
}

async function getSelfOrderingUsers(registrationGroupId: string) {
  const roleQuery = supabaseServer
    .from('app_user_roles')
    .select('user_id')
    .eq('role', 'SAMOSTATNE_OBJEDNAVANIE_STRAVY')
    .eq('active', true)

  const { data: roleRows, error: roleError } = await roleQuery
  if (roleError) throw roleError

  const roleUserIds = (roleRows || []).map((row: any) => row.user_id).filter(Boolean)
  const users: any[] = []

  for (const chunk of chunkArray(roleUserIds, 500)) {
    let query = supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, qr_code, registration_group_id')
      .in('id', chunk)
      .eq('aktivny', 'ANO')
      .not('email', 'is', null)
      .order('registration_group_id', { ascending: true })
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })

    if (registrationGroupId) query = query.eq('registration_group_id', registrationGroupId)

    const { data, error } = await query
    if (error) throw error

    users.push(...(data || []))
  }

  return users
}

async function getSelfOrderingUserById(userId: string) {
  const { data: roleRow, error: roleError } = await supabaseServer
    .from('app_user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('role', 'SAMOSTATNE_OBJEDNAVANIE_STRAVY')
    .eq('active', true)
    .maybeSingle()

  if (roleError) throw roleError
  if (!roleRow) return null

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, qr_code, registration_group_id')
    .eq('id', userId)
    .eq('aktivny', 'ANO')
    .maybeSingle()

  if (userError) throw userError

  return user
}

async function getSentInviteUserIds(userIds: string[]) {
  const sent = new Set<string>()

  for (const chunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseServer
      .from('personnel_email_log')
      .select('user_id')
      .in('user_id', chunk)
      .eq('type', 'SELF_ORDERING_INVITE')
      .eq('status', 'SENT')

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) sent.add(row.user_id)
    })
  }

  return sent
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
    const registrationGroupId = text(body.registrationGroupId)
    const userId = text(body.userId)
    const resend = Boolean(body.resend)
    const language = languageValue(body.language)
    let targetUsers: any[] = []
    let pendingCount = 0

    if (userId) {
      if (!isUuid(userId)) {
        return NextResponse.json({ error: 'Neplatna osoba.' }, { status: 400 })
      }

      const sendLimit = checkActorRateLimit(currentUser.id, 'personalista-self-ordering-email-resend', 12, 10 * 60 * 1000)
      if (!sendLimit.ok) return rateLimitResponse(sendLimit, 'Prilis vela opakovanych e-mailov. Skuste znova neskor.')

      const user = await getSelfOrderingUserById(userId)

      if (!user) {
        return NextResponse.json({ error: 'Osoba nema aktivne pravo Samostatne objednavanie stravy alebo nie je aktivna.' }, { status: 400 })
      }

      if (!text(user.email)) {
        return NextResponse.json({ error: 'Osoba nema e-mail.' }, { status: 400 })
      }

      targetUsers = [user]
      pendingCount = 1
    } else {
      const sendLimit = checkActorRateLimit(currentUser.id, 'personalista-self-ordering-email', 4, 10 * 60 * 1000)
      if (!sendLimit.ok) return rateLimitResponse(sendLimit, 'Prilis vela hromadnych e-mailov. Skuste znova neskor.')

      const users = await getSelfOrderingUsers(registrationGroupId)
      const userIds = users.map((user: any) => user.id).filter(Boolean)
      const sentUserIds = await getSentInviteUserIds(userIds)
      const pendingUsers = users.filter((user: any) => !sentUserIds.has(user.id))
      targetUsers = pendingUsers.slice(0, BATCH_SIZE)
      pendingCount = pendingUsers.length
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
    const faviconUrl = `${baseUrl}/favicon.ico`
    let sent = 0
    let failed = 0

    for (const user of targetUsers) {
      const email = text(user.email).toLowerCase()
      if (!email) continue

      const token = createSelfOrderingToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + SELF_ORDERING_TOKEN_DAYS)
      const loginUrl = `${baseUrl}/self-ordering-login?token=${token}`

      try {
        if (resend) {
          await supabaseServer
            .from('self_ordering_login_tokens')
            .update({
              used_count: 1,
              last_used_at: new Date().toISOString()
            })
            .eq('user_id', user.id)
            .eq('used_count', 0)
        }

        const { error: tokenError } = await supabaseServer
          .from('self_ordering_login_tokens')
          .insert({
            user_id: user.id,
            token_hash: hashSelfOrderingToken(token),
            expires_at: expiresAt.toISOString(),
            created_by: currentUser.id
          })

        if (tokenError) throw tokenError

        const qrAttachment = await createQrPngAttachment(user.qr_code || '', 'pohodapass-qr')
        const html = selfOrderingEmailHtml({
          meno: user.meno || '',
          email,
          loginUrl,
          siteUrl: baseUrl,
          language,
          faviconUrl
        })
        const result = await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: email,
          subject: language === 'EN' ? 'PohodaPass meal ordering' : 'Objednávanie stravy PohodaPass',
          html,
          text: language === 'EN'
            ? `Hello ${user.meno || ''}, we have registered you in PohodaPass. Use the Open PohodaPass button in this e-mail to order your meals. Or sign in at ${baseUrl} with your login e-mail: ${email}`
            : `Ahoj ${user.meno || ''}, práve sme ťa registrovali do PohodaPass. Stravu si objednaj cez tlačidlo Otvoriť PohodaPass v tomto e-maile. Alebo sa prihlás na ${baseUrl} prihlasovacím e-mailom: ${email}`,
          attachments: qrAttachment ? [qrAttachment] : undefined
        })

        await supabaseServer.from('personnel_email_log').insert({
          user_id: user.id,
          email,
          type: 'SELF_ORDERING_INVITE',
          status: 'SENT',
          provider: result.provider,
          provider_message_id: result.messageId || null,
          sent_by: currentUser.id
        })

        sent += 1
      } catch (err: any) {
        await supabaseServer.from('personnel_email_log').insert({
          user_id: user.id,
          email,
          type: 'SELF_ORDERING_INVITE',
          status: 'FAILED',
          error_message: err?.message || String(err),
          sent_by: currentUser.id
        })

        failed += 1
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: targetUsers.length,
      remaining: Math.max(0, pendingCount - targetUsers.length),
      batchSize: BATCH_SIZE
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
