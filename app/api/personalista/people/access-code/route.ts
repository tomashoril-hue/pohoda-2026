import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAccessCode, hashAccessCode, normalizeAccessName } from '@/lib/accessCode'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isTechnicalUser(user: any) {
  return String(user?.account_type || '').toUpperCase() === 'TECHNICAL'
}

async function getAuthorizedTarget(actorId: string, userId: string) {
  const access = await getGlobalAccess(actorId)

  if (!access.canUsePersonalista) {
    return {
      error: 'Nemas opravnenie.',
      status: 403,
      user: null,
      access
    }
  }

  const { data: user, error: userError } = await supabaseServer
    .from('users')
    .select('id, meno, priezvisko, email, account_type')
    .eq('id', userId)
    .maybeSingle()

  if (userError) {
    return {
      error: userError.message,
      status: 500,
      user: null,
      access
    }
  }

  if (!user) {
    return {
      error: 'Osoba neexistuje.',
      status: 404,
      user: null,
      access
    }
  }

  if (isTechnicalUser(user) && !access.isAdmin) {
    return {
      error: 'Pristupovy kod technickeho uctu moze zobrazit iba ADMIN.',
      status: 403,
      user: null,
      access
    }
  }

  return {
    error: '',
    status: 200,
    user,
    access
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const userId = cleanText(req.nextUrl.searchParams.get('userId'))

    if (!userId || !isUuid(userId)) {
      return NextResponse.json({ error: 'Neplatna osoba.' }, { status: 400 })
    }

    const authorized = await getAuthorizedTarget(actor.id, userId)

    if (!authorized.user) {
      return NextResponse.json(
        { error: authorized.error },
        { status: authorized.status }
      )
    }

    const { data: accessCode, error: accessCodeError } = await supabaseServer
      .from('user_access_codes')
      .select('id, access_code_plain, created_at')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (accessCodeError) {
      return NextResponse.json({ error: accessCodeError.message }, { status: 500 })
    }

    if (!accessCode?.access_code_plain) {
      return NextResponse.json({
        ok: true,
        hasAccessCode: false,
        accessCode: ''
      })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_ACCESS_CODE_VIEWED',
        entity_table: 'user_access_codes',
        entity_id: accessCode.id,
        after_data: {
          account_type: String(authorized.user.account_type || 'PERSON').toUpperCase()
        }
      })

    return NextResponse.json({
      ok: true,
      hasAccessCode: true,
      accessCode: accessCode.access_code_plain
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)

    if (!userId || !isUuid(userId)) {
      return NextResponse.json({ error: 'Neplatna osoba.' }, { status: 400 })
    }

    const authorized = await getAuthorizedTarget(actor.id, userId)

    if (!authorized.user) {
      return NextResponse.json(
        { error: authorized.error },
        { status: authorized.status }
      )
    }

    const now = new Date().toISOString()

    const { data: beforeCodes, error: beforeError } = await supabaseServer
      .from('user_access_codes')
      .select('id, active, label, created_at')
      .eq('user_id', userId)
      .eq('active', true)

    if (beforeError) {
      return NextResponse.json({ error: beforeError.message }, { status: 500 })
    }

    if ((beforeCodes || []).length > 0) {
      const { error: revokeError } = await supabaseServer
        .from('user_access_codes')
        .update({
          active: false,
          revoked_at: now,
          revoked_by: actor.id,
          updated_at: now
        })
        .eq('user_id', userId)
        .eq('active', true)

      if (revokeError) {
        return NextResponse.json({ error: revokeError.message }, { status: 500 })
      }
    }

    const accessCodePlain = createAccessCode()
    const label = isTechnicalUser(authorized.user)
      ? 'Technicky ucet - pristupovy kod'
      : 'Personalistika - pristupovy kod'

    const { data: insertedCode, error: insertError } = await supabaseServer
      .from('user_access_codes')
      .insert({
        user_id: userId,
        code_hash: hashAccessCode(authorized.user.meno, authorized.user.priezvisko, accessCodePlain),
        access_code_plain: accessCodePlain,
        meno_key: normalizeAccessName(authorized.user.meno),
        priezvisko_key: normalizeAccessName(authorized.user.priezvisko),
        label,
        created_by: actor.id
      })
      .select('id')
      .single()

    if (insertError || !insertedCode) {
      return NextResponse.json(
        { error: insertError?.message || 'Pristupovy kod sa nepodarilo vytvorit.' },
        { status: 500 }
      )
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_ACCESS_CODE_GENERATED',
        entity_table: 'user_access_codes',
        entity_id: insertedCode.id,
        before_data: {
          active_code_count: (beforeCodes || []).length
        },
        after_data: {
          account_type: String(authorized.user.account_type || 'PERSON').toUpperCase()
        }
      })

    return NextResponse.json({
      ok: true,
      hasAccessCode: true,
      accessCode: accessCodePlain,
      message: 'Pristupovy kod bol vytvoreny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
