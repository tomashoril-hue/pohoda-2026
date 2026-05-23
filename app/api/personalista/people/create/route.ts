import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json(
        { error: 'Nie si prihlaseny.' },
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
    const assignQr = body.assignQr !== false
    const groupIds = Array.isArray(body.groupIds)
      ? Array.from(new Set(body.groupIds.map((id: any) => normalizeText(id)).filter(Boolean)))
      : []

    if (!meno || !priezvisko) {
      return NextResponse.json(
        { error: 'Meno a priezvisko su povinne.' },
        { status: 400 }
      )
    }

    if (!typStravy) {
      return NextResponse.json(
        { error: 'Vyber typ stravy.' },
        { status: 400 }
      )
    }

    if (!isIsoDate(validFrom) || !isIsoDate(validTo) || validTo < validFrom) {
      return NextResponse.json(
        { error: 'Zadaj platne obdobie prace.' },
        { status: 400 }
      )
    }

    if (!obed && !vecera) {
      return NextResponse.json(
        { error: 'Vyber aspon jeden narok na stravu.' },
        { status: 400 }
      )
    }

    const dates = dateRange(validFrom, validTo)

    if (dates.length > 120) {
      return NextResponse.json(
        { error: 'Obdobie moze mat najviac 120 dni.' },
        { status: 400 }
      )
    }

    const globalAccess = await getGlobalAccess(currentUser.id)
    const isGlobalPersonalista = globalAccess.canUsePersonalista

    if (!isGlobalPersonalista) {
      return NextResponse.json(
        { error: 'Personalistiku moze pouzivat iba ADMIN alebo PERSONALISTA.' },
        { status: 403 }
      )
    }

    let selectedGroups: any[] = []

    if (groupIds.length > 0) {
      const { data: selectedGroupsData, error: selectedGroupsError } = await supabaseServer
        .from('groups')
        .select('id, name')
        .in('id', groupIds)

      if (selectedGroupsError) {
        return NextResponse.json(
          { error: selectedGroupsError.message },
          { status: 500 }
        )
      }

      selectedGroups = selectedGroupsData || []

      if (selectedGroups.length !== groupIds.length) {
        return NextResponse.json(
          { error: 'Niektora zo skupin neexistuje.' },
          { status: 400 }
        )
      }
    }

    if (!groupIds.length && !isGlobalPersonalista) {
      return NextResponse.json(
        { error: 'Osobu bez skupiny moze vytvorit iba ADMIN alebo PERSONALISTA.' },
        { status: 403 }
      )
    }

    if (groupIds.length > 0 && !isGlobalPersonalista) {
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
            return role === 'MANAGER'
          })
          .map((membership: any) => membership.group_id)
      )

      const hasAllPermissions = groupIds.every(groupId => manageableIds.has(groupId))

      if (!hasAllPermissions) {
        return NextResponse.json(
          { error: 'Na vytvorenie osoby musis byt MANAGER vo vybranych skupinach.' },
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
          { error: 'Pouzivatel s tymto emailom uz existuje.' },
          { status: 409 }
        )
      }
    }

    const now = new Date().toISOString()
    let assignedQrCode: string | null = null

    const { data: newUser, error: userError } = await supabaseServer
      .from('users')
      .insert({
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy: typStravy,
        qr_code: null,
        zdroj: 'PERSONALISTA',
        aktivny: 'ANO',
        manual_created_by: currentUser.id,
        updated_at: now
      })
      .select('id, meno, priezvisko, email')
      .single()

    if (userError || !newUser) {
      return NextResponse.json(
        { error: userError?.message || 'Osobu sa nepodarilo vytvorit.' },
        { status: 500 }
      )
    }

    const rollbackUser = async () => {
      await supabaseServer
        .from('user_qr_codes')
        .delete()
        .eq('user_id', newUser.id)

      await supabaseServer
        .from('users')
        .delete()
        .eq('id', newUser.id)
    }

    if (groupIds.length > 0) {
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

    if (assignQr) {
      const { data: assignedQrRows, error: assignQrError } = await supabaseServer
        .rpc('assign_free_qr_to_user', {
          p_user_id: newUser.id,
          p_assigned_by: currentUser.id,
          p_note: 'Priradene z tabulky qr_codes pri rucnom zalozeni osoby.'
        })

      if (assignQrError) {
        await rollbackUser()

        return NextResponse.json(
          { error: assignQrError.message || 'Volny QR kod sa nepodarilo priradit.' },
          { status: 500 }
        )
      }

      const assignedQr = Array.isArray(assignedQrRows)
        ? assignedQrRows[0]
        : assignedQrRows

      if (!assignedQr) {
        await rollbackUser()

        return NextResponse.json(
          { error: 'Nie je dostupny ziadny volny nepriradeny QR kod.' },
          { status: 409 }
        )
      }

      assignedQrCode = assignedQr.qr_code
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: currentUser.id,
        target_user_id: newUser.id,
        group_id: groupIds[0] || null,
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
          qr_assigned: !!assignedQrCode
        }
      })

    return NextResponse.json({
      ok: true,
      user: newUser,
      qrAssigned: !!assignedQrCode,
      entitlementDays: dates.length,
      message: 'Osoba bola vytvorena.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
