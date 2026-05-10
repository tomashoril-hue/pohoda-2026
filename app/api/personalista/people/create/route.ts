import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeText(value: any) {
  return String(value || '').trim()
}

function normalizeEmail(value: any) {
  const email = normalizeText(value).toLowerCase()
  return email || null
}

function normalizeFood(value: any) {
  const food = normalizeText(value).toUpperCase()

  if (food === 'MASO') return 'MASO'
  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA') return 'DIETA'

  return ''
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
  }

  return dates
}

function createQrCode() {
  return `POHODA2026-${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json(
        { error: 'Nie si prihlásený.' },
        { status: 401 }
      )
    }

    const body = await req.json()

    const meno = normalizeText(body.meno)
    const priezvisko = normalizeText(body.priezvisko)
    const email = normalizeEmail(body.email)
    const telefon = normalizeText(body.telefon) || null
    const typStravy = normalizeFood(body.typStravy)
    const validFrom = normalizeText(body.validFrom)
    const validTo = normalizeText(body.validTo)
    const obed = !!body.obed
    const vecera = !!body.vecera
    const createQr = body.createQr !== false
    const groupIds = Array.isArray(body.groupIds)
      ? Array.from(new Set(body.groupIds.map((id: any) => normalizeText(id)).filter(Boolean)))
      : []

    if (!meno || !priezvisko) {
      return NextResponse.json(
        { error: 'Meno a priezvisko sú povinné.' },
        { status: 400 }
      )
    }

    if (!typStravy) {
      return NextResponse.json(
        { error: 'Vyber typ stravy.' },
        { status: 400 }
      )
    }

    if (!groupIds.length) {
      return NextResponse.json(
        { error: 'Vyber aspoň jednu skupinu.' },
        { status: 400 }
      )
    }

    if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) {
      return NextResponse.json(
        { error: 'Zadaj platné obdobie práce.' },
        { status: 400 }
      )
    }

    if (!obed && !vecera) {
      return NextResponse.json(
        { error: 'Vyber aspoň jeden nárok na stravu.' },
        { status: 400 }
      )
    }

    const dates = dateRange(validFrom, validTo)

    if (dates.length > 120) {
      return NextResponse.json(
        { error: 'Obdobie môže mať najviac 120 dní.' },
        { status: 400 }
      )
    }

    const { data: globalRoles, error: globalRoleError } = await supabaseServer
      .from('app_user_roles')
      .select('role')
      .eq('user_id', currentUser.id)
      .eq('active', true)

    if (globalRoleError) {
      return NextResponse.json(
        { error: globalRoleError.message },
        { status: 500 }
      )
    }

    const isGlobalPersonalista = (globalRoles || []).some((item: any) => {
      const role = String(item.role || '').toUpperCase()
      return role === 'ADMIN' || role === 'PERSONALISTA'
    })

    const { data: selectedGroups, error: selectedGroupsError } = await supabaseServer
      .from('groups')
      .select('id, name')
      .in('id', groupIds)

    if (selectedGroupsError) {
      return NextResponse.json(
        { error: selectedGroupsError.message },
        { status: 500 }
      )
    }

    if (!selectedGroups || selectedGroups.length !== groupIds.length) {
      return NextResponse.json(
        { error: 'Niektorá zo skupín neexistuje.' },
        { status: 400 }
      )
    }

    if (!isGlobalPersonalista) {
      const { data: myMemberships, error: membershipsError } = await supabaseServer
        .from('group_members')
        .select('group_id, role')
        .eq('user_id', currentUser.id)
        .in('group_id', groupIds)

      if (membershipsError) {
        return NextResponse.json(
          { error: membershipsError.message },
          { status: 500 }
        )
      }

      const manageableIds = new Set(
        (myMemberships || [])
          .filter((membership: any) => {
            const role = String(membership.role || '').toUpperCase()
            return role === 'MANAGER' || role === 'OWNER'
          })
          .map((membership: any) => membership.group_id)
      )

      const hasAllPermissions = groupIds.every(groupId => manageableIds.has(groupId))

      if (!hasAllPermissions) {
        return NextResponse.json(
          { error: 'Na vytvorenie osoby musíš byť MANAGER alebo OWNER vo vybraných skupinách.' },
          { status: 403 }
        )
      }
    }

    if (email) {
      const { data: existingEmail, error: existingEmailError } = await supabaseServer
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (existingEmailError) {
        return NextResponse.json(
          { error: existingEmailError.message },
          { status: 500 }
        )
      }

      if (existingEmail) {
        return NextResponse.json(
          { error: 'Používateľ s týmto emailom už existuje.' },
          { status: 409 }
        )
      }
    }

    const qrCode = createQr ? createQrCode() : null
    const now = new Date().toISOString()

    let createdQrTokenId: string | null = null

    const { data: newUser, error: userError } = await supabaseServer
      .from('users')
      .insert({
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy: typStravy,
        qr_code: qrCode,
        zdroj: 'PERSONALISTA',
        aktivny: 'ANO',
        manual_created_by: currentUser.id,
        updated_at: now
      })
      .select('id, meno, priezvisko, email')
      .single()

    if (userError || !newUser) {
      return NextResponse.json(
        { error: userError?.message || 'Osobu sa nepodarilo vytvoriť.' },
        { status: 500 }
      )
    }

    const rollbackUser = async () => {
      if (createdQrTokenId) {
        await supabaseServer
          .from('personnel_qr_tokens')
          .delete()
          .eq('id', createdQrTokenId)
      }

      await supabaseServer
        .from('users')
        .delete()
        .eq('id', newUser.id)
    }

    const { error: membershipError } = await supabaseServer
      .from('group_members')
      .insert(groupIds.map(groupId => ({
        group_id: groupId,
        user_id: newUser.id,
        role: 'MEMBER'
      })))

    if (membershipError) {
      await rollbackUser()

      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      )
    }

    const { error: workPeriodError } = await supabaseServer
      .from('personnel_work_periods')
      .insert({
        user_id: newUser.id,
        valid_from: validFrom,
        valid_to: validTo,
        source: 'MANUAL',
        created_by: currentUser.id,
        updated_by: currentUser.id
      })

    if (workPeriodError) {
      await rollbackUser()

      return NextResponse.json(
        { error: workPeriodError.message },
        { status: 500 }
      )
    }

    const { error: entitlementError } = await supabaseServer
      .from('user_food_entitlements')
      .insert(dates.map(datum => ({
        user_id: newUser.id,
        datum,
        obed,
        vecera,
        source: 'PERSONALISTA',
        created_by: currentUser.id,
        updated_by: currentUser.id,
        updated_at: now
      })))

    if (entitlementError) {
      await rollbackUser()

      return NextResponse.json(
        { error: entitlementError.message },
        { status: 500 }
      )
    }

    if (qrCode) {
      const { data: qrToken, error: qrTokenError } = await supabaseServer
        .from('personnel_qr_tokens')
        .insert({
          qr_code: qrCode,
          user_id: newUser.id,
          status: 'ASSIGNED',
          active: true,
          assigned_at: now,
          assigned_by: currentUser.id,
          note: 'Vytvorené pri ručnom založení osoby.'
        })
        .select('id')
        .single()

      if (qrTokenError || !qrToken) {
        await rollbackUser()

        return NextResponse.json(
          { error: qrTokenError?.message || 'QR token sa nepodarilo vytvoriť.' },
          { status: 500 }
        )
      }

      createdQrTokenId = qrToken.id

      const { error: userQrError } = await supabaseServer
        .from('user_qr_codes')
        .insert({
          user_id: newUser.id,
          qr_code: qrCode,
          active: true,
          personnel_qr_token_id: qrToken.id,
          assigned_by: currentUser.id,
          note: 'Vytvorené pri ručnom založení osoby.'
        })

      if (userQrError) {
        await rollbackUser()

        return NextResponse.json(
          { error: userQrError.message },
          { status: 500 }
        )
      }
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: currentUser.id,
        target_user_id: newUser.id,
        group_id: groupIds[0],
        action: 'PERSON_CREATED',
        entity_table: 'users',
        entity_id: newUser.id,
        after_data: {
          meno,
          priezvisko,
          email,
          telefon,
          typ_stravy: typStravy,
          group_ids: groupIds,
          valid_from: validFrom,
          valid_to: validTo,
          obed,
          vecera,
          qr_created: !!qrCode
        }
      })

    return NextResponse.json({
      ok: true,
      user: newUser,
      qrCreated: !!qrCode,
      entitlementDays: dates.length,
      message: 'Osoba bola vytvorená.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
