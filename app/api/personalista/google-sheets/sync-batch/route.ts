import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

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

    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : []

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Chybaju riadky na synchronizaciu.' }, { status: 400 })
    }

    const userIds = Array.from(new Set(
      rows.map((row: any) => text(row.userId || row.user_id)).filter(Boolean)
    ))
    const emails = Array.from(new Set(
      rows.map((row: any) => text(row.email).toLowerCase()).filter(Boolean)
    ))

    let usersById = new Map<string, any>()
    let usersByEmail = new Map<string, any>()

    if (userIds.length > 0) {
      const { data: usersByIdData } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, updated_at')
        .in('id', userIds)

      usersById = new Map((usersByIdData || []).map((user: any) => [user.id, user]))
    }

    if (emails.length > 0) {
      const { data: usersByEmailData } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, updated_at')
        .in('email', emails)

      usersByEmail = new Map((usersByEmailData || []).map((user: any) => [String(user.email || '').toLowerCase(), user]))
    }

    const foundUsers = Array.from(new Map([
      ...Array.from(usersById.values()).map((user: any) => [user.id, user] as const),
      ...Array.from(usersByEmail.values()).map((user: any) => [user.id, user] as const)
    ]).values())

    const foundUserIds = foundUsers.map((user: any) => user.id)
    let qrByUserId = new Map<string, string>()
    const groupsByUserId = new Map<string, string[]>()
    const claimsByUserId = new Map<string, { days: Set<string>; lunches: number; dinners: number }>()

    if (foundUserIds.length > 0) {
      const { data: qrRows } = await supabaseServer
        .from('user_qr_codes')
        .select('user_id, qr_code')
        .in('user_id', foundUserIds)
        .eq('active', true)

      qrByUserId = new Map((qrRows || []).map((row: any) => [row.user_id, row.qr_code]))

      const { data: membershipRows } = await supabaseServer
        .from('group_members')
        .select(`
          user_id,
          groups (
            name
          )
        `)
        .in('user_id', foundUserIds)

      ;(membershipRows || []).forEach((row: any) => {
        const group = Array.isArray(row.groups) ? row.groups[0] : row.groups
        const list = groupsByUserId.get(row.user_id) || []

        if (group?.name) list.push(group.name)
        groupsByUserId.set(row.user_id, list)
      })

      const { data: claimRows } = await supabaseServer
        .from('user_food_entitlements')
        .select('user_id, datum, obed, vecera')
        .in('user_id', foundUserIds)

      ;(claimRows || []).forEach((row: any) => {
        const current = claimsByUserId.get(row.user_id) || {
          days: new Set<string>(),
          lunches: 0,
          dinners: 0
        }

        current.days.add(row.datum)
        if (row.obed) current.lunches += 1
        if (row.vecera) current.dinners += 1
        claimsByUserId.set(row.user_id, current)
      })
    }

    const results = rows.map((row: any) => {
      const rowNumber = Number(row.rowNumber || row.row || 0) || null
      const userId = text(row.userId || row.user_id)
      const rowEmail = text(row.email).toLowerCase()
      const user = (userId && usersById.get(userId)) || (rowEmail && usersByEmail.get(rowEmail))

      if (!user) {
        return {
          rowNumber,
          status: 'ERROR',
          message: 'Osoba sa nenasla.'
        }
      }

      const claims = claimsByUserId.get(user.id)

      return {
        rowNumber,
        status: 'OK',
        message: 'Udaje aktualizovane.',
        userId: user.id,
        meno: user.meno || '',
        priezvisko: user.priezvisko || '',
        fullName: fullName(user) || user.email || '',
        email: user.email || '',
        telefon: user.telefon || '',
        typStravy: user.typ_stravy || '',
        aktivny: user.aktivny || '',
        groups: (groupsByUserId.get(user.id) || []).join('|'),
        qrCode: qrByUserId.get(user.id) || '',
        entitlementDays: claims?.days.size || 0,
        lunchClaims: claims?.lunches || 0,
        dinnerClaims: claims?.dinners || 0,
        updatedAt: user.updated_at || ''
      }
    })

    return NextResponse.json({
      ok: true,
      results
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
