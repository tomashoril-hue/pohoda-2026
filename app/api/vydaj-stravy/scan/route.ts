import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function clean(value: any) {
  return String(value || '').trim()
}

function normalizeDate(value: any) {
  const text = clean(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeMeal(value: any) {
  const text = clean(value).toUpperCase()
  if (text === 'OBED') return 'OBED'
  if (text === 'VECERA' || text === 'VEČERA') return 'VECERA'
  return ''
}

function normalizeChoice(value: any) {
  const text = clean(value).toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'
  return null
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

function entitlementOk(row: any, meal: string) {
  if (!row) return false
  if (meal === 'OBED') return row.obed === true
  if (meal === 'VECERA') return row.vecera === true
  return false
}

function issueOf(item: any) {
  return Array.isArray(item?.hromadne_vydaje)
    ? item.hromadne_vydaje[0]
    : item?.hromadne_vydaje
}

function groupOf(issue: any) {
  return Array.isArray(issue?.groups)
    ? issue.groups[0]
    : issue?.groups
}

function isActiveIssue(issue: any, now: Date) {
  if (!issue) return false
  if (issue.status === 'READY') return true
  if (issue.status !== 'WAITING') return false
  if (!issue.valid_after) return true
  return new Date(issue.valid_after).getTime() <= now.getTime()
}

function choiceSummary(rows: any[]) {
  const counts = {
    MASO: 0,
    VEGE: 0,
    DIETA: 0
  }

  rows.forEach((row: any) => {
    const choice = normalizeChoice(row.volba) || 'DIETA'
    counts[choice] += 1
  })

  return counts
}

function formatChoiceSummary(summary: { MASO: number; VEGE: number; DIETA: number }) {
  return [
    summary.MASO ? `MASO ${summary.MASO}` : '',
    summary.VEGE ? `VEGE ${summary.VEGE}` : '',
    summary.DIETA ? `DIÉTA ${summary.DIETA}` : ''
  ].filter(Boolean).join(' · ')
}

async function issuerAccess(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)

  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', actorId)

  if (error) {
    throw new Error(error.message)
  }

  const groupIds = (memberships || [])
    .filter((membership: any) => canIssueForGroupByRole(String(membership.role || '').toUpperCase(), globalAccess))
    .map((membership: any) => membership.group_id)

  return {
    global: globalAccess.canUsePersonalista,
    groupIds,
    canUse: globalAccess.canUsePersonalista || groupIds.length > 0
  }
}

async function findUserIdByQr(qrCode: string) {
  const { data: qrRow, error: qrError } = await supabaseServer
    .from('user_qr_codes')
    .select('user_id')
    .eq('qr_code', qrCode)
    .eq('active', true)
    .maybeSingle()

  if (qrError) throw new Error(qrError.message)
  if (qrRow?.user_id) return qrRow.user_id

  const { data: userRow, error: userError } = await supabaseServer
    .from('users')
    .select('id')
    .eq('qr_code', qrCode)
    .maybeSingle()

  if (userError) throw new Error(userError.message)
  return userRow?.id || ''
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const qrCode = clean(body.qrCode)
    const datum = normalizeDate(body.datum)
    const typJedla = normalizeMeal(body.typJedla)

    if (!qrCode || !datum || !typJedla) {
      return NextResponse.json(
        { error: 'Chýba QR kód, dátum alebo typ jedla.' },
        { status: 400 }
      )
    }

    const access = await issuerAccess(actor.id)

    if (!access.canUse) {
      return NextResponse.json(
        { error: 'Nemáš oprávnenie vydávať stravu.' },
        { status: 403 }
      )
    }

    const targetUserId = await findUserIdByQr(qrCode)

    if (!targetUserId) {
      return NextResponse.json({
        ok: false,
        status: 'UNKNOWN_QR',
        tone: 'error',
        message: 'QR kód nebol nájdený alebo nie je aktívny.'
      }, { status: 404 })
    }

    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny')
      .eq('id', targetUserId)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json({
        ok: false,
        status: 'UNKNOWN_USER',
        tone: 'error',
        message: 'Osoba k QR kódu sa nenašla.'
      }, { status: 404 })
    }

    const { data: targetMemberships, error: targetMembershipsError } = await supabaseServer
      .from('group_members')
      .select(`
        group_id,
        role,
        groups (
          name
        )
      `)
      .eq('user_id', targetUserId)

    if (targetMembershipsError) {
      return NextResponse.json({ error: targetMembershipsError.message }, { status: 500 })
    }

    const allowedTargetGroups = (targetMemberships || []).filter((membership: any) => {
      return access.global || access.groupIds.includes(membership.group_id)
    })

    const targetRoleByGroup = new Map(
      (targetMemberships || []).map((membership: any) => [
        membership.group_id,
        String(membership.role || '').toUpperCase()
      ])
    )

    if (!access.global && allowedTargetGroups.length === 0) {
      return NextResponse.json({
        ok: false,
        status: 'NO_ACCESS',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile),
          email: profile.email || ''
        },
        message: 'Táto osoba nepatrí do skupiny, pre ktorú môžeš vydávať stravu.'
      }, { status: 403 })
    }

    if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json({
        ok: false,
        status: 'BLOCKED',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: 'Blokovaný'
      }, { status: 403 })
    }

    const { data: alreadyIssued, error: alreadyIssuedError } = await supabaseServer
      .from('vydaj_jedal')
      .select('id, sposob, issued_at, volba, group_id, hromadny_vydaj_id')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .eq('status', 'VYDANE')
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (alreadyIssuedError) {
      return NextResponse.json({ error: alreadyIssuedError.message }, { status: 500 })
    }

    if (alreadyIssued) {
      return NextResponse.json({
        ok: false,
        status: 'ALREADY_ISSUED',
        tone: 'error',
        issuedId: alreadyIssued.id,
        issuedAt: alreadyIssued.issued_at,
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        choice: alreadyIssued.volba || normalizeChoice(profile.typ_stravy),
        message: 'Už vydané'
      }, { status: 409 })
    }

    const { data: entitlement, error: entitlementError } = await supabaseServer
      .from('user_food_entitlements')
      .select('obed, vecera')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .maybeSingle()

    if (entitlementError) {
      return NextResponse.json({ error: entitlementError.message }, { status: 500 })
    }

    if (!entitlementOk(entitlement, typJedla)) {
      return NextResponse.json({
        ok: false,
        status: 'NO_ENTITLEMENT',
        tone: 'error',
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || ''
        },
        message: 'Bez nároku'
      }, { status: 403 })
    }

    const { data: selection } = await supabaseServer
      .from('vyber_jedal')
      .select('volba')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .maybeSingle()

    const choice = normalizeChoice(selection?.volba) || normalizeChoice(profile.typ_stravy)

    const { data: plannedItems, error: plannedItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        hromadny_vydaj_id,
        user_id,
        status,
        volba,
        hromadne_vydaje (
          id,
          group_id,
          datum,
          typ_jedla,
          status,
          valid_after,
          groups (
            name
          )
        )
      `)
      .eq('user_id', targetUserId)
      .eq('status', 'PLANNED')

    if (plannedItemsError) {
      return NextResponse.json({ error: plannedItemsError.message }, { status: 500 })
    }

    const matchingPlannedItems = (plannedItems || []).filter((item: any) => {
      const issue = issueOf(item)

      if (!issue) return false
      if (issue.datum !== datum || issue.typ_jedla !== typJedla) return false
      if (issue.status !== 'READY' && issue.status !== 'WAITING') return false
      if (!access.global && !access.groupIds.includes(issue.group_id)) return false

      return true
    })

    const now = new Date()
    const validBulkItem = matchingPlannedItems.find((item: any) => {
      const issue = issueOf(item)
      if (!issue) return false

      const targetRole = targetRoleByGroup.get(issue.group_id) || ''
      if (!canIssueForGroupByRole(targetRole, { isAdmin: false })) return false

      return isActiveIssue(issue, now)
    }) || null

    const relatedPlannedItem = validBulkItem || matchingPlannedItems[0] || null
    const relatedIssue = issueOf(relatedPlannedItem)
    const relatedGroup = groupOf(relatedIssue)
    const fallbackGroupId =
      relatedIssue?.group_id ||
      allowedTargetGroups[0]?.group_id ||
      null

    const sposob = validBulkItem ? 'HROMADNE' : 'INDIVIDUALNE'

    if (validBulkItem && relatedIssue?.id) {
      const { data: bulkItems, error: bulkItemsError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .select('id, user_id, volba')
        .eq('hromadny_vydaj_id', relatedIssue.id)
        .eq('status', 'PLANNED')

      if (bulkItemsError) {
        return NextResponse.json({ error: bulkItemsError.message }, { status: 500 })
      }

      const bulkUserIds = Array.from(
        new Set((bulkItems || []).map((item: any) => item.user_id).filter(Boolean))
      )

      if (bulkUserIds.length === 0) {
        return NextResponse.json({
          ok: false,
          status: 'EMPTY_BULK',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Hromadná príprava nemá žiadne nevydané položky.'
        }, { status: 409 })
      }

      const { data: alreadyBulkIssued, error: alreadyBulkIssuedError } = await supabaseServer
        .from('vydaj_jedal')
        .select('user_id')
        .eq('datum', datum)
        .eq('typ_jedla', typJedla)
        .eq('status', 'VYDANE')
        .in('user_id', bulkUserIds)

      if (alreadyBulkIssuedError) {
        return NextResponse.json({ error: alreadyBulkIssuedError.message }, { status: 500 })
      }

      const alreadyBulkIssuedIds = new Set((alreadyBulkIssued || []).map((row: any) => row.user_id))
      const bulkRowsToIssue = (bulkItems || []).filter((item: any) => !alreadyBulkIssuedIds.has(item.user_id))

      if (bulkRowsToIssue.length === 0) {
        return NextResponse.json({
          ok: false,
          status: 'ALREADY_ISSUED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          message: 'Už vydané'
        }, { status: 409 })
      }

      const bulkInsertRows = bulkRowsToIssue.map((item: any) => ({
        user_id: item.user_id,
        group_id: relatedIssue.group_id,
        hromadny_vydaj_id: relatedIssue.id,
        datum,
        typ_jedla: typJedla,
        volba: normalizeChoice(item.volba) || null,
        sposob: 'HROMADNE',
        status: 'VYDANE',
        issued_by: actor.id,
        qr_code: item.user_id === targetUserId ? qrCode : null,
        source: 'QR',
        note: 'Hromadný výdaj cez QR oprávnenej osoby.'
      }))

      const { data: issuedBulkRows, error: issueBulkError } = await supabaseServer
        .from('vydaj_jedal')
        .insert(bulkInsertRows)
        .select('id, issued_at')

      if (issueBulkError) {
        if (issueBulkError.code === '23505') {
          return NextResponse.json({
            ok: false,
            status: 'ALREADY_ISSUED',
            tone: 'error',
            person: {
              id: profile.id,
              fullName: fullName(profile) || profile.email || '',
              email: profile.email || ''
            },
            message: 'Niektoré jedlo už bolo vydané. Obnov stránku a skontroluj stav.'
          }, { status: 409 })
        }

        return NextResponse.json({ error: issueBulkError.message }, { status: 500 })
      }

      await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'BULK_ISSUED',
          updated_at: new Date().toISOString()
        })
        .eq('hromadny_vydaj_id', relatedIssue.id)
        .in('user_id', bulkRowsToIssue.map((item: any) => item.user_id))
        .eq('status', 'PLANNED')

      const firstIssuedRow = issuedBulkRows?.[0]
      const summary = choiceSummary(bulkRowsToIssue)
      const summaryText = formatChoiceSummary(summary)

      return NextResponse.json({
        ok: true,
        status: 'ISSUED',
        tone: 'success',
        issuedId: firstIssuedRow?.id || '',
        issuedAt: firstIssuedRow?.issued_at || new Date().toISOString(),
        issuedCount: bulkRowsToIssue.length,
        totalCount: bulkItems?.length || bulkRowsToIssue.length,
        person: {
          id: profile.id,
          fullName: fullName(profile) || profile.email || '',
          email: profile.email || '',
          phone: profile.telefon || ''
        },
        choice,
        bulkSummary: summary,
        method: 'HROMADNE',
        groupName: relatedGroup?.name || '',
        message: summaryText
          ? `Vydané hromadne: ${summaryText}`
          : `Vydané hromadne (${bulkRowsToIssue.length})`
      })
    }

    const { data: issued, error: issueError } = await supabaseServer
      .from('vydaj_jedal')
      .insert({
        user_id: targetUserId,
        group_id: fallbackGroupId,
        hromadny_vydaj_id: relatedIssue?.id || null,
        datum,
        typ_jedla: typJedla,
        volba: choice,
        sposob,
        status: 'VYDANE',
        issued_by: actor.id,
        qr_code: qrCode,
        source: 'QR',
        note: validBulkItem
          ? 'Hromadný výdaj cez QR oprávnenej osoby.'
          : relatedPlannedItem
            ? 'Individuálny výdaj cez QR z hromadnej prípravy.'
            : 'Individuálny výdaj cez QR.'
      })
      .select('id, issued_at')
      .single()

    if (issueError) {
      if (issueError.code === '23505') {
        return NextResponse.json({
          ok: false,
          status: 'ALREADY_ISSUED',
          tone: 'error',
          person: {
            id: profile.id,
            fullName: fullName(profile) || profile.email || '',
            email: profile.email || ''
          },
          choice,
          message: 'Už vydané'
        }, { status: 409 })
      }

      return NextResponse.json({ error: issueError.message }, { status: 500 })
    }

    if (matchingPlannedItems.length > 0) {
      await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'INDIVIDUAL_ISSUED',
          updated_at: new Date().toISOString()
        })
        .in('id', matchingPlannedItems.map((item: any) => item.id))
        .eq('status', 'PLANNED')
    }

    return NextResponse.json({
      ok: true,
      status: 'ISSUED',
      tone: 'success',
      issuedId: issued.id,
      issuedAt: issued.issued_at,
      person: {
        id: profile.id,
        fullName: fullName(profile) || profile.email || '',
        email: profile.email || '',
        phone: profile.telefon || ''
      },
      choice,
      method: sposob,
      groupName: relatedGroup?.name || '',
      message: relatedPlannedItem ? 'Vydané individuálne' : 'Vydané'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
