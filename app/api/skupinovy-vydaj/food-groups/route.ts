import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import {
  cleanText,
  getIssueAccess,
  loadPreparationPeople,
  loadUsersByIds,
  normalizeChoice,
  type MealType,
  normalizeDate,
  normalizeMeal
} from '@/lib/registrationGroupIssue'

async function loadPlannedGroupIssueUserIds(date: string, meal: string) {
  const { data: issues, error: issuesError } = await supabaseServer
    .from('registration_group_issues')
    .select('id')
    .eq('datum', date)
    .eq('typ_jedla', meal)
    .in('status', ['READY', 'WAITING'])

  if (issuesError) throw issuesError

  const issueIds = (issues || []).map((row: any) => row.id).filter(Boolean)
  if (issueIds.length === 0) return new Set<string>()

  const { data: items, error: itemsError } = await supabaseServer
    .from('registration_group_issue_items')
    .select('user_id')
    .in('issue_id', issueIds)
    .eq('status', 'PLANNED')

  if (itemsError) throw itemsError

  return new Set((items || []).map((row: any) => row.user_id).filter(Boolean))
}

async function findUserByQr(qrCode: string) {
  const [qrResult, userResult] = await Promise.all([
    supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', qrCode)
      .eq('active', true)
      .maybeSingle(),
    supabaseServer
      .from('users')
      .select('id')
      .eq('qr_code', qrCode)
      .maybeSingle()
  ])

  if (qrResult.error) throw qrResult.error
  if (qrResult.data?.user_id) return qrResult.data.user_id

  if (userResult.error) throw userResult.error
  return userResult.data?.id || ''
}

async function assertGroupAccess(actorId: string, registrationGroupId: string) {
  const access = await getIssueAccess(actorId, registrationGroupId)

  if (!access) {
    throw Object.assign(new Error('Nemáš oprávnenie pre túto registračnú skupinu.'), { status: 403 })
  }

  return access
}

function normalizeUserIds(value: any) {
  return Array.from(new Set<string>(
    Array.isArray(value)
      ? value.map((id: any) => cleanText(id)).filter(Boolean)
      : []
  ))
}

function displayName(user: any) {
  const firstName = cleanText(user?.meno)
  const lastName = cleanText(user?.priezvisko)
  return `${lastName} ${firstName}`.trim() || user?.email || user?.id || 'Bez mena'
}

async function loadFoodGroups(registrationGroupId: string) {
  const { data, error } = await supabaseServer
    .from('groups')
    .select('id, name, registration_group_id, created_at')
    .eq('registration_group_id', registrationGroupId)
    .order('name', { ascending: true })

  if (error) throw error

  const groupIds = (data || []).map((group: any) => group.id).filter(Boolean)
  const memberCountByGroupId = new Map<string, number>()

  if (groupIds.length > 0) {
    const { data: memberships, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds)

    if (membershipError) throw membershipError

    ;(memberships || []).forEach((membership: any) => {
      memberCountByGroupId.set(
        membership.group_id,
        (memberCountByGroupId.get(membership.group_id) || 0) + 1
      )
    })
  }

  return (data || []).map((group: any) => ({
    id: group.id,
    name: group.name || '',
    registrationGroupId: group.registration_group_id || '',
    memberCount: memberCountByGroupId.get(group.id) || 0
  }))
}

async function loadFoodGroupMembers(groupId: string) {
  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)

  if (error) throw error

  const userIds = Array.from(new Set((memberships || []).map((row: any) => row.user_id).filter(Boolean)))
  if (userIds.length === 0) return []

  const users = await loadUsersByIds(userIds)
  const userById = new Map(users.map((user: any) => [user.id, user]))

  return userIds
    .map(userId => {
      const user: any = userById.get(userId)
      return {
        id: userId,
        name: displayName(user),
        email: user?.email || '',
        foodChoice: normalizeChoice(user?.typ_stravy) || ''
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'sk', { sensitivity: 'base' }))
}

