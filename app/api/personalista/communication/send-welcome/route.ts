import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { checkActorRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
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

    const sendLimit = checkActorRateLimit(currentUser.id, 'personalista-welcome-email', 4, 10 * 60 * 1000)
    if (!sendLimit.ok) return rateLimitResponse(sendLimit, 'Prilis vela hromadnych e-mailov. Skuste znova neskor.')

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = text(body.registrationGroupId)
    const resend = body.resend === true
    const language = languageValue(body.language)

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    const userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)

    if (userIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, total: 0 })
    }

    let sentUserIds = new Set<string>()

    if (!resend) {
      const { data: sentRows, error: sentError } = await supabaseServer
        .from('personnel_email_log')
        .select('user_id')
        .in('user_id', userIds)
        .eq('type', 'WELCOME_IMPORTED_USER')
        .eq('status', 'SENT')

      if (sentError) {
        return NextResponse.json({ error: sentError.message }, { status: 500 })
      }

      sentUserIds = new Set((sentRows || []).map((row: any) => row.user_id).filter(Boolean))
    }

    const { data: users, error: usersError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email')
      .in('id', userIds)
      .eq('aktivny', 'ANO')
      .not('email', 'is', null)
      .order('priezvisko', { ascending: true })

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const targetUsers = (users || [])
      .filter((user: any) => resend || !sentUserIds.has(user.id))
      .slice(0, 200)
    const loginUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin}/login`
    let sent = 0
    let failed = 0

    for (const user of targetUsers) {
      const email = text(user.email).toLowerCase()

      if (!email) continue

      try {
        const result = await sendAppEmail({
          from: 'POHODA 2026 <registracia@pohodapass.sk>',
          to: email,
          subject: language === 'EN'
            ? 'You have been added to the PohodaPass meal system'
            : 'Boli ste pridany do stravovacieho systemu PohodaPass',
          html: welcomeEmailHtml(user.meno || '', loginUrl, language),
          text: language === 'EN'
            ? `Hello ${user.meno || ''}, you have been added to the PohodaPass meal system. Open the application at ${loginUrl}`
            : `Dobry den ${user.meno || ''}, boli ste pridany do stravovacieho systemu PohodaPass. Aplikaciu otvorite na ${loginUrl}`
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

        sent += 1
      } catch (err: any) {
        await supabaseServer.from('personnel_email_log').insert({
          user_id: user.id,
          email,
          type: 'WELCOME_IMPORTED_USER',
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
      total: targetUsers.length
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
