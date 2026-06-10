import { getGlobalAccess } from '@/lib/globalRoles'
import { canManageRegistrationGroup } from '@/lib/registrationGroupManagers'
import { supabaseServer } from '@/lib/supabaseServer'

export type MealType = 'OBED' | 'VECERA'
export type FoodChoice = 'MASO' | 'VEGE' | 'DIETA'
export type IssueAccess = 'ADMIN' | 'MANAGER' | 'DELEGATE' | ''

export type IssuablePerson = {
  id: string
  name: string
  email: string
  choice: FoodChoice
  source: 'REGISTRATION_GROUP' | 'SEARCH' | 'QR'
}

export function cleanText(value: any) {
  return String(value || '').trim()
}

export function normalizeDate(value: any) {
  const text = cleanText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

export function normalizeMeal(value: any): MealType | '' {
  const text = cleanText(value).toUpperCase()
  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA' || text === 'VE\u010cERA') return 'VECERA'
  return ''
}

export function normalizeChoice(value: any): FoodChoice | null {
  const text = cleanText(value).toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DI\u00c9TA') return 'DIETA'
  return null
}

export function normalizeSelectionChoice(value: any): FoodChoice | 'BEZ_ZAUJMU' | null {
  const text = cleanText(value).toUpperCase()
  if (text === 'BEZ_ZAUJMU') return 'BEZ_ZAUJMU'
  return normalizeChoice(value)
}

export function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim() || user?.email || 'Bez mena'
}

export function entitlementOk(row: any, meal: MealType) {
  if (!row) return false
  if (meal === 'OBED') return row.obed === true
  return row.vecera === true
}

export function issueTitle(groupName: string, meal: MealType, customTitle?: string, sequence = 1) {
  const title = cleanText(customTitle)
  if (title) return title

  const mealText = meal === 'OBED' ? 'obed' : 'večera'
  return `${groupName || 'Skupinovy vydaj'} ${mealText} výdaj č. ${Math.max(1, sequence)}`
}

export function choiceSummary(rows: Array<{ choice: FoodChoice }>) {
  const summary = { MASO: 0, VEGE: 0, DIETA: 0, SPOLU: 0 }

  rows.forEach(row => {
    summary[row.choice] += 1
    summary.SPOLU += 1
  })

  return summary
}

function registrationGroupForDate(user: any, periods: any[], date: string) {
  const normalizedPeriods = periods
    .map(period => ({
      ...period,
      valid_from: normalizeDate(period.valid_from),
      valid_to: normalizeDate(period.valid_to)
    }))
    .filter(period => period.valid_from)

  const period = normalizedPeriods
    .filter(period => {
      return period.valid_from <= date && (!period.valid_to || period.valid_to >= date)
    })
    .sort((a, b) => {
      const fromCompare = b.valid_from.localeCompare(a.valid_from)
      if (fromCompare !== 0) return fromCompare
      return cleanText(b.id).localeCompare(cleanText(a.id))
    })[0]

  if (period?.registration_group_id) return period.registration_group_id
  if (normalizedPeriods.length === 0) return user?.registration_group_id || ''

  return ''
}

export async function getIssueAccess(actorId: string, registrationGroupId: string): Promise<IssueAccess> {
  const access = await getGlobalAccess(actorId)

  if (access.isAdmin) return 'ADMIN'

  if (await canManageRegistrationGroup(actorId, registrationGroupId)) {
    return 'MANAGER'
  }

  const { data } = await supabaseServer
    .from('registration_group_issue_delegates')
    .select('id')
    .eq('user_id', actorId)
    .eq('registration_group_id', registrationGroupId)
    .eq('active', true)
    .limit(1)

  return data?.length ? 'DELEGATE' : ''
}

