import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function email(value: any) {
  const clean = text(value).toLowerCase()
  return clean || null
}

function food(value: any) {
  const clean = text(value).toUpperCase()

  if (clean === 'MASO') return 'MASO'
  if (clean === 'VEGE') return 'VEGE'
  if (clean === 'DIETA' || clean === 'DIÉTA' || clean === 'DIĂ‰TA') return 'DIETA'

  return 'MASO'
}

function boolValue(value: any, fallback: boolean) {
  const clean = text(value).toLowerCase()

  if (!clean) return fallback
  if (['1', 'ano', 'áno', 'yes', 'true', 'x'].includes(clean)) return true
  if (['0', 'nie', 'no', 'false', '-'].includes(clean)) return false

  return fallback
}

function dateValue(value: any, fallback: string) {
  const clean = text(value)

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean

  const match = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)

  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  }

  return fallback
}

function todayIso() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
  if (Array.isArray(value)) return value.map(text).filter(Boolean)

  return text(value)
    .split('|')
    .map(item => item.trim())
    .filter(Boolean)
}

function authorized(req: NextRequest, body: any) {
  const expected = process.env.GOOGLE_SHEETS_IMPORT_TOKEN
  const provided = req.headers.get('x-pohoda-token') || body?.token || ''

  return Boolean(expected) && provided === expected
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!authorized(req, body)) {
      return NextResponse.json({ error: 'Neplatny Google Sheets token.' }, { status: 401 })
    }

    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : []

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Chybaju riadky na import.' }, { status: 400 })
    }

    const actorUserId = text(process.env.GOOGLE_SHEETS_IMPORT_ACTOR_USER_ID) || null
    const defaultDate = todayIso()

    const { data: groups } = await supabaseServer
      .from('groups')
      .select('id, name')

    const groupByName = new Map(
      (groups || []).map((group: any) => [normalizeKey(group.name), group])
    )

    const results = []

    for (const row of rows) {
      const rowNumber = Number(row.rowNumber || row.row || 0) || null
      const meno = text(row.meno || row.first_name)
      const priezvisko = text(row.priezvisko || row.last_name || row.surname)
      const userEmail = email(row.email || row.mail)
      const telefon = text(row.telefon || row.phone || row.tel) || null
      const typStravy = food(row.typStravy || row.typ_stravy || row.strava || row.food)
      const validFrom = dateValue(row.validFrom || row.od || row.datum_od, body.defaultFrom || defaultDate)
      const validTo = dateValue(row.validTo || row.do || row.datum_do, body.defaultTo || validFrom)
      const obed = boolValue(row.obed || row.lunch, body.defaultObed !== false)
      const vecera = boolValue(row.vecera || row.dinner, body.defaultVecera === true)
      const assignQr = boolValue(
        row.registracia_qr || row.registraciaQr || row.qr || row.assignQr || row.assign_qr,
        body.defaultAssignQr !== false
      )
      const requestedGroupNames = groupNames(row.skupina || row.skupiny || row.group || row.groups)
      const groupIds = Array.from(new Set([
        ...(Array.isArray(row.groupIds) ? row.groupIds.map(text) : []),
        ...requestedGroupNames.map(name => groupByName.get(normalizeKey(name))?.id || '')
      ].filter(Boolean)))

      if (!meno || !priezvisko) {
        results.push({ rowNumber, status: 'ERROR', message: 'Chyba meno alebo priezvisko.' })
        continue
      }

      if (validTo < validFrom) {
        results.push({ rowNumber, status: 'ERROR', message: 'Neplatne obdobie.' })
        continue
      }

      if (!obed && !vecera) {
        results.push({ rowNumber, status: 'ERROR', message: 'Chyba narok na obed alebo veceru.' })
        continue
      }

      const dates = dateRange(validFrom, validTo)

      if (dates.length > 120) {
        results.push({ rowNumber, status: 'ERROR', message: 'Obdobie moze mat najviac 120 dni.' })
        continue
      }

      if (userEmail) {
        const { data: existingEmail, error: existingEmailError } = await supabaseServer
          .from('users')
          .select('id')
          .eq('email', userEmail)
          .maybeSingle()

        if (existingEmailError) {
          results.push({ rowNumber, status: 'ERROR', message: existingEmailError.message })
          continue
        }

        if (existingEmail) {
          results.push({ rowNumber, status: 'ERROR', message: 'Pouzivatel s tymto emailom uz existuje.', userId: existingEmail.id })
          continue
        }
      }

      const now = new Date().toISOString()
      let assignedQrCode: string | null = null

      const { data: newUser, error: userError } = await supabaseServer
        .from('users')
        .insert({
          meno,
          priezvisko,
          email: userEmail,
          telefon,
          typ_stravy: typStravy,
          qr_code: null,
          zdroj: 'GOOGLE_SHEETS',
          aktivny: 'ANO',
          manual_created_by: actorUserId,
          updated_at: now
        })
        .select('id, meno, priezvisko, email')
        .single()

      if (userError || !newUser) {
        results.push({ rowNumber, status: 'ERROR', message: userError?.message || 'Osobu sa nepodarilo vytvorit.' })
        continue
      }

      const rollbackUser = async () => {
        await supabaseServer.from('user_qr_codes').delete().eq('user_id', newUser.id)
        await supabaseServer.from('users').delete().eq('id', newUser.id)
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
          results.push({ rowNumber, status: 'ERROR', message: membershipError.message })
          continue
        }
      }

      const { error: workPeriodError } = await supabaseServer
        .from('personnel_work_periods')
        .insert({
          user_id: newUser.id,
          valid_from: validFrom,
          valid_to: validTo,
          source: 'GOOGLE_SHEETS',
          created_by: actorUserId,
          updated_by: actorUserId
        })

      if (workPeriodError) {
        await rollbackUser()
        results.push({ rowNumber, status: 'ERROR', message: workPeriodError.message })
        continue
      }

      const { error: entitlementError } = await supabaseServer
        .from('user_food_entitlements')
        .insert(dates.map(datum => ({
          user_id: newUser.id,
          datum,
          obed,
          vecera,
          source: 'IMPORT',
          note: 'Google Sheets import.',
          created_by: actorUserId,
          updated_by: actorUserId,
          updated_at: now
        })))

      if (entitlementError) {
        await rollbackUser()
        results.push({ rowNumber, status: 'ERROR', message: entitlementError.message })
        continue
      }

      if (assignQr) {
        const { data: assignedQrRows, error: assignQrError } = await supabaseServer
          .rpc('assign_free_qr_to_user', {
            p_user_id: newUser.id,
            p_assigned_by: actorUserId,
            p_note: 'Priradene pri Google Sheets importe.'
          })

        if (assignQrError) {
          await rollbackUser()
          results.push({ rowNumber, status: 'ERROR', message: assignQrError.message || 'QR sa nepodarilo priradit.' })
          continue
        }

        const assignedQr = Array.isArray(assignedQrRows)
          ? assignedQrRows[0]
          : assignedQrRows

        if (!assignedQr) {
          await rollbackUser()
          results.push({ rowNumber, status: 'ERROR', message: 'Nie je dostupny volny QR kod.' })
          continue
        }

        assignedQrCode = assignedQr.qr_code
      }

      await supabaseServer
        .from('personnel_audit_log')
        .insert({
          actor_user_id: actorUserId,
          target_user_id: newUser.id,
          group_id: groupIds[0] || null,
          action: 'GOOGLE_SHEETS_PERSON_CREATED',
          entity_table: 'users',
          entity_id: newUser.id,
          after_data: {
            row_number: rowNumber,
            email: userEmail,
            group_ids: groupIds,
            qr_assigned: !!assignedQrCode
          }
        })

      results.push({
        rowNumber,
        status: 'OK',
        message: 'Osoba bola vytvorena.',
        userId: newUser.id,
        qrAssigned: !!assignedQrCode,
        qrCode: assignedQrCode || ''
      })
    }

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
