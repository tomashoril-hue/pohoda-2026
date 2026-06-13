import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'
import AccessCodesShareClient from './AccessCodesShareClient'

export const dynamic = 'force-dynamic'

function text(value: any) {
  return String(value || '').trim()
}

function languageValue(value: any): 'SK' | 'EN' {
  return text(value).toUpperCase() === 'EN' ? 'EN' : 'SK'
}

function normalizePhone(value: any) {
  const raw = text(value)

  if (!raw) return ''

  let cleaned = raw.replace(/[^\d+]/g, '')

  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`
  if (!cleaned.startsWith('+') && cleaned.length === 10 && cleaned.startsWith('0')) {
    cleaned = `+421${cleaned.slice(1)}`
  }
  if (!cleaned.startsWith('+') && cleaned.length === 9) {
    cleaned = `+421${cleaned}`
  }

  return cleaned || raw
}

function fullName(user: any) {
  return `${text(user?.meno)} ${text(user?.priezvisko)}`.trim() || text(user?.email) || 'Bez mena'
}

function currentPath(registrationGroupId: string, language: 'SK' | 'EN') {
  const params = new URLSearchParams()

  if (registrationGroupId) params.set('registrationGroupId', registrationGroupId)
  params.set('language', language)

  return `/dashboard/access-codes-share?${params.toString()}`
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

function shareMessage(language: 'SK' | 'EN', accessCode: string, loginUrl: string) {
  if (language === 'EN') {
    return `Hello, your PohodaPass access code is ${accessCode}. Login: ${loginUrl}`
  }

  return `Ahoj, tvoj pristupovy kod do PohodaPass je ${accessCode}. Prihlasenie: ${loginUrl}`
}

export default async function AccessCodesSharePage({
  searchParams
}: {
  searchParams: Promise<{ registrationGroupId?: string; language?: string }>
}) {
  const params = await searchParams
  const registrationGroupId = text(params.registrationGroupId)
  const language = languageValue(params.language)
  const user = await getCurrentUser()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(currentPath(registrationGroupId, language))}`)
  }

  if (!registrationGroupId) {
    redirect('/dashboard')
  }

  const [access, groupResult] = await Promise.all([
    getGlobalAccess(user.id),
    supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('id', registrationGroupId)
      .maybeSingle()
  ])

  if (groupResult.error || !groupResult.data) {
    redirect('/dashboard')
  }

  const canManage = access.canUsePersonalista || await canManageRegistrationGroup(user.id, registrationGroupId)

  if (!canManage) {
    redirect('/dashboard')
  }

  const userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)
  const { data: users, error: usersError } = userIds.length > 0
    ? await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon')
      .in('id', userIds)
      .eq('aktivny', 'ANO')
    : { data: [], error: null }

  if (usersError) throw usersError

  const activeUsers = users || []
  const activeUserIds = activeUsers.map((item: any) => item.id)
  const { data: codeRows, error: codeError } = activeUserIds.length > 0
    ? await supabaseServer
      .from('user_access_codes')
      .select('user_id, access_code_plain')
      .in('user_id', activeUserIds)
      .eq('active', true)
      .not('access_code_plain', 'is', null)
    : { data: [], error: null }

  if (codeError) throw codeError

  const codeByUser = new Map((codeRows || []).map((row: any) => [row.user_id, row.access_code_plain]))
  const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pohodapass.sk'
  const loginBaseUrl = `${siteBaseUrl}/login`
  const people = activeUsers
    .map((person: any) => {
      const accessCode = text(codeByUser.get(person.id))
      const loginUrl = `${loginBaseUrl}?method=code&code=${encodeURIComponent(accessCode)}`
      const phone = normalizePhone(person.telefon)

      return {
        id: person.id,
        fullName: fullName(person),
        meno: text(person.meno),
        priezvisko: text(person.priezvisko),
        email: text(person.email),
        telefon: phone,
        accessCode,
        loginUrl,
        message: shareMessage(language, accessCode, loginUrl)
      }
    })
    .filter(person => person.accessCode)
    .sort((a, b) => `${a.priezvisko} ${a.meno}`.localeCompare(`${b.priezvisko} ${b.meno}`, 'sk'))

  return (
    <AccessCodesShareClient
      groupName={groupResult.data.name || 'Registracna skupina'}
      language={language}
      currentUserName={fullName(user)}
      currentUserEmail={text(user.email)}
      people={people}
    />
  )
}
