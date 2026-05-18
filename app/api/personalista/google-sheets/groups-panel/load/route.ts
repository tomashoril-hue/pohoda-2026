import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

const MAX_ROWS = 300

function text(value: any) {
  return String(value || '').trim()
}

function authorized(req: NextRequest, body: any) {
  const expected = process.env.GOOGLE_SHEETS_IMPORT_TOKEN
  const provided = req.headers.get('x-pohoda-token') || body?.token || ''

  return Boolean(expected) && provided === expected
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!authorized(req, body)) {
      return NextResponse.json({ error: 'Neplatny Google Sheets token.' }, { status: 401 })
    }

    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : []

    const userIds = Array.from(new Set(
      rows.map((row: any) => text(row.userId || row.user_id)).filter(Boolean)
    ))

    const { data: groups, error: groupsError } = await supabaseServer
      .from('groups')
      .select('id, name')
      .order('name', { ascending: true })

    if (groupsError) {
      return NextResponse.json({ error: groupsError.message }, { status: 500 })
    }

    let usersById = new Map<string, any>()
    const groupsByUserId = new Map<string, any[]>()

    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, updated_at')
        .in('id', userIds)

      if (usersError) {
        return NextResponse.json({ error: usersError.message }, { status: 500 })
      }

      usersById = new Map((users || []).map((user: any) => [user.id, user]))

      const { data: memberships, error: membershipsError } = await supabaseServer
        .from('group_members')
        .select(`
          user_id,
          role,
          groups (
            id,
            name
          )
        `)
        .in('user_id', userIds)

      if (membershipsError) {
        return NextResponse.json({ error: membershipsError.message }, { status: 500 })
      }

      ;(memberships || []).forEach((membership: any) => {
        const group = Array.isArray(membership.groups)
          ? membership.groups[0]
          : membership.groups

        if (!group?.id) return

        const list = groupsByUserId.get(membership.user_id) || []

        list.push({
          id: group.id,
          name: group.name,
          role: membership.role || 'MEMBER'
        })

        groupsByUserId.set(membership.user_id, list)
      })
    }

    const results = rows.map((row: any) => {
      const rowNumber = Number(row.rowNumber || row.row || 0) || null
      const userId = text(row.userId || row.user_id)

      if (!userId) {
        return {
          rowNumber,
          status: 'READY',
          message: 'Osoba este nema user_id. Najprv ju importuj.',
          userId: '',
          groups: '',
          groupItems: []
        }
      }

      const user = usersById.get(userId)

      if (!user) {
        return {
          rowNumber,
          status: 'ERROR',
          message: 'Osoba sa nenasla.',
          userId,
          groups: '',
          groupItems: []
        }
      }

      const groupItems = groupsByUserId.get(userId) || []
      const groupNames = groupItems.map(group => group.name).filter(Boolean)

      return {
        rowNumber,
        status: 'OK',
        message: 'Skupiny nacitane.',
        userId: user.id,
        meno: user.meno || '',
        priezvisko: user.priezvisko || '',
        fullName: fullName(user) || user.email || '',
        email: user.email || '',
        groups: groupNames.join('|'),
        groupItems
      }
    })

    return NextResponse.json({
      ok: true,
      groups: groups || [],
      results
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}