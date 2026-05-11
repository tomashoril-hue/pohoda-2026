import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeChoice(value: any) {
  const text = String(value || '').trim().toUpperCase()

  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'

  return null
}

function entitlementStatus(entitlement: any, typJedla: string) {
  if (!entitlement) return 'UNKNOWN'

  if (typJedla === 'OBED') {
    return entitlement.obed ? 'YES' : 'NO'
  }

  if (typJedla === 'VECERA') {
    return entitlement.vecera ? 'YES' : 'NO'
  }

  return 'UNKNOWN'
}

function issuedStatusToItemStatus(row: any) {
  if (!row) return null

  if (row.sposob === 'HROMADNE') return 'BULK_ISSUED'

  return 'INDIVIDUAL_ISSUED'
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Nie si prihlásený.' },
        { status: 401 }
      )
    }

    const body = await req.json()

    const groupId = String(body.groupId || '').trim()
    const issueId = body.issueId ? String(body.issueId).trim() : ''
    const qrCode = String(body.qrCode || '').trim()
    const datum = String(body.datum || '').trim()
    const typJedla = String(body.typJedla || '').trim().toUpperCase()

    if (!groupId || !qrCode || !datum || !typJedla) {
      return NextResponse.json(
        { error: 'Chýba skupina, QR kód, dátum alebo typ jedla.' },
        { status: 400 }
      )
    }

    if (typJedla !== 'OBED' && typJedla !== 'VECERA') {
      return NextResponse.json(
        { error: 'Neplatný typ jedla.' },
        { status: 400 }
      )
    }

    const globalAccess = await getGlobalAccess(user.id)

    const { data: myMembership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      )
    }

    const myRole = String(myMembership?.role || '').toUpperCase()

    if ((!myMembership && !globalAccess.isAdmin) || !canIssueForGroupByRole(myRole, globalAccess)) {
      return NextResponse.json(
        { error: 'Nemáš oprávnenie použiť Expres QR pre túto skupinu.' },
        { status: 403 }
      )
    }

    const { data: qrRow, error: qrError } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id')
      .eq('qr_code', qrCode)
      .eq('active', true)
      .maybeSingle()

    if (qrError) {
      return NextResponse.json(
        { error: qrError.message },
        { status: 500 }
      )
    }

    if (!qrRow) {
      return NextResponse.json(
        { error: 'QR kód nebol nájdený alebo nie je aktívny.' },
        { status: 404 }
      )
    }

    const targetUserId = qrRow.user_id

    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy, qr_code, aktivny')
      .eq('id', targetUserId)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      )
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Používateľ k QR kódu sa nenašiel.' },
        { status: 404 }
      )
    }

    if (String(profile.aktivny || '').toUpperCase() !== 'ANO') {
      return NextResponse.json(
        { error: 'Osoba je zablokovana.' },
        { status: 403 }
      )
    }

    const { data: membershipInThisGroup } = await supabaseServer
      .from('group_members')
      .select('id, role')
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)
      .maybeSingle()

    const fullName = `${profile.meno || ''} ${profile.priezvisko || ''}`.trim()

    const { data: selection } = await supabaseServer
      .from('vyber_jedal')
      .select('volba')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .maybeSingle()

    const { data: entitlement } = await supabaseServer
      .from('user_food_entitlements')
      .select('obed, vecera')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .maybeSingle()

    const volba =
      normalizeChoice(selection?.volba) ||
      normalizeChoice(profile.typ_stravy)

    const baseMember = {
      userId: targetUserId,
      fullName: fullName || profile.email || qrCode,
      meno: profile.meno || '',
      priezvisko: profile.priezvisko || '',
      email: profile.email || '',
      telefon: profile.telefon || '',
      typStravy: volba || '',
      qrCode: profile.qr_code || qrCode,
      role: membershipInThisGroup?.role || '—',
      entitlementStatus: entitlementStatus(entitlement, typJedla),
      addedByQr: true,
      source: 'QR_EXTRA'
    }

    const { data: issuedMeal, error: issuedError } = await supabaseServer
      .from('vydaj_jedal')
      .select('id, sposob, status')
      .eq('user_id', targetUserId)
      .eq('datum', datum)
      .eq('typ_jedla', typJedla)
      .eq('status', 'VYDANE')
      .maybeSingle()

    if (issuedError) {
      return NextResponse.json(
        { error: issuedError.message },
        { status: 500 }
      )
    }

    if (issuedMeal) {
      return NextResponse.json({
        ok: true,
        status: 'ALREADY_ISSUED',
        message:
          issuedMeal.sposob === 'HROMADNE'
            ? 'Používateľ už má jedlo vydané hromadne.'
            : 'Používateľ už prevzal jedlo osobne.',
        member: {
          ...baseMember,
          status: issuedStatusToItemStatus(issuedMeal),
          removeReason: null
        }
      })
    }

    const { data: otherItems, error: otherItemsError } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        hromadny_vydaj_id,
        status,
        hromadne_vydaje (
          id,
          group_id,
          datum,
          typ_jedla,
          status
        )
      `)
      .eq('user_id', targetUserId)
      .eq('status', 'PLANNED')

    if (otherItemsError) {
      return NextResponse.json(
        { error: otherItemsError.message },
        { status: 500 }
      )
    }

    const conflictItem = (otherItems || []).find((item: any) => {
      const issue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      if (!issue) return false

      return (
        issue.datum === datum &&
        issue.typ_jedla === typJedla &&
        issue.group_id !== groupId &&
        (issue.status === 'READY' || issue.status === 'WAITING')
      )
    })

    if (conflictItem && issueId) {
      const { data: issue, error: issueError } = await supabaseServer
        .from('hromadne_vydaje')
        .select('id, group_id, datum, typ_jedla, status')
        .eq('id', issueId)
        .maybeSingle()

      if (issueError) {
        return NextResponse.json(
          { error: issueError.message },
          { status: 500 }
        )
      }

      if (!issue || issue.group_id !== groupId) {
        return NextResponse.json(
          { error: 'Príprava sa nenašla alebo nepatrí do tejto skupiny.' },
          { status: 404 }
        )
      }

      if (issue.datum !== datum || issue.typ_jedla !== typJedla) {
        return NextResponse.json(
          { error: 'QR sa pridáva do iného dátumu alebo typu jedla.' },
          { status: 400 }
        )
      }

      const { data: existingItem, error: existingItemError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .select('id, status, remove_reason, source')
        .eq('hromadny_vydaj_id', issueId)
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (existingItemError) {
        return NextResponse.json(
          { error: existingItemError.message },
          { status: 500 }
        )
      }

      const now = new Date().toISOString()

      const { error: moveOldItemError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          status: 'REMOVED',
          remove_reason: 'MOVED_TO_OTHER_ISSUE',
          removed_at: now,
          removed_by: user.id,
          updated_at: now
        })
        .eq('id', conflictItem.id)

      if (moveOldItemError) {
        return NextResponse.json(
          { error: moveOldItemError.message },
          { status: 500 }
        )
      }

      const newIssueStatus = myRole === 'POVERENY' ? 'WAITING' : 'READY'
      const newValidAfter =
        myRole === 'POVERENY'
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          : null

      if (!existingItem) {
        const { error: insertItemError } = await supabaseServer
          .from('hromadny_vydaj_polozky')
          .insert({
            hromadny_vydaj_id: issueId,
            user_id: targetUserId,
            source: 'QR_EXTRA',
            volba,
            status: 'PLANNED',
            added_by: user.id,
            updated_at: now
          })

        if (insertItemError) {
          return NextResponse.json(
            { error: insertItemError.message },
            { status: 500 }
          )
        }
      }

      const { error: updateIssueError } = await supabaseServer
        .from('hromadne_vydaje')
        .update({
          status: newIssueStatus,
          valid_after: newValidAfter,
          last_changed_at: now,
          updated_at: now
        })
        .eq('id', issueId)

      if (updateIssueError) {
        return NextResponse.json(
          { error: updateIssueError.message },
          { status: 500 }
        )
      }

      const existingItemSafe: any = existingItem

      return NextResponse.json({
        ok: true,
        status: 'ADDED_WITH_MOVE',
        message: existingItemSafe
          ? 'Používateľ už je v tejto príprave. Pôvodná príprava bola deaktivovaná.'
          : 'Používateľ bol presunutý z inej prípravy sem.',
        member: {
          ...baseMember,
          status: existingItemSafe?.status || 'PLANNED',
          removeReason: existingItemSafe?.remove_reason || null,
          addedByQr: true,
          source: existingItemSafe?.source || 'QR_EXTRA',
          transferFromOtherIssue: true
        }
      })
    }

    /*
      Dôležité:
      Tu už NEBLOKUJEME QR_EXTRA, ak je používateľ v inom výdaji.
      QR má byť silnejší dôkaz, že človek je fyzicky pri obsluhe.
      Preto ho vrátime ako ADDED_WITH_MOVE.
      Samotné zneplatnenie starej prípravy sa spraví až pri create/update route.
    */
    if (conflictItem) {
      return NextResponse.json({
        ok: true,
        status: 'ADDED_WITH_MOVE',
        message: 'Používateľ bude po potvrdení presunutý z inej prípravy sem.',
        member: {
          ...baseMember,
          status: 'PLANNED',
          removeReason: null,
          transferFromOtherIssue: true
        }
      })
    }

    if (issueId) {
      const { data: issue, error: issueError } = await supabaseServer
        .from('hromadne_vydaje')
        .select('id, group_id, datum, typ_jedla, status')
        .eq('id', issueId)
        .maybeSingle()

      if (issueError) {
        return NextResponse.json(
          { error: issueError.message },
          { status: 500 }
        )
      }

      if (!issue || issue.group_id !== groupId) {
        return NextResponse.json(
          { error: 'Príprava sa nenašla alebo nepatrí do tejto skupiny.' },
          { status: 404 }
        )
      }

      if (issue.datum !== datum || issue.typ_jedla !== typJedla) {
        return NextResponse.json(
          { error: 'QR sa pridáva do iného dátumu alebo typu jedla.' },
          { status: 400 }
        )
      }

      const { data: existingItem, error: existingItemError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .select('id, status, remove_reason, source')
        .eq('hromadny_vydaj_id', issueId)
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (existingItemError) {
        return NextResponse.json(
          { error: existingItemError.message },
          { status: 500 }
        )
      }

      if (existingItem) {
        const existingItemSafe: any = existingItem

        return NextResponse.json({
          ok: true,
          status: 'EXISTS',
          message: 'Používateľ už je v tejto príprave.',
          member: {
            ...baseMember,
            status: existingItemSafe.status,
            removeReason: existingItemSafe.remove_reason,
            addedByQr: existingItemSafe.source === 'QR_EXTRA',
            source: existingItemSafe.source
          }
        })
      }

      const now = new Date().toISOString()

      const newIssueStatus = myRole === 'POVERENY' ? 'WAITING' : 'READY'
      const newValidAfter =
        myRole === 'POVERENY'
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          : null

      const { error: insertItemError } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .insert({
          hromadny_vydaj_id: issueId,
          user_id: targetUserId,
          source: 'QR_EXTRA',
          volba,
          status: 'PLANNED',
          added_by: user.id,
          updated_at: now
        })

      if (insertItemError) {
        return NextResponse.json(
          { error: insertItemError.message },
          { status: 500 }
        )
      }

      const { error: updateIssueError } = await supabaseServer
        .from('hromadne_vydaje')
        .update({
          status: newIssueStatus,
          valid_after: newValidAfter,
          last_changed_at: now,
          updated_at: now
        })
        .eq('id', issueId)

      if (updateIssueError) {
        return NextResponse.json(
          { error: updateIssueError.message },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      ok: true,
      status: 'ADDED',
      message: 'Používateľ bol pridaný cez QR.',
      member: {
        ...baseMember,
        status: 'PLANNED',
        removeReason: null
      }
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
