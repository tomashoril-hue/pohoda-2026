import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { createQrPngAttachment } from '@/lib/qrEmailAttachment'
import { checkActorRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

const WELCOME_EMAIL_BATCH_SIZE = 50
const EMAIL_SEND_CONCURRENCY = 5

function text(value: any) {
  return String(value || '').trim()
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = []
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex])
    }
  }))

  return results
}

function languageValue(value: any) {
  return text(value).toUpperCase() === 'EN' ? 'EN' : 'SK'
}

function welcomeEmailHtml(meno: string, loginUrl: string, language: 'SK' | 'EN') {
  const isEnglish = language === 'EN'
  const title = isEnglish ? 'You have been added to the meal system' : 'Boli ste pridany do stravovacieho systemu'
  const greeting = isEnglish ? `Hello${meno ? `, ${meno}` : ''},` : `Dobry den${meno ? `, ${meno}` : ''},`
  const intro = isEnglish
    ? 'we have registered you in the PohodaPass meal system.'
    : 'prave sme vas registrovali do stravovacieho systemu aplikacie PohodaPass.'
  const loginInfo = isEnglish
    ? 'You can sign in to the application using your e-mail address.'
    : 'Do aplikacie sa mozete prihlasit cez svoju e-mailovu adresu.'
  const button = isEnglish ? 'Open PohodaPass' : 'Otvorit PohodaPass'
  const appAddress = isEnglish ? 'Application address' : 'Adresa aplikacie'

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
        <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">
          PohodaPass
        </div>
        <h1 style="font-size:28px;margin:20px 0 10px;">${title}</h1>
        <p>${greeting}</p>
        <p>${intro}</p>
        <p>${loginInfo}</p>
        <p style="margin:26px 0;">
          <a href="${loginUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:900;">
            ${button}
          </a>
        </p>
        <p style="font-size:13px;color:#555;">${appAddress}: <a href="${loginUrl}">${loginUrl}</a></p>
      </div>
    </div>
  `
}

async function getBaseRegistrationGroupUserIds(registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('users')
    .select('id')
    .eq('registration_group_id', registrationGroupId)
    .eq('aktivny', 'ANO')

  if (error) throw error

  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function getAllWelcomeCandidateUsers() {
  const pageSize = 1000
  const users: any[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, qr_code, registration_group_id')
      .eq('aktivny', 'ANO')
      .not('email', 'is', null)
      .order('registration_group_id', { ascending: true })
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw error

    const rows = data || []
    users.push(...rows)

    if (rows.length < pageSize) break
    from += pageSize
  }

  return users
}

async function getSelfOrderingUserIds(userIds: string[]) {
  const result = new Set<string>()

  for (const chunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseServer
      .from('app_user_roles')
      .select('user_id')
      .in('user_id', chunk)
      .eq('role', 'SAMOSTATNE_OBJEDNAVANIE_STRAVY')
      .eq('active', true)

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) result.add(row.user_id)
    })
  }

  return result
}

async function getWelcomeCandidateUsersByIds(userIds: string[]) {
  const users: any[] = []

  for (const chunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, qr_code, registration_group_id')
      .in('id', chunk)
      .eq('aktivny', 'ANO')
      .not('email', 'is', null)
      .order('priezvisko', { ascending: true })
      .order('meno', { ascending: true })

    if (error) throw error

    users.push(...(data || []))
  }

  return users
}

async function getSentWelcomeUserIds(userIds: string[]) {
  const sentUserIds = new Set<string>()

  for (const chunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseServer
      .from('personnel_email_log')
      .select('user_id')
      .in('user_id', chunk)
      .eq('type', 'WELCOME_IMPORTED_USER')
      .eq('status', 'SENT')

    if (error) throw error

    ;(data || []).forEach((row: any) => {
      if (row.user_id) sentUserIds.add(row.user_id)
    })
  }

  return sentUserIds
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

    const sendLimit = checkActorRateLimit(currentUser.id, 'personalista-welcome-email', 4, 10 * 60 * 1000)
    if (!sendLimit.ok) return rateLimitResponse(sendLimit, 'Prilis vela hromadnych e-mailov. Skuste znova neskor.')

    const body = await req.json().catch(() => ({}))
    const userId = text(body.userId)
    const registrationGroupId = text(body.registrationGroupId)
    const resend = body.resend === true
    const language = languageValue(body.language)

    const scopedUserIds = userId
      ? [userId]
      : registrationGroupId
        ? await getBaseRegistrationGroupUserIds(registrationGroupId)
        : []
    const rawUsers = userId || registrationGroupId
      ? await getWelcomeCandidateUsersByIds(scopedUserIds)
      : await getAllWelcomeCandidateUsers()
    const rawUserIds = rawUsers.map((user: any) => user.id).filter(Boolean)
    const selfOrderingUserIds = rawUserIds.length > 0
      ? await getSelfOrderingUserIds(rawUserIds)
      : new Set<string>()
    const users = rawUsers.filter((user: any) => !selfOrderingUserIds.has(user.id))

    if (userId && rawUsers.length > 0 && users.length === 0) {
      return NextResponse.json(
        { error: 'Tato osoba ma samostatne objednavanie stravy. Pouzi e-mail Samostatne objednavanie stravy.' },
        { status: 400 }
      )
    }

    const userIds = users.map((user: any) => user.id).filter(Boolean)

    if (userId && userIds.length === 0) {
      return NextResponse.json(
        { error: 'Osoba sa nenasla, nema e-mail alebo nie je aktivna.' },
        { status: 404 }
      )
    }

    if (userIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, total: 0, remaining: 0, batchSize: WELCOME_EMAIL_BATCH_SIZE })
    }

    const sentUserIds = !resend ? await getSentWelcomeUserIds(userIds) : new Set<string>()

    const pendingUsers = users
      .filter((user: any) => resend || !sentUserIds.has(user.id))
    const targetUsers = pendingUsers.slice(0, WELCOME_EMAIL_BATCH_SIZE)
    const loginUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/login`

    const sendResults = await mapWithConcurrency(targetUsers, EMAIL_SEND_CONCURRENCY, async (user) => {
      const email = text(user.email).toLowerCase()

      if (!email) return { sent: 0, failed: 0 }

      try {
        const qrAttachment = await createQrPngAttachment(user.qr_code || '', 'pohodapass-qr')
        const result = await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: email,
          subject: language === 'EN'
            ? 'You have been added to the PohodaPass meal system'
            : 'Boli ste pridany do stravovacieho systemu PohodaPass',
          html: welcomeEmailHtml(user.meno || '', loginUrl, language),
          text: language === 'EN'
            ? `Hello ${user.meno || ''}, you have been added to the PohodaPass meal system. Open the application at ${loginUrl}`
            : `Dobry den ${user.meno || ''}, boli ste pridany do stravovacieho systemu PohodaPass. Aplikaciu otvorite na ${loginUrl}`,
          attachments: qrAttachment ? [qrAttachment] : undefined
        })

        await supabaseServer.from('personnel_email_log').insert({
          user_id: user.id,
          email,
          type: 'WELCOME_IMPORTED_USER',
          status: 'SENT',
          provider: result.provider,
          provider_message_id: result.messageId || null,
          sent_by: currentUser.id
        })

        return { sent: 1, failed: 0 }
      } catch (err: any) {
        await supabaseServer.from('personnel_email_log').insert({
          user_id: user.id,
          email,
          type: 'WELCOME_IMPORTED_USER',
          status: 'FAILED',
          error_message: err?.message || String(err),
          sent_by: currentUser.id
        })

        return { sent: 0, failed: 1 }
      }
    })
    const sent = sendResults.reduce((sum, result) => sum + result.sent, 0)
    const failed = sendResults.reduce((sum, result) => sum + result.failed, 0)

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: targetUsers.length,
      remaining: Math.max(0, pendingUsers.length - targetUsers.length),
      batchSize: WELCOME_EMAIL_BATCH_SIZE
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