async function loadFoodGroupPeople(groupId: string, date: string, meal: MealType) {
  const members = await loadFoodGroupMembers(groupId)
  const users = await loadUsersByIds(members.map(member => member.id))
  const plannedUserIds = await loadPlannedGroupIssueUserIds(date, meal)
  const people = await loadPreparationPeople({
    users,
    date,
    meal,
    source: 'FOOD_GROUP',
    plannedUserIds
  })

  return { people, members }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const registrationGroupId = cleanText(req.nextUrl.searchParams.get('registrationGroupId'))
    const foodGroupId = cleanText(req.nextUrl.searchParams.get('foodGroupId'))
    const date = normalizeDate(req.nextUrl.searchParams.get('date'))
    const meal = normalizeMeal(req.nextUrl.searchParams.get('meal'))
    const query = cleanText(req.nextUrl.searchParams.get('q')).replaceAll('%', '').replaceAll(',', ' ')
    const qrCode = cleanText(req.nextUrl.searchParams.get('qrCode'))

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chýba registračná skupina.' }, { status: 400 })
    }

    await assertGroupAccess(actor.id, registrationGroupId)

    if (qrCode) {
      const userId = await findUserByQr(qrCode)
      if (!userId) return NextResponse.json({ error: 'QR kód sa nenašiel alebo nie je aktívny.' }, { status: 404 })

      const users = await loadUsersByIds([userId])
      const user: any = users[0]
      if (!user) return NextResponse.json({ error: 'Osoba sa nenašla.' }, { status: 404 })

      return NextResponse.json({
        user: {
          id: user.id,
          name: displayName(user),
          email: user.email || '',
          foodChoice: normalizeChoice(user.typ_stravy) || ''
        }
      })
    }

    if (query) {
      if (query.length < 3) return NextResponse.json({ users: [] })

      const pattern = `%${query}%`
      const { data, error } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, aktivny, typ_stravy')
        .eq('aktivny', 'ANO')
        .or(`meno.ilike.${pattern},priezvisko.ilike.${pattern},email.ilike.${pattern}`)
        .order('priezvisko', { ascending: true })
        .order('meno', { ascending: true })
        .limit(20)

      if (error) throw error

      return NextResponse.json({
        users: (data || []).map((user: any) => ({
          id: user.id,
          name: displayName(user),
          email: user.email || '',
          foodChoice: normalizeChoice(user.typ_stravy) || ''
        }))
      })
    }

    const groups = await loadFoodGroups(registrationGroupId)

    if (foodGroupId) {
      const selected = groups.find(group => group.id === foodGroupId)
      if (!selected) return NextResponse.json({ error: 'Stravovacia skupina nepatrí pod túto registračnú skupinu.' }, { status: 404 })

      if (!date || !meal) {
        const members = await loadFoodGroupMembers(foodGroupId)

        return NextResponse.json({
          ok: true,
          groups,
          group: selected,
          members,
          people: []
        })
      }

      const { people, members } = await loadFoodGroupPeople(foodGroupId, date, meal)

      return NextResponse.json({
        ok: true,
        groups,
        group: selected,
        members,
        people
      })
    }

    return NextResponse.json({ ok: true, groups })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = cleanText(body.registrationGroupId)
    const foodGroupId = cleanText(body.foodGroupId)
    const name = cleanText(body.name)
    const memberUserIds = normalizeUserIds(body.memberUserIds)

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Chýba registračná skupina.' }, { status: 400 })
    }

    if (!name) {
      return NextResponse.json({ error: 'Zadaj názov stravovacej skupiny.' }, { status: 400 })
    }

    await assertGroupAccess(actor.id, registrationGroupId)

    const payload: any = {
      name,
      registration_group_id: registrationGroupId
    }

    if (!foodGroupId) payload.created_by = actor.id

    const { data: group, error: groupError } = foodGroupId
      ? await supabaseServer
        .from('groups')
        .update(payload)
        .eq('id', foodGroupId)
        .eq('registration_group_id', registrationGroupId)
        .select('id, name, registration_group_id')
        .single()
      : await supabaseServer
        .from('groups')
        .insert(payload)
        .select('id, name, registration_group_id')
        .single()

    if (groupError || !group) {
      return NextResponse.json(
        { error: groupError?.message || 'Stravovaciu skupinu sa nepodarilo uložiť.' },
        { status: 500 }
      )
    }

    const { error: deleteError } = await supabaseServer
      .from('group_members')
      .delete()
      .eq('group_id', group.id)

    if (deleteError) throw deleteError

    if (memberUserIds.length > 0) {
      const { error: insertError } = await supabaseServer
        .from('group_members')
        .insert(memberUserIds.map(userId => ({
          group_id: group.id,
          user_id: userId,
          role: 'MEMBER'
        })))

      if (insertError) throw insertError
    }

    const groups = await loadFoodGroups(registrationGroupId)

    return NextResponse.json({
      ok: true,
      group: {
        id: group.id,
        name: group.name || '',
        registrationGroupId: group.registration_group_id || '',
        memberCount: memberUserIds.length
      },
      groups,
      message: foodGroupId ? 'Stravovacia skupina bola uložená.' : 'Stravovacia skupina bola vytvorená.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: err?.status || 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const registrationGroupId = cleanText(body.registrationGroupId)
    const foodGroupId = cleanText(body.foodGroupId)

    if (!registrationGroupId || !foodGroupId) {
      return NextResponse.json({ error: 'Chýba registračná alebo stravovacia skupina.' }, { status: 400 })
    }

    await assertGroupAccess(actor.id, registrationGroupId)

    const { data: group, error: groupError } = await supabaseServer
      .from('groups')
      .select('id, name')
      .eq('id', foodGroupId)
      .eq('registration_group_id', registrationGroupId)
      .maybeSingle()

    if (groupError) throw groupError
    if (!group) {
      return NextResponse.json({ error: 'Stravovacia skupina sa nenašla.' }, { status: 404 })
    }

    const { error: memberError } = await supabaseServer
      .from('group_members')
      .delete()
      .eq('group_id', foodGroupId)

    if (memberError) throw memberError

    const { error: deleteError } = await supabaseServer
      .from('groups')
      .delete()
      .eq('id', foodGroupId)
      .eq('registration_group_id', registrationGroupId)

    if (deleteError) throw deleteError

    const groups = await loadFoodGroups(registrationGroupId)

    return NextResponse.json({
      ok: true,
      groups,
      message: `Stravovacia skupina "${group.name || ''}" bola zrušená.`
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Stravovaciu skupinu sa nepodarilo zrušiť.' },
      { status: err?.status || 500 }
    )
  }
}
