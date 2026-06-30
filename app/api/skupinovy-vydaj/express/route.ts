import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  IssuablePerson,
  MealType,
  choiceSummary,
  cleanText,
  filterIssuablePeople,
  fullName,
  getIssueAccess,
  loadPreparationPeople,
  loadRegistrationGroup,
  loadRegistrationGroupPeople,
  loadUsersByIds,
  normalizeChoice,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

type RequestedPerson = {
  userId: string
  source: 'REGISTRATION_GROUP'
}

function bratislavaParts(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
}

function todayIsoDate() {
  const parts = bratislavaParts()
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function currentExpressMeal(): MealType {
  const hour = Number(bratislavaParts().find(part => part.type === 'hour')?.value || '0')
  return hour < 16 ? 'OBED' : 'VECERA'
}

function mealLabel(meal: MealType) {
  return meal === 'OBED' ? 'obed' : 'vecera'
}

function expressIssueTitle(groupName: string, meal: MealType, sequence = 1) {
  const suffix = sequence > 1 ? ` c. ${sequence}` : ''
  return `Express ${mealLabel(meal)}${suffix} - ${groupName || 'registracna skupina'}`
}

function expressTitlePrefix(meal: MealType) {
  return `Express ${mealLabel(meal)}`
}

function normalizeRequestedUserIds(value: any): string[] {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

function requestedPeopleFromIds(userIds: string[]): RequestedPerson[] {
  return userIds.map(userId => ({ userId, source: 'REGISTRATION_GROUP' }))
}

async function validateIssueAccess(actorId: string, registrationGroupId: string) {
  const globalAccess = await getGlobalAccess(actorId)

  if (globalAccess.isAdmin || globalAccess.isPersonalista) {
    return 'ADMIN'
  }

  const access = await getIssueAccess(actorId, registrationGroupId)

  if (!access) {
    throw Object.assign(new Error('Nemas opravnenie pre tuto registracnu skupinu.'), { status: 403 })
  }

  return access
}

async function resolveExpressDateMeal(actorId: string, dateInput: any, mealInput: any) {
  const globalAccess = await getGlobalAccess(actorId)
  const canSelectDateMeal = globalAccess.isAdmin || globalAccess.isPersonalista

  if (!canSelectDateMeal) {
    return {
      date: todayIsoDate(),
      meal: currentExpressMeal(),
      canSelectDateMeal
    }
  }

  return {
    date: normalizeDate(dateInput) || todayIsoDate(),
    meal: normalizeMeal(mealInput) || currentExpressMeal(),
    canSelectDateMeal
  }
}

async function loadActiveIssueIds(date: string, meal: MealType, excludedIssueId = '') {
  let query = supabaseServer
    .from('registration_group_issues')
    .select('id')
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .in('status', ['READY', 'WAITING'])

  if (excludedIssueId) query = query.neq('id', excludedIssueId)

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function loadPlannedUserIds(date: string, meal: MealType, excludedIssueId = '') {
  const issueIds = await loadActiveIssueIds(date, meal, excludedIssueId)
  if (issueIds.length === 0) return new Set<string>()

  const { data, error } = await supabaseServer
    .from('registration_group_issue_items')
    .select('user_id')
    .in('issue_id', issueIds)
    .eq('status', 'PLANNED')

  if (error) throw error

  return new Set((data || []).map((row: any) => row.user_id).filter(Boolean))
}

async function findExpressIssue({
  actorId,
  registrationGroupId,
  date,
  meal,
  title
}: {
  actorId: string
  registrationGroupId: string
  date: string
  meal: MealType
  title: string
}) {
  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id, title, datum, typ_jedla, status, valid_after')
    .eq('registration_group_id', registrationGroupId)
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .eq('created_by', actorId)
    .eq('title', title)
    .in('status', ['READY', 'WAITING'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return data
}

async function loadExpressIssues({
  registrationGroupId,
  date,
  meal
}: {
  registrationGroupId: string
  date: string
  meal: MealType
}) {
  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id, title, datum, typ_jedla, status, valid_after, created_at, updated_at')
    .eq('registration_group_id', registrationGroupId)
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .ilike('title', `${expressTitlePrefix(meal)}%`)
    .in('status', ['READY', 'WAITING'])
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) throw error

  return data || []
}

async function loadExpressIssueById(issueId: string, registrationGroupId: string, date: string, meal: MealType) {
  if (!issueId) return null

  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id, title, datum, typ_jedla, status, valid_after')
    .eq('id', issueId)
    .eq('registration_group_id', registrationGroupId)
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .ilike('title', `${expressTitlePrefix(meal)}%`)
    .in('status', ['READY', 'WAITING'])
    .maybeSingle()

  if (error) throw error

  return data
}

async function nextExpressIssueSequence(registrationGroupId: string, date: string, meal: MealType) {
  const { count, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id', { count: 'exact', head: true })
    .eq('registration_group_id', registrationGroupId)
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .ilike('title', `${expressTitlePrefix(meal)}%`)

  if (error) throw error

  return (count || 0) + 1
}

async function loadIssueItems(issueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issue_items')
    .select('user_id, source, volba, status')
    .eq('issue_id', issueId)
    .neq('status', 'REMOVED')

  if (error) throw error

  return data || []
}

async function loadPickupUsers(issueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issue_pickup_users')
    .select('user_id')
    .eq('issue_id', issueId)
    .eq('active', true)

  if (error) throw error

  return (data || []).map((row: any) => row.user_id).filter(Boolean)
}

function defaultPickupUserIds(actorId: string, candidateUserIds: Set<string>) {
  return candidateUserIds.has(actorId) ? [actorId] : []
}

function pickupPeopleFromGroupUsers(users: any[]): IssuablePerson[] {
  return users
    .map((user: any): IssuablePerson => ({
      id: user.id,
      name: fullName(user),
      firstName: user.meno || '',
      lastName: user.priezvisko || '',
      email: user.email || '',
      choice: normalizeChoice(user.typ_stravy) || 'MASO',
      source: 'REGISTRATION_GROUP'
    }))
    .sort(comparePeople)
}

function nextIssueStateForAccess(access: string) {
  const immediate = access === 'ADMIN' || access === 'MANAGER'

  return {
    immediate,
    status: immediate ? 'READY' : 'WAITING',
    validAfter: immediate ? null : new Date(Date.now() + 15 * 60 * 1000).toISOString()
  }
}

async function replacePickupUsers(issueId: string, userIds: string[], actorId: string) {
  let deactivateQuery = supabaseServer
    .from('registration_group_issue_pickup_users')
    .update({
      active: false,
      removed_at: new Date().toISOString(),
      removed_by: actorId
    })
    .eq('issue_id', issueId)

  if (userIds.length > 0) {
    deactivateQuery = deactivateQuery.not('user_id', 'in', `(${userIds.join(',')})`)
  }

  const { error: deactivateError } = await deactivateQuery
  if (deactivateError) throw deactivateError

  if (userIds.length === 0) return

  const { error: upsertError } = await supabaseServer
    .from('registration_group_issue_pickup_users')
    .upsert(userIds.map(userId => ({
      issue_id: issueId,
      user_id: userId,
      created_by: actorId,
      active: true,
      removed_at: null,
      removed_by: null
    })), {
      onConflict: 'issue_id,user_id'
    })

  if (upsertError) throw upsertError
}

async function movePeopleFromOtherIssues({
  date,
  meal,
  issueId,
  userIds,
  actorId,
  now
}: {
  date: string
  meal: MealType
  issueId: string
  userIds: string[]
  actorId: string
  now: string
}) {
  if (userIds.length === 0) return

  const activeIssueIds = await loadActiveIssueIds(date, meal, issueId)
  if (activeIssueIds.length === 0) return

  const { error } = await supabaseServer
    .from('registration_group_issue_items')
    .update({
      status: 'REMOVED',
      remove_reason: 'MOVED_TO_OTHER_ISSUE',
      moved_to_issue_id: issueId,
      removed_at: now,
      removed_by: actorId,
      updated_at: now
    })
    .in('issue_id', activeIssueIds)
    .in('user_id', userIds)
    .eq('status', 'PLANNED')

  if (error) throw error
}

async function prepareIssuablePeople({
  registrationGroupId,
  date,
  meal,
  requestedPeople
}: {
  registrationGroupId: string
  date: string
  meal: MealType
  requestedPeople: RequestedPerson[]
}) {
  const requestedByUserId = new Map(requestedPeople.map(item => [item.userId, item]))
  const groupPeople = await loadRegistrationGroupPeople(registrationGroupId, date)

  return filterIssuablePeople({
    users: groupPeople.filter((user: any) => requestedByUserId.has(user.id)),
    date,
    meal,
    source: 'REGISTRATION_GROUP'
  })
}

async function loadIssuePeople(issueId: string) {
  const items = await loadIssueItems(issueId)
  const userIds = items.map((item: any) => item.user_id).filter(Boolean)
  if (userIds.length === 0) return []

  const users = await loadUsersByIds(userIds)
  const userById = new Map(users.map((user: any) => [user.id, user]))

  return items.map((item: any): IssuablePerson & { itemStatus: string } => {
    const user: any = userById.get(item.user_id)
    return {
      id: item.user_id,
      name: fullName(user) || item.user_id,
      firstName: user?.meno || '',
      lastName: user?.priezvisko || '',
      email: user?.email || '',
      choice: normalizeChoice(item.volba || user?.typ_stravy) || 'MASO',
      source: 'REGISTRATION_GROUP',
      issuable: item.status === 'PLANNED',
      itemStatus: item.status || 'PLANNED'
    }
  })
}

function comparePeople(a: IssuablePerson, b: IssuablePerson) {
  return (
    cleanText(a.lastName).localeCompare(cleanText(b.lastName), 'sk', { sensitivity: 'base' }) ||
    cleanText(a.firstName).localeCompare(cleanText(b.firstName), 'sk', { sensitivity: 'base' }) ||
    cleanText(a.name).localeCompare(cleanText(b.name), 'sk', { sensitivity: 'base' })
  )
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const issueId = cleanText(req.nextUrl.searchParams.get('issueId'))
    const forceNewIssue = req.nextUrl.searchParams.get('newIssue') === 'true'
    const { date, meal, canSelectDateMeal } = await resolveExpressDateMeal(
      actor.id,
      req.nextUrl.searchParams.get('date'),
      req.nextUrl.searchParams.get('meal') || req.nextUrl.searchParams.get('typJedla')
    )

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    await validateIssueAccess(actor.id, registrationGroupId)

    const registrationGroup = await loadRegistrationGroup(registrationGroupId)
    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const expressIssues = await loadExpressIssues({ registrationGroupId, date, meal })
    const selectedIssue = issueId
      ? await loadExpressIssueById(issueId, registrationGroupId, date, meal)
      : null
    const issue = forceNewIssue ? null : selectedIssue || expressIssues[0] || null
    const plannedUserIds = await loadPlannedUserIds(date, meal, issue?.id || '')
    const groupUsers = await loadRegistrationGroupPeople(registrationGroupId, date)
    const people = await loadPreparationPeople({
      users: groupUsers,
      date,
      meal,
      source: 'REGISTRATION_GROUP',
      plannedUserIds
    })
    const issuablePeople = people
      .filter(person => person.issuable !== false)
      .sort(comparePeople)
    const pickupPeople = pickupPeopleFromGroupUsers(groupUsers)
    const pickupCandidateUserIds = new Set(pickupPeople.map(person => person.id))
    const selectedPeople = issue
      ? await loadIssuePeople(issue.id)
      : []
    const selectedIds = selectedPeople
      .filter(person => person.itemStatus === 'PLANNED')
      .map(person => person.id)
    const rawPickupUserIds = issue
      ? await loadPickupUsers(issue.id)
      : defaultPickupUserIds(actor.id, pickupCandidateUserIds)
    const pickupUserIds = rawPickupUserIds.filter(userId => pickupCandidateUserIds.has(userId))

    return NextResponse.json({
      ok: true,
      date,
      meal,
      canSelectDateMeal,
      group: {
        id: registrationGroup.id,
        name: registrationGroup.name || ''
      },
      issue: issue ? {
        id: issue.id,
        title: issue.title,
        status: issue.status,
        validAfter: issue.valid_after
      } : null,
      issues: await Promise.all(expressIssues.map(async (item: any) => {
        const itemPeople = await loadIssuePeople(item.id)
        const plannedPeople = itemPeople.filter(person => person.itemStatus === 'PLANNED')
        const pickupUserIds = await loadPickupUsers(item.id)

        return {
          id: item.id,
          title: item.title,
          status: item.status,
          validAfter: item.valid_after,
          selectedCount: plannedPeople.length,
          pickupCount: pickupUserIds.length
        }
      })),
      people: issuablePeople,
      pickupPeople,
      selectedIds,
      pickupUserIds,
      summary: choiceSummary(issuablePeople)
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const registrationGroupId = cleanText(body.registrationGroupId)
    const issueId = cleanText(body.issueId)
    const createNew = body.createNew === true
    const selectedUserIds = normalizeRequestedUserIds(body.userIds)
    const requestedPickupUserIds = normalizeRequestedUserIds(body.pickupUserIds)
    const { date, meal, canSelectDateMeal } = await resolveExpressDateMeal(
      actor.id,
      body.date || body.datum,
      body.meal || body.typJedla
    )

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chyba registracna skupina.' }, { status: 400 })
    }

    if (selectedUserIds.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    }

    const access = await validateIssueAccess(actor.id, registrationGroupId)
    const registrationGroup = await loadRegistrationGroup(registrationGroupId)

    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const groupPeople = await loadRegistrationGroupPeople(registrationGroupId, date)
    const pickupCandidateUserIds = new Set(groupPeople.map((user: any) => user.id).filter(Boolean))
    const pickupUserIds = requestedPickupUserIds.length > 0
      ? requestedPickupUserIds.filter(userId => pickupCandidateUserIds.has(userId))
      : defaultPickupUserIds(actor.id, pickupCandidateUserIds)

    if (pickupUserIds.length === 0) {
      return NextResponse.json({ error: 'Vyber osobu, ktora prevezme vydaj.' }, { status: 400 })
    }

    if (pickupUserIds.length !== requestedPickupUserIds.length && requestedPickupUserIds.length > 0) {
      return NextResponse.json(
        { error: 'Prevezme osoba môže byť iba osoba z aktuálnej registračnej skupiny.' },
        { status: 400 }
      )
    }

    const sequence = await nextExpressIssueSequence(registrationGroupId, date, meal)
    const title = expressIssueTitle(registrationGroup.name || '', meal, sequence)
    const fallbackTitle = expressIssueTitle(registrationGroup.name || '', meal)
    const existingIssue = issueId
      ? await loadExpressIssueById(issueId, registrationGroupId, date, meal)
      : createNew
        ? null
        : await findExpressIssue({
          actorId: actor.id,
          registrationGroupId,
          date,
          meal,
          title: fallbackTitle
        })

    if (issueId && !existingIssue) {
      return NextResponse.json({ error: 'Express vydaj neexistuje alebo ho nie je mozne upravit.' }, { status: 404 })
    }
    const requestedPeople = requestedPeopleFromIds(selectedUserIds)
    const currentItems = existingIssue ? await loadIssueItems(existingIssue.id) : []
    const currentByUserId = new Map((currentItems || []).map((item: any) => [item.user_id, item]))
    const existingRequestedUserIds = selectedUserIds.filter(userId => currentByUserId.has(userId))
    const newRequestedPeople = requestedPeople.filter(person => !currentByUserId.has(person.userId))
    const newIssuablePeople = await prepareIssuablePeople({
      registrationGroupId,
      date,
      meal,
      requestedPeople: existingIssue ? newRequestedPeople : requestedPeople
    })
    const retainedUserIds = Array.from(new Set([
      ...existingRequestedUserIds,
      ...newIssuablePeople.map(person => person.id)
    ]))

    if (retainedUserIds.length === 0) {
      return NextResponse.json(
        { error: 'Z vybranych osob nie je aktualne nikto vydatelny.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const nextIssueState = nextIssueStateForAccess(access)

    let issue = existingIssue

    if (!issue) {
      const { data, error } = await supabaseServer
        .from('registration_group_issues')
        .insert({
          registration_group_id: registrationGroupId,
          title,
          datum: date,
          typ_jedla: meal,
          status: nextIssueState.status,
          valid_after: nextIssueState.validAfter,
          created_by: actor.id,
          created_by_access: access,
          updated_at: now
        })
        .select('id, title, datum, typ_jedla, status, valid_after')
        .single()

      if (error || !data) {
        return NextResponse.json(
          { error: error?.message || 'Express vydaj sa nepodarilo vytvorit.' },
          { status: 500 }
        )
      }

      issue = data
    } else {
      const { error } = await supabaseServer
        .from('registration_group_issues')
        .update({
          status: nextIssueState.status,
          valid_after: nextIssueState.validAfter,
          updated_at: now
        })
        .eq('id', issue.id)

      if (error) throw error
    }

    try {
      await movePeopleFromOtherIssues({
        date,
        meal,
        issueId: issue.id,
        userIds: newIssuablePeople.map(person => person.id),
        actorId: actor.id,
        now
      })

      if (currentItems.length > 0) {
        const { error: removeOldError } = await supabaseServer
          .from('registration_group_issue_items')
          .update({
            status: 'REMOVED',
            remove_reason: 'MANUAL',
            removed_at: now,
            removed_by: actor.id,
            updated_at: now
          })
          .eq('issue_id', issue.id)
          .eq('status', 'PLANNED')
          .not('user_id', 'in', `(${retainedUserIds.join(',')})`)

        if (removeOldError) throw removeOldError
      }

      if (newIssuablePeople.length > 0) {
        const { error: upsertError } = await supabaseServer
          .from('registration_group_issue_items')
          .upsert(
            newIssuablePeople.map(person => ({
              issue_id: issue.id,
              user_id: person.id,
              source: 'REGISTRATION_GROUP',
              volba: person.choice,
              status: 'PLANNED',
              remove_reason: null,
              moved_to_issue_id: null,
              removed_at: null,
              removed_by: null,
              added_by: actor.id,
              updated_at: now
            })),
            { onConflict: 'issue_id,user_id' }
          )

        if (upsertError) throw upsertError
      }

      const existingPlannedRows = currentItems
        .filter((item: any) => item.status === 'PLANNED' && existingRequestedUserIds.includes(item.user_id))

      if (existingPlannedRows.length > 0) {
        const { error: keepError } = await supabaseServer
          .from('registration_group_issue_items')
          .upsert(
            existingPlannedRows.map((item: any) => ({
              issue_id: issue.id,
              user_id: item.user_id,
              source: 'REGISTRATION_GROUP',
              volba: normalizeChoice(item.volba) || 'MASO',
              status: 'PLANNED',
              remove_reason: null,
              moved_to_issue_id: null,
              removed_at: null,
              removed_by: null,
              added_by: actor.id,
              updated_at: now
            })),
            { onConflict: 'issue_id,user_id' }
          )

        if (keepError) throw keepError
      }

      await replacePickupUsers(issue.id, pickupUserIds, actor.id)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const refreshedPeople = await loadIssuePeople(issue.id)
    const plannedPeople = refreshedPeople.filter(person => person.itemStatus === 'PLANNED')

    return NextResponse.json({
      ok: true,
      issue: {
        id: issue.id,
        title: issue.title || title,
        status: nextIssueState.status,
        validAfter: nextIssueState.validAfter
      },
      date,
      meal,
      canSelectDateMeal,
      selectedIds: plannedPeople.map(person => person.id),
      pickupUserIds,
      summary: choiceSummary(plannedPeople),
      message: nextIssueState.immediate
        ? 'Express vydaj je pripraveny a je platny.'
        : 'Express vydaj je pripraveny. Zacne platit o 15 minut.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}
