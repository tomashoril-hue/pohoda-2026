import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
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

    const { data: myMembership, error: membershipError } = await supabaseServer
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 500 })
    }

    const myRole = String(myMembership?.role || '').toUpperCase()

    if (!myMembership || (myRole !== 'MANAGER' && myRole !== 'POVERENY' && myRole !== 'OWNER')) {
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
      return NextResponse.json({ error: qrError.message }, { status: 500 })
    }

    if (!qrRow) {
      return NextResponse.json(
        { error: 'QR kód nebol nájdený alebo nie je aktívny.' },
        { status: 404 }
      )
    }

    const targetUserId = qrRow.user_id

    if (targetUserId === user.id) {
      // toto nezakazujeme, manager môže byť aj členom skupiny
    }

    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy')
      .eq('id', targetUserId)
      .maybeSingle()

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Používateľ k QR kódu sa nenašiel.' },
        { status: 404 }
      )
    }

    const { data: existingMembership } = await supabaseServer
      .from('group_members')
      .select('id, group_id, role')
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (existingMembership && existingMembership.group_id !== groupId) {
      return NextResponse.json(
        { error: 'Používateľ je už členom inej skupiny.' },
        { status: 400 }
      )
    }

    if (!existingMembership) {
      const { error: addMemberError } = await supabaseServer
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: targetUserId,
          role: 'MEMBER'
        })

      if (addMemberError) {
        return NextResponse.json({ error: addMemberError.message }, { status: 500 })
      }
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
      return NextResponse.json({ error: otherItemsError.message }, { status: 500 })
    }

    const conflictItem = (otherItems || []).find((item: any) => {
      const issue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      if (!issue) return false

      return (
        issue.group_id !== groupId &&
        issue.datum === datum &&
        issue.typ_jedla === typJedla &&
        (issue.status === 'READY' || issue.status === 'WAITING')
      )
    })

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
      role: existingMembership?.role || 'MEMBER',
      entitlementStatus: entitlementStatus(entitlement, typJedla),
      addedByQr: true
    }

    if (conflictItem) {
      return NextResponse.json({
        ok: true,
        status: 'IN_OTHER_ISSUE',
        message: 'Používateľ je už v inom hromadnom výdaji.',
        member: {
          ...baseMember,
          status: 'REMOVED',
          removeReason: 'IN_OTHER_ISSUE',
          role: '—'
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
        return NextResponse.json({ error: issueError.message }, { status: 500 })
      }

      if (!issue || issue.group_id !== groupId) {
        return NextResponse.json(
          { error: 'Príprava sa nenašla alebo nepatrí do tejto skupiny.' },
          { status: 404 }
        )
      }

      const { data: existingItem } = await supabaseServer
        .from('hromadny_vydaj_polozky')
        .select('id, status, remove_reason')
        .eq('hromadny_vydaj_id', issueId)
        .eq('user_id', targetUserId)
        .maybeSingle()

      const now = new Date().toISOString()
      const newIssueStatus = myRole === 'POVERENY' ? 'WAITING' : 'READY'
      const newValidAfter =
        myRole === 'POVERENY'
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          : null

      if (existingItem) {
        const { error: updateItemError } = await supabaseServer
          .from('hromadny_vydaj_polozky')
          .update({
            status: 'PLANNED',
            remove_reason: null,
            removed_at: null,
            removed_by: null,
            source: 'QR',
            updated_at: now
          })
          .eq('id', existingItem.id)

        if (updateItemError) {
          return NextResponse.json({ error: updateItemError.message }, { status: 500 })
        }
      } else {
        const { error: insertItemError } = await supabaseServer
          .from('hromadny_vydaj_polozky')
          .insert({
            hromadny_vydaj_id: issueId,
            user_id: targetUserId,
            source: 'QR',
            volba,
            status: 'PLANNED',
            added_by: user.id,
            updated_at: now
          })

        if (insertItemError) {
          return NextResponse.json({ error: insertItemError.message }, { status: 500 })
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
        return NextResponse.json({ error: updateIssueError.message }, { status: 500 })
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