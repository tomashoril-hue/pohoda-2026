import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanRole(value: any, isGlobalManager: boolean) {
  const role = cleanText(value).toUpperCase()

  if (role === 'MEMBER') return 'MEMBER'
  if (role === 'POVERENY') return 'POVERENY'
  if (isGlobalManager && role === 'MANAGER') return 'MANAGER'
  if (isGlobalManager && role === 'OWNER') return 'OWNER'

  return ''
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const groupId = cleanText(body.groupId)
    const action = cleanText(body.action).toUpperCase()

    if (!userId || !groupId) {
      return NextResponse.json({ error: 'Chyba osoba alebo skupina.' }, { status: 400 })
    }

    if (!['ADD', 'UPDATE_ROLE', 'REMOVE'].includes(action)) {
      return NextResponse.json({ error: 'Neplatna akcia skupiny.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    const isGlobalManager = !!access.globalAccess?.canUsePersonalista

    if (!isGlobalManager && !access.manageableGroupIds.includes(groupId)) {
      return NextResponse.json(
        { error: 'Tuto skupinu moze menit iba jej MANAGER alebo OWNER.' },
        { status: 403 }
      )
    }

    const role = action === 'REMOVE'
      ? ''
      : cleanRole(body.role || 'MEMBER', isGlobalManager)

    if (action !== 'REMOVE' && !role) {
      return NextResponse.json(
        { error: isGlobalManager ? 'Vyber platnu rolu.' : 'Manager moze nastavit iba MEMBER alebo POVERENY.' },
        { status: 400 }
      )
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    if (!group) {
      return NextResponse.json({ error: 'Skupina neexistuje.' }, { status: 404 })
    }

    const { data: before } = await supabaseServer
      .from('group_members')
      .select('id, group_id, user_id, role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle()

    if (action === 'ADD') {
      if (before) {
        return NextResponse.json({ error: 'Osoba uz je v tejto skupine.' }, { status: 409 })
      }

      const { error: insertError } = await supabaseServer
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: userId,
          role
        })

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    if (action === 'UPDATE_ROLE') {
      if (!before) {
        return NextResponse.json({ error: 'Osoba nie je v tejto skupine.' }, { status: 404 })
      }

      const { error: updateError } = await supabaseServer
        .from('group_members')
        .update({ role })
        .eq('group_id', groupId)
        .eq('user_id', userId)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    if (action === 'REMOVE') {
      if (!before) {
        return NextResponse.json({ error: 'Osoba nie je v tejto skupine.' }, { status: 404 })
      }

      const { error: deleteError } = await supabaseServer
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', userId)

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        group_id: groupId,
        action: `PERSON_GROUP_${action}`,
        entity_table: 'group_members',
        entity_id: before?.id || null,
        before_data: before || null,
        after_data: {
          group_id: groupId,
          group_name: group.name,
          role: role || null
        }
      })

    return NextResponse.json({
      ok: true,
      message:
        action === 'ADD'
          ? 'Osoba bola pridana do skupiny.'
          : action === 'UPDATE_ROLE'
            ? 'Rola v skupine bola zmenena.'
            : 'Osoba bola odobrata zo skupiny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
