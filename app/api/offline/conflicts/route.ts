import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function uniqueIds(values: unknown[]) {
  return Array.from(new Set(values.map(value => cleanText(value)).filter(Boolean)))
}

async function requireOfflineAccess() {
  const actor = await getCurrentUser()

  if (!actor) {
    return { actor: null, error: NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 }) }
  }

  const access = await getGlobalAccess(actor.id)
  if (!access.canPrepareOfflineIssue) {
    return { actor, error: NextResponse.json({ error: 'Nemáš oprávnenie spravovať offline konflikty.' }, { status: 403 }) }
  }

  return { actor, error: null }
}

async function loadUserNames(userIds: string[]) {
  const ids = uniqueIds(userIds)
  const map = new Map<string, string>()

  if (ids.length === 0) return map

  const { data, error } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email')
    .in('id', ids)

  if (error) throw error

  ;(data || []).forEach((user: any) => {
    const fullName = `${user.meno || ''} ${user.priezvisko || ''}`.trim()
    map.set(user.id, fullName || user.email || user.id)
  })

  return map
}

export async function GET(req: NextRequest) {
  try {
    const { error } = await requireOfflineAccess()
    if (error) return error

    const statusParam = cleanText(req.nextUrl.searchParams.get('status')).toUpperCase()
    const status = statusParam === 'RESOLVED' ? 'RESOLVED' : statusParam === 'ALL' ? 'ALL' : 'OPEN'
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 80)))

    let query = supabaseServer
      .from('offline_sync_conflicts')
      .select(`
        id,
        offline_event_id,
        device_id,
        snapshot_id,
        qr_code,
        person_id,
        meal_date,
        meal_type,
        issue_location,
        conflict_type,
        conflict_payload,
        status,
        created_at,
        resolved_at,
        resolved_by,
        resolution_note
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status !== 'ALL') {
      query = query.eq('status', status)
    }

    const { data, error: queryError } = await query
    if (queryError) throw queryError

    const rows = data || []
    const userNames = await loadUserNames([
      ...rows.map((row: any) => row.person_id),
      ...rows.map((row: any) => row.resolved_by)
    ])

    return NextResponse.json({
      ok: true,
      items: rows.map((row: any) => ({
        id: row.id,
        offlineEventId: row.offline_event_id,
        deviceId: row.device_id,
        snapshotId: row.snapshot_id,
        qrCode: row.qr_code || '',
        personId: row.person_id || '',
        personName: row.person_id ? userNames.get(row.person_id) || '' : '',
        mealDate: row.meal_date || '',
        mealType: row.meal_type || '',
        issueLocation: row.issue_location || '',
        conflictType: row.conflict_type || '',
        message: row.conflict_payload?.message || '',
        payload: row.conflict_payload || {},
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at || '',
        resolvedBy: row.resolved_by || '',
        resolvedByName: row.resolved_by ? userNames.get(row.resolved_by) || '' : '',
        resolutionNote: row.resolution_note || ''
      }))
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Konflikty sa nepodarilo načítať.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { actor, error } = await requireOfflineAccess()
    if (error) return error

    const body = await req.json().catch(() => null)
    const conflictId = cleanText(body?.conflictId)
    const note = cleanText(body?.note).slice(0, 500)

    if (!conflictId) {
      return NextResponse.json({ error: 'Chýba konflikt.' }, { status: 400 })
    }

    const { data, error: updateError } = await supabaseServer
      .from('offline_sync_conflicts')
      .update({
        status: 'RESOLVED',
        resolved_at: new Date().toISOString(),
        resolved_by: actor?.id,
        resolution_note: note || null
      })
      .eq('id', conflictId)
      .select('id')
      .single()

    if (updateError) throw updateError

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Konflikt sa nepodarilo označiť ako vyriešený.' },
      { status: 500 }
    )
  }
}
