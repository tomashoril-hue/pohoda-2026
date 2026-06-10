import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  FoodChoice,
  IssueAccess,
  IssuablePerson,
  MealType,
  choiceSummary,
  cleanText,
  filterIssuablePeople,
  getIssueAccess,
  issueTitle,
  loadRegistrationGroup,
  loadRegistrationGroupPeople,
  loadUsersByIds,
  normalizeChoice,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

type RequestedPerson = {
  userId: string
  source: 'REGISTRATION_GROUP' | 'SEARCH' | 'QR'
}

function normalizeRequestedPeople(value: any): RequestedPerson[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const people: RequestedPerson[] = []

  value.forEach((item: any) => {
    const userId = cleanText(item?.userId || item?.id)
    const sourceText = cleanText(item?.source).toUpperCase()
    const source = sourceText === 'SEARCH' || sourceText === 'QR'
      ? sourceText
      : 'REGISTRATION_GROUP'

    if (!userId || seen.has(userId)) return

    seen.add(userId)
    people.push({ userId, source })
  })

  return people
}

function normalizePickupUserIds(value: any): string[] {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

function statusForAccess(access: IssueAccess) {
  if (access === 'DELEGATE') {
    return {
      status: 'WAITING',
      validAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }
  }

  return {
    status: 'READY',
    validAfter: null
  }
}

async function loadActiveIssueIds(date: string, meal: MealType, excludedIssueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id')
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .in('status', ['READY', 'WAITING'])
    .neq('id', excludedIssueId)

  if (error) throw error

  return (data || []).map((row: any) => row.id).filter(Boolean)
}

async function nextIssueSequence(registrationGroupId: string, date: string, meal: MealType) {
  const { count, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id', { count: 'exact', head: true })
    .eq('registration_group_id', registrationGroupId)
    .eq('datum', date)
    .eq('typ_jedla', meal)

  if (error) throw error

  return (count || 0) + 1
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
  const groupPeopleById = new Map(groupPeople.map((user: any) => [user.id, user]))
  const externalUserIds = requestedPeople
    .map(item => item.userId)
    .filter(userId => !groupPeopleById.has(userId))
  const externalPeople = await loadUsersByIds(externalUserIds)

  const issuableGroupPeople = await filterIssuablePeople({
    users: groupPeople.filter((user: any) => requestedByUserId.has(user.id)),
    date,
    meal,
    source: 'REGISTRATION_GROUP'
  })
  const issuableExternalPeople = await filterIssuablePeople({
    users: externalPeople,
    date,
    meal,
    source: 'SEARCH'
  })

  return [...issuableGroupPeople, ...issuableExternalPeople]
    .map(person => ({
      ...person,
      source: requestedByUserId.get(person.id)?.source || person.source
    }))
}

async function loadIssuePeople(issueId: string, date: string, meal: MealType) {
  const { data: items, error: itemsError } = await supabaseServer
    .from('registration_group_issue_items')
    .select('id, user_id, source, volba, status')
    .eq('issue_id', issueId)
    .eq('status', 'PLANNED')

  if (itemsError) throw itemsError

  const userIds = (items || []).map((item: any) => item.user_id).filter(Boolean)
  const users = await loadUsersByIds(userIds)
  const sourceByUserId = new Map((items || []).map((item: any) => [item.user_id, item.source || 'SEARCH']))
  const storedChoiceByUserId = new Map((items || []).map((item: any) => [item.user_id, normalizeChoice(item.volba)]))
  const people = await filterIssuablePeople({
    users,
    date,
    meal,
    source: 'SEARCH'
  })

  return people.map((person: IssuablePerson) => ({
    ...person,
    choice: storedChoiceByUserId.get(person.id) as FoodChoice || person.choice,
    source: sourceByUserId.get(person.id) || person.source
  }))
}

async function loadPickupUserIds(issueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issue_pickup_users')
    .select('user_id')
    .eq('issue_id', issueId)

  if (error) throw error

  return (data || []).map((row: any) => row.user_id).filter(Boolean)
}

async function replacePickupUsers(issueId: string, userIds: string[], actorId: string) {
  const { error: deleteError } = await supabaseServer
    .from('registration_group_issue_pickup_users')
    .delete()
    .eq('issue_id', issueId)

  if (deleteError) throw deleteError

  if (userIds.length === 0) return

  const { error: insertError } = await supabaseServer
    .from('registration_group_issue_pickup_users')
    .insert(userIds.map(userId => ({
      issue_id: issueId,
      user_id: userId,
      created_by: actorId
    })))

  if (insertError) throw insertError
}

async function validateIssueAccess(actorId: string, registrationGroupId: string) {
  const access = await getIssueAccess(actorId, registrationGroupId)

  if (!access) {
    throw Object.assign(new Error('Nemas opravnenie pre tuto registracnu skupinu.'), { status: 403 })
  }

  return access
}

async function loadIssueOr404(issueId: string) {
  const { data, error } = await supabaseServer
    .from('registration_group_issues')
    .select('id, registration_group_id, title, datum, typ_jedla, status, valid_after')
    .eq('id', issueId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw Object.assign(new Error('Skupinovy vydaj neexistuje.'), { status: 404 })

  return data
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const issueId = cleanText(req.nextUrl.searchParams.get('issueId'))

    if (issueId) {
      const issue = await loadIssueOr404(issueId)
      const meal = normalizeMeal(issue.typ_jedla)
      const date = normalizeDate(issue.datum)

      if (!meal || !date) {
        return NextResponse.json({ error: 'Neplatny skupinovy vydaj.' }, { status: 400 })
      }

      await validateIssueAccess(actor.id, issue.registration_group_id)

      const [people, pickupUserIds] = await Promise.all([
        loadIssuePeople(issue.id, date, meal),
        loadPickupUserIds(issue.id)
      ])

      return NextResponse.json({
        issue: {
          id: issue.id,
          registrationGroupId: issue.registration_group_id,
          title: issue.title,
          date,
          meal,
          status: issue.status,
          validAfter: issue.valid_after,
          people,
          pickupUserIds,
          summary: choiceSummary(people)
        }
      })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))

    if (!registrationGroupId || !date) {
      return NextResponse.json({ error: 'Chyba registracna skupina alebo datum.' }, { status: 400 })
    }

    await validateIssueAccess(actor.id, registrationGroupId)

    let query = supabaseServer
      .from('registration_group_issues')
      .select('id, title, datum, typ_jedla, status, valid_after, created_at')
      .eq('registration_group_id', registrationGroupId)
      .eq('datum', date)
      .in('status', ['READY', 'WAITING'])
      .order('typ_jedla', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(50)

    if (meal) query = query.eq('typ_jedla', meal)

    const { data: issues, error } = await query

    if (error) throw error

    const result = []

    for (const issue of issues || []) {
      const issueMeal = normalizeMeal(issue.typ_jedla)
      if (!issueMeal) continue

      const people = await loadIssuePeople(issue.id, date, issueMeal)
      result.push({
        id: issue.id,
        title: issue.title,
        meal: issueMeal,
        status: issue.status,
        validAfter: issue.valid_after,
        summary: choiceSummary(people)
      })
    }

    return NextResponse.json({ issues: result })
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
    const date = normalizeDate(body.date || body.datum)
    const meal = normalizeMeal(body.meal || body.typJedla)
    const requestedPeople = normalizeRequestedPeople(body.people)
    const pickupUserIds = normalizePickupUserIds(body.pickupUserIds)

    if (!registrationGroupId || !date || !meal) {
      return NextResponse.json({ error: 'Chyba registracna skupina, datum alebo jedlo.' }, { status: 400 })
    }

    if (requestedPeople.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    }

    const access = await validateIssueAccess(actor.id, registrationGroupId)
    const registrationGroup = await loadRegistrationGroup(registrationGroupId)

    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const issuablePeople = await prepareIssuablePeople({ registrationGroupId, date, meal, requestedPeople })
    const issuableUserIds = issuablePeople.map(person => person.id)

    if (issuablePeople.length === 0) {
      return NextResponse.json(
        { error: 'Z vybranych osob nie je aktualne nikto vydatelny.' },
        { status: 400 }
      )
    }

    const finalPickupUserIds = pickupUserIds.filter(userId => issuableUserIds.includes(userId))
    if (finalPickupUserIds.length === 0) finalPickupUserIds.push(issuableUserIds[0])

    const nextStatus = statusForAccess(access)
    const now = new Date().toISOString()
    const sequence = await nextIssueSequence(registrationGroupId, date, meal)
    const title = issueTitle(registrationGroup.name, meal, body.title, sequence)

    const { data: issue, error: issueError } = await supabaseServer
      .from('registration_group_issues')
      .insert({
        registration_group_id: registrationGroupId,
        title,
        datum: date,
        typ_jedla: meal,
        status: nextStatus.status,
        valid_after: nextStatus.validAfter,
        created_by: actor.id,
        created_by_access: access,
        updated_at: now
      })
      .select('id, title, datum, typ_jedla, status, valid_after')
      .single()

    if (issueError || !issue) {
      return NextResponse.json(
        { error: issueError?.message || 'Skupinovy vydaj sa nepodarilo vytvorit.' },
        { status: 500 }
      )
    }

    try {
      await movePeopleFromOtherIssues({
        date,
        meal,
        issueId: issue.id,
        userIds: issuableUserIds,
        actorId: actor.id,
        now
      })

      await supabaseServer
        .from('registration_group_issue_items')
        .insert(issuablePeople.map(person => ({
          issue_id: issue.id,
          user_id: person.id,
          source: person.source,
          volba: person.choice,
          status: 'PLANNED',
          added_by: actor.id,
          updated_at: now
        })))

      await replacePickupUsers(issue.id, finalPickupUserIds, actor.id)
    } catch (error: any) {
      await supabaseServer.from('registration_group_issues').delete().eq('id', issue.id)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const summary = choiceSummary(issuablePeople)
    const skippedCount = requestedPeople.length - issuablePeople.length

    return NextResponse.json({
      ok: true,
      issueId: issue.id,
      title: issue.title,
      status: issue.status,
      validAfter: issue.valid_after,
      summary,
      skippedCount,
      message: issue.status === 'WAITING'
        ? 'Skupinovy vydaj bol vytvoreny. Zacne platit o 15 minut.'
        : 'Skupinovy vydaj bol vytvoreny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const issueId = cleanText(body.issueId)
    const requestedPeople = normalizeRequestedPeople(body.people)
    const pickupUserIds = normalizePickupUserIds(body.pickupUserIds)

    if (!issueId) {
      return NextResponse.json({ error: 'Chyba skupinovy vydaj.' }, { status: 400 })
    }

    if (requestedPeople.length === 0) {
      return NextResponse.json({ error: 'Vyber aspon jednu osobu.' }, { status: 400 })
    }

    const issue = await loadIssueOr404(issueId)
    const date = normalizeDate(issue.datum)
    const meal = normalizeMeal(issue.typ_jedla)

    if (!date || !meal || issue.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Skupinovy vydaj nie je mozne upravit.' }, { status: 400 })
    }

    const access = await validateIssueAccess(actor.id, issue.registration_group_id)
    const registrationGroup = await loadRegistrationGroup(issue.registration_group_id)

    if (!registrationGroup || registrationGroup.active === false) {
      return NextResponse.json({ error: 'Registracna skupina neexistuje alebo nie je aktivna.' }, { status: 404 })
    }

    const issuablePeople = await prepareIssuablePeople({
      registrationGroupId: issue.registration_group_id,
      date,
      meal,
      requestedPeople
    })
    const issuableUserIds = issuablePeople.map(person => person.id)

    if (issuablePeople.length === 0) {
      return NextResponse.json(
        { error: 'Z vybranych osob nie je aktualne nikto vydatelny.' },
        { status: 400 }
      )
    }

    const finalPickupUserIds = pickupUserIds.filter(userId => issuableUserIds.includes(userId))
    if (finalPickupUserIds.length === 0) finalPickupUserIds.push(issuableUserIds[0])

    const nextStatus = statusForAccess(access)
    const now = new Date().toISOString()
    const title = cleanText(body.title) || issue.title

    const { error: updateIssueError } = await supabaseServer
      .from('registration_group_issues')
      .update({
        title,
        status: nextStatus.status,
        valid_after: nextStatus.validAfter,
        updated_at: now
      })
      .eq('id', issue.id)

    if (updateIssueError) {
      return NextResponse.json({ error: updateIssueError.message }, { status: 500 })
    }

    try {
      await movePeopleFromOtherIssues({
        date,
        meal,
        issueId: issue.id,
        userIds: issuableUserIds,
        actorId: actor.id,
        now
      })

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
        .not('user_id', 'in', `(${issuableUserIds.join(',')})`)

      if (removeOldError) throw removeOldError

      const { error: upsertItemsError } = await supabaseServer
        .from('registration_group_issue_items')
        .upsert(
          issuablePeople.map(person => ({
            issue_id: issue.id,
            user_id: person.id,
            source: person.source,
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

      if (upsertItemsError) throw upsertItemsError

      await replacePickupUsers(issue.id, finalPickupUserIds, actor.id)
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const summary = choiceSummary(issuablePeople)
    const skippedCount = requestedPeople.length - issuablePeople.length

    return NextResponse.json({
      ok: true,
      issueId: issue.id,
      title,
      status: nextStatus.status,
      validAfter: nextStatus.validAfter,
      summary,
      skippedCount,
      message: nextStatus.status === 'WAITING'
        ? 'Skupinovy vydaj bol upraveny. Zmena zacne platit o 15 minut.'
        : 'Skupinovy vydaj bol upraveny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const issueId = cleanText(body.issueId)

    if (!issueId) {
      return NextResponse.json({ error: 'Chyba skupinovy vydaj.' }, { status: 400 })
    }

    const issue = await loadIssueOr404(issueId)

    if (issue.status === 'CANCELLED') {
      return NextResponse.json({ ok: true, message: 'Skupinovy vydaj uz bol zruseny.' })
    }

    await validateIssueAccess(actor.id, issue.registration_group_id)

    const now = new Date().toISOString()

    const { error: issueError } = await supabaseServer
      .from('registration_group_issues')
      .update({
        status: 'CANCELLED',
        updated_at: now
      })
      .eq('id', issue.id)

    if (issueError) throw issueError

    const { error: itemsError } = await supabaseServer
      .from('registration_group_issue_items')
      .update({
        status: 'REMOVED',
        remove_reason: 'GROUP_CANCELLED',
        removed_at: now,
        removed_by: actor.id,
        updated_at: now
      })
      .eq('issue_id', issue.id)
      .eq('status', 'PLANNED')

    if (itemsError) throw itemsError

    return NextResponse.json({
      ok: true,
      message: 'Skupinovy vydaj bol zruseny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}
