import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { getGlobalAccess } from '@/lib/globalRoles'
import { requestLanguage } from '@/lib/i18nServer'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'
import AccessCodesGroupPickerClient from './AccessCodesGroupPickerClient'
import AccessCodesShareClient from './AccessCodesShareClient'

export const dynamic = 'force-dynamic'

type LoginType = 'EMAIL' | 'CODE' | 'NONE'

function text(value: any) {
  return String(value || '').trim()
}

function languageValue(value: any): 'SK' | 'EN' {
  return text(value).toUpperCase() === 'EN' ? 'EN' : 'SK'
}

function emailValue(value: any) {
  const email = text(value).toLowerCase()

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
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

async function getAvailableRegistrationGroups(userId: string, canUsePersonalista: boolean) {
  if (canUsePersonalista) {
    const { data, error } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('active', true)
      .order('name', { ascending: true })

    if (error) throw error

    return (data || [])
      .map((group: any) => ({
        id: text(group.id),
        name: text(group.name)
      }))
      .filter(group => group.id && group.name)
  }

  const { data: managerRows, error: managerError } = await supabaseServer
    .from('registration_group_managers')
    .select('registration_group_id')
    .eq('user_id', userId)
    .eq('active', true)

  if (managerError) throw managerError

  const registrationGroupIds = Array.from(new Set(
    (managerRows || [])
      .map((row: any) => text(row.registration_group_id))
      .filter(Boolean)
  ))

  if (registrationGroupIds.length === 0) return []

  const { data, error } = await supabaseServer
    .from('registration_groups')
    .select('id, name')
    .eq('active', true)
    .in('id', registrationGroupIds)
    .order('name', { ascending: true })

  if (error) throw error

  return (data || [])
    .map((group: any) => ({
      id: text(group.id),
      name: text(group.name)
    }))
    .filter(group => group.id && group.name)
}

function shareMessage(language: 'SK' | 'EN', loginType: LoginType, accessCode: string, loginUrl: string) {
  if (language === 'EN') {
    if (loginType === 'EMAIL') return `Hello, log in to PohodaPass using your e-mail here: ${loginUrl}`
    if (loginType === 'CODE') return `Hello, your PohodaPass access code is ${accessCode}. Login: ${loginUrl}`
    return ''
  }

  if (loginType === 'EMAIL') return `Ahoj, do PohodaPass sa prihlas cez svoj e-mail tu: ${loginUrl}`
  if (loginType === 'CODE') return `Ahoj, tvoj pristupovy kod do PohodaPass je ${accessCode}. Prihlasenie: ${loginUrl}`
  return ''
}

export default async function AccessCodesSharePage({
  searchParams
}: {
  searchParams: Promise<{ registrationGroupId?: string; language?: string }>
}) {
  const params = await searchParams
  const registrationGroupId = text(params.registrationGroupId)
  const requestedLanguage = text(params.language)
  const user = await getCurrentUser()
  const initialLanguage = requestedLanguage ? languageValue(requestedLanguage) : await requestLanguage()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(currentPath(registrationGroupId, initialLanguage))}`)
  }

  const language = requestedLanguage ? initialLanguage : await requestLanguage(user)

  const access = await getGlobalAccess(user.id)

  if (!registrationGroupId) {
    const groups = await getAvailableRegistrationGroups(user.id, access.canUsePersonalista)

    if (groups.length === 0) {
      redirect('/dashboard')
    }

    if (!access.canUsePersonalista && groups.length === 1) {
      redirect(currentPath(groups[0].id, language))
    }

    return (
      <AccessCodesGroupPickerClient
        groups={groups}
        language={language}
        currentUserName={fullName(user)}
        currentUserEmail={text(user.email)}
      />
    )
  }

  const groupResult = await supabaseServer
    .from('registration_groups')
    .select('id, name')
    .eq('id', registrationGroupId)
    .maybeSingle()

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
      const email = emailValue(person.email)
      const accessCode = text(codeByUser.get(person.id))
      const loginType: LoginType = email ? 'EMAIL' : accessCode ? 'CODE' : 'NONE'
      const loginLabel = loginType === 'EMAIL'
        ? (language === 'EN' ? 'E-mail' : 'E-mail')
        : loginType === 'CODE'
          ? (language === 'EN' ? 'Access code' : 'Pristupovy kod')
          : (language === 'EN' ? 'No login identifier' : 'Bez prihlasovacieho identifikatora')
      const loginUrl = loginType === 'EMAIL'
        ? `${loginBaseUrl}?method=email&email=${encodeURIComponent(email)}`
        : loginType === 'CODE'
          ? `${loginBaseUrl}?method=code&code=${encodeURIComponent(accessCode)}`
          : ''
      const phone = normalizePhone(person.telefon)

      return {
        id: person.id,
        fullName: fullName(person),
        meno: text(person.meno),
        priezvisko: text(person.priezvisko),
        email,
        telefon: phone,
        loginType,
        loginLabel,
        accessCode,
        loginUrl,
        message: shareMessage(language, loginType, accessCode, loginUrl)
      }
    })
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
