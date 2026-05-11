import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function email(value: any) {
  const clean = text(value).toLowerCase()
  return clean || null
}

function authorized(req: NextRequest, body: any) {
  const expected = process.env.GOOGLE_SHEETS_IMPORT_TOKEN
  const provided = req.headers.get('x-pohoda-token') || body?.token || ''

  return Boolean(expected) && provided === expected
}

function food(value: any) {
  const clean = text(value).toUpperCase()

  if (clean === 'MASO') return 'MASO'
  if (clean === 'VEGE') return 'VEGE'
  if (clean === 'DIETA' || clean === 'DIÉTA' || clean === 'DIĂ‰TA') return 'DIETA'

  return ''
}

function boolValue(value: any, fallback: boolean) {
  const clean = text(value).toLowerCase()

  if (!clean) return fallback
  if (['1', 'ano', 'áno', 'yes', 'true', 'x'].includes(clean)) return true
  if (['0', 'nie', 'no', 'false', '-'].includes(clean)) return false

  return fallback
}

function dateValue(value: any) {
  const clean = text(value)

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean

  const match = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)

  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  }

  return ''
}

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const dates: string[] = []

  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`)
  }

  return dates
}

function normalizeKey(value: string) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function groupNames(value: any) {
  return text(value)
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

async function loadSyncData(userIds: string[]) {
  let qrByUserId = new Map<string, string>()
  const groupsByUserId = new Map<string, string[]>()
  const claimsByUserId = new Map<string, { days: Set<string>; lunches: number; dinners: number }>()

  if (userIds.length === 0) {
    return { qrByUserId, groupsByUserId, claimsByUserId }
  }

  const { data: qrRows } = await supabaseServer
    .from('user_qr_codes')
    .select('user_id, qr_code')
    .in('user_id', userIds)
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
    .in('user_id', userIds)

  ;(membershipRows || []).forEach((row: any) => {
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups
    const list = groupsByUserId.get(row.user_id) || []

    if (group?.name) list.push(group.name)
    groupsByUserId.set(row.user_id, list)
  })

  const { data: claimRows } = await supabaseServer
    .from('user_food_entitlements')
    .select('user_id, datum, obed, vecera')
    .in('user_id', userIds)

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

  return { qrByUserId, groupsByUserId, claimsByUserId }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!authorized(req, body)) {
      return NextResponse.json({ error: 'Neplatny Google Sheets token.' }, { status: 401 })
    }

    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : []

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Chybaju riadky na ulozenie.' }, { status: 400 })
    }

    const actorUserId = text(process.env.GOOGLE_SHEETS_IMPORT_ACTOR_USER_ID) || null
    const { data: groups } = await supabaseServer
      .from('groups')
      .select('id, name')

    const groupByName = new Map((groups || []).map((group: any) => [normalizeKey(group.name), group]))
    const updatedUserIds: string[] = []
    const rowResults: any[] = []

    for (const row of rows) {
      const rowNumber = Number(row.rowNumber || row.row || 0) || null
      const userId = text(row.userId || row.user_id)

      if (!userId) {
        rowResults.push({ rowNumber, status: 'ERROR', message: 'Riadok nema user_id.' })
        continue
      }

      const { data: before, error: beforeError } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy')
        .eq('id', userId)
        .maybeSingle()

      if (beforeError) {
        rowResults.push({ rowNumber, status: 'ERROR', message: beforeError.message })
        continue
      }

      if (!before) {
        rowResults.push({ rowNumber, status: 'ERROR', message: 'Osoba sa nenasla.' })
        continue
      }

      const meno = text(row.meno || row.first_name) || before.meno || ''
      const priezvisko = text(row.priezvisko || row.last_name || row.surname) || before.priezvisko || ''
      const requestedEmail = email(row.email || row.mail)
      const telefon = text(row.telefon || row.phone || row.tel) || null
      const typStravy = food(row.typStravy || row.typ_stravy || row.strava || row.food) || before.typ_stravy || 'MASO'

      if (!meno || !priezvisko) {
        rowResults.push({ rowNumber, status: 'ERROR', message: 'Meno a priezvisko su povinne.' })
        continue
      }

      let nextEmail = before.email || null

      if (requestedEmail && before.email && requestedEmail !== before.email) {
        rowResults.push({
          rowNumber,
          status: 'ERROR',
          message: 'E-mail uz existujucej osoby sa cez Google Sheets nemeni. Zmen ho v aplikacii.'
        })
        continue
      }

      if (requestedEmail && !before.email) {
        const { data: existingEmail, error: existingEmailError } = await supabaseServer
          .from('users')
          .select('id')
          .eq('email', requestedEmail)
          .neq('id', userId)
          .maybeSingle()

        if (existingEmailError) {
          rowResults.push({ rowNumber, status: 'ERROR', message: existingEmailError.message })
          continue
        }

        if (existingEmail) {
          rowResults.push({ rowNumber, status: 'ERROR', message: 'Tento e-mail uz pouziva ina osoba.' })
          continue
        }

        nextEmail = requestedEmail
      }

      const requestedGroupNames = groupNames(row.skupina || row.skupiny || row.group || row.groups)
      const targetGroupIds = requestedGroupNames.length > 0
        ? Array.from(new Set(
            requestedGroupNames.map(name => groupByName.get(normalizeKey(name))?.id || '').filter(Boolean)
          ))
        : []

      if (requestedGroupNames.length > 0 && targetGroupIds.length !== requestedGroupNames.length) {
        rowResults.push({ rowNumber, status: 'ERROR', message: 'Niektora skupina sa nenasla.' })
        continue
      }

      const now = new Date().toISOString()
      const { error: updateUserError } = await supabaseServer
        .from('users')
        .update({
          meno,
          priezvisko,
          email: nextEmail,
          telefon,
          typ_stravy: typStravy,
          updated_at: now
        })
        .eq('id', userId)

      if (updateUserError) {
        rowResults.push({ rowNumber, status: 'ERROR', message: updateUserError.message })
        continue
      }

      if (requestedGroupNames.length > 0) {
        const { data: currentMemberships, error: membershipLoadError } = await supabaseServer
          .from('group_members')
          .select('id, group_id, role')
          .eq('user_id', userId)

        if (membershipLoadError) {
          rowResults.push({ rowNumber, status: 'ERROR', message: membershipLoadError.message })
          continue
        }

        const protectedMemberships = (currentMemberships || []).filter((membership: any) => {
          const role = String(membership.role || '').toUpperCase()
          return role !== 'MEMBER'
        })
        const protectedGroupIds = new Set(protectedMemberships.map((membership: any) => membership.group_id))
        const currentMemberGroupIds = new Set(
          (currentMemberships || [])
            .filter((membership: any) => String(membership.role || '').toUpperCase() === 'MEMBER')
            .map((membership: any) => membership.group_id)
        )
        const targetGroupIdSet = new Set(targetGroupIds)
        const removeGroupIds = Array.from(currentMemberGroupIds).filter(groupId => !targetGroupIdSet.has(groupId))
        const addGroupIds = targetGroupIds.filter(groupId => {
          return !currentMemberGroupIds.has(groupId) && !protectedGroupIds.has(groupId)
        })

        if (removeGroupIds.length > 0) {
          const { error: removeError } = await supabaseServer
            .from('group_members')
            .delete()
            .eq('user_id', userId)
            .in('group_id', removeGroupIds)
            .eq('role', 'MEMBER')

          if (removeError) {
            rowResults.push({ rowNumber, status: 'ERROR', message: removeError.message })
            continue
          }
        }

        if (addGroupIds.length > 0) {
          const { error: addError } = await supabaseServer
            .from('group_members')
            .insert(addGroupIds.map(groupId => ({
              group_id: groupId,
              user_id: userId,
              role: 'MEMBER'
            })))

          if (addError) {
            rowResults.push({ rowNumber, status: 'ERROR', message: addError.message })
            continue
          }
        }
      }

      const validFrom = dateValue(row.validFrom || row.od || row.datum_od)
      const validTo = dateValue(row.validTo || row.do || row.datum_do)
      const shouldUpdateClaims = Boolean(validFrom && validTo)

      if (shouldUpdateClaims) {
        if (validTo < validFrom) {
          rowResults.push({ rowNumber, status: 'ERROR', message: 'Neplatne obdobie narokov.' })
          continue
        }

        const obed = boolValue(row.obed || row.lunch, true)
        const vecera = boolValue(row.vecera || row.dinner, false)

        if (!obed && !vecera) {
          rowResults.push({ rowNumber, status: 'ERROR', message: 'Chyba narok na obed alebo veceru.' })
          continue
        }

        const dates = dateRange(validFrom, validTo)

        if (dates.length > 120) {
          rowResults.push({ rowNumber, status: 'ERROR', message: 'Obdobie moze mat najviac 120 dni.' })
          continue
        }

        const { error: deleteClaimError } = await supabaseServer
          .from('user_food_entitlements')
          .delete()
          .eq('user_id', userId)
          .gte('datum', validFrom)
          .lte('datum', validTo)

        if (deleteClaimError) {
          rowResults.push({ rowNumber, status: 'ERROR', message: deleteClaimError.message })
          continue
        }

        const { error: insertClaimError } = await supabaseServer
          .from('user_food_entitlements')
          .insert(dates.map(datum => ({
            user_id: userId,
            datum,
            obed,
            vecera,
            source: 'IMPORT',
            note: 'Google Sheets update.',
            created_by: actorUserId,
            updated_by: actorUserId,
            updated_at: now
          })))

        if (insertClaimError) {
          rowResults.push({ rowNumber, status: 'ERROR', message: insertClaimError.message })
          continue
        }
      }

      await supabaseServer
        .from('personnel_audit_log')
        .insert({
          actor_user_id: actorUserId,
          target_user_id: userId,
          action: 'GOOGLE_SHEETS_PERSON_UPDATED',
          entity_table: 'users',
          entity_id: userId,
          before_data: before,
          after_data: {
            row_number: rowNumber,
            meno,
            priezvisko,
            email: nextEmail,
            telefon,
            typ_stravy: typStravy,
            email_updated: nextEmail !== before.email,
            claims_updated: shouldUpdateClaims
          }
        })

      updatedUserIds.push(userId)
      rowResults.push({ rowNumber, status: 'OK', message: 'Zmeny boli ulozene.', userId })
    }

    const uniqueUpdatedUserIds = Array.from(new Set(updatedUserIds))
    const { data: updatedUsers } = uniqueUpdatedUserIds.length > 0
      ? await supabaseServer
          .from('users')
          .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny, updated_at')
          .in('id', uniqueUpdatedUserIds)
      : { data: [] }
    const updatedUserById = new Map((updatedUsers || []).map((user: any) => [user.id, user]))
    const syncData = await loadSyncData(uniqueUpdatedUserIds)

    const results = rowResults.map(result => {
      if (result.status !== 'OK' || !result.userId) return result

      const user = updatedUserById.get(result.userId)
      const claims = syncData.claimsByUserId.get(result.userId)

      if (!user) return result

      return {
        ...result,
        meno: user.meno || '',
        priezvisko: user.priezvisko || '',
        fullName: fullName(user) || user.email || '',
        email: user.email || '',
        telefon: user.telefon || '',
        typStravy: user.typ_stravy || '',
        aktivny: user.aktivny || '',
        groups: (syncData.groupsByUserId.get(result.userId) || []).join('|'),
        qrCode: syncData.qrByUserId.get(result.userId) || '',
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