export async function loadRegistrationGroup(registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('registration_groups')
    .select('id, name, active')
    .eq('id', registrationGroupId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function loadRegistrationGroupPeople(registrationGroupId: string, date: string) {
  const [periodResult, fallbackResult] = await Promise.all([
    supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to')
      .eq('registration_group_id', registrationGroupId)
      .lte('valid_from', date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
    supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
      .eq('registration_group_id', registrationGroupId)
      .eq('aktivny', 'ANO')
  ])

  if (periodResult.error) throw periodResult.error
  if (fallbackResult.error) throw fallbackResult.error

  const userIds = Array.from(new Set([
    ...(periodResult.data || []).map((row: any) => row.user_id).filter(Boolean),
    ...(fallbackResult.data || []).map((row: any) => row.id).filter(Boolean)
  ]))

  if (userIds.length === 0) return []

  const [usersResult, periodsResult] = await Promise.all([
    supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
      .in('id', userIds),
    supabaseServer
      .from('user_registration_group_periods')
      .select('id, user_id, registration_group_id, valid_from, valid_to')
      .in('user_id', userIds)
      .lte('valid_from', date)
      .or(`valid_to.is.null,valid_to.gte.${date}`)
  ])

  if (usersResult.error) throw usersResult.error
  if (periodsResult.error) throw periodsResult.error

  const periodsByUserId = new Map<string, any[]>()
  ;(periodsResult.data || []).forEach((period: any) => {
    const list = periodsByUserId.get(period.user_id) || []
    list.push(period)
    periodsByUserId.set(period.user_id, list)
  })

  return (usersResult.data || [])
    .filter((user: any) => String(user.aktivny || '').toUpperCase() === 'ANO')
    .filter((user: any) => {
      return registrationGroupForDate(user, periodsByUserId.get(user.id) || [], date) === registrationGroupId
    })
}

export async function loadUsersByIds(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, aktivny, typ_stravy, registration_group_id')
    .in('id', ids)

  if (error) throw error

  return data || []
}

export async function filterIssuablePeople({
  users,
  date,
  meal,
  source
}: {
  users: any[]
  date: string
  meal: MealType
  source: 'REGISTRATION_GROUP' | 'SEARCH' | 'QR'
}) {
  const userIds = Array.from(new Set(users.map((user: any) => user.id).filter(Boolean)))
  if (userIds.length === 0) return []

  const [entitlementResult, selectionResult, issuedResult] = await Promise.all([
    supabaseServer
      .from('user_food_entitlements')
      .select('user_id, datum, obed, vecera')
      .eq('datum', date)
      .in('user_id', userIds),
    supabaseServer
      .from('vyber_jedal')
      .select('user_id, datum, typ_jedla, volba')
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .in('user_id', userIds),
    supabaseServer
      .from('vydaj_jedal')
      .select('user_id, status')
      .eq('datum', date)
      .eq('typ_jedla', meal)
      .eq('status', 'VYDANE')
      .in('user_id', userIds)
  ])

  if (entitlementResult.error) throw entitlementResult.error
  if (selectionResult.error) throw selectionResult.error
  if (issuedResult.error) throw issuedResult.error

  const entitlementByUserId = new Map((entitlementResult.data || []).map((row: any) => [row.user_id, row]))
  const selectionByUserId = new Map((selectionResult.data || []).map((row: any) => [row.user_id, row]))
  const issuedUserIds = new Set((issuedResult.data || []).map((row: any) => row.user_id))

  return users
    .map((user: any): IssuablePerson | null => {
      if (String(user.aktivny || '').toUpperCase() !== 'ANO') return null
      if (issuedUserIds.has(user.id)) return null

      const entitlement = entitlementByUserId.get(user.id)
      if (!entitlementOk(entitlement, meal)) return null

      const selectionChoice = normalizeSelectionChoice(selectionByUserId.get(user.id)?.volba)
      if (selectionChoice === 'BEZ_ZAUJMU') return null

      const choice = normalizeChoice(selectionChoice || user.typ_stravy)
      if (!choice) return null

      return {
        id: user.id,
        name: fullName(user),
        email: user.email || '',
        choice,
        source
      }
    })
    .filter(Boolean) as IssuablePerson[]
}
