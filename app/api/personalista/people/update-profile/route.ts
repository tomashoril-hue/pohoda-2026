import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'

function cleanText(value: any) {
  return String(value || '').trim()
}

function cleanEmail(value: any) {
  const email = cleanText(value).toLowerCase()
  return email || null
}

function cleanFood(value: any) {
  const food = cleanText(value).toUpperCase()

  if (food === 'MASO') return 'MASO'
  if (food === 'VEGE') return 'VEGE'
  if (food === 'DIETA' || food === 'DIÉTA' || food === 'DIĂ‰TA') return 'DIETA'

  return ''
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const body = await req.json()
    const userId = cleanText(body.userId)
    const meno = cleanText(body.meno)
    const priezvisko = cleanText(body.priezvisko)
    const email = cleanEmail(body.email)
    const telefon = cleanText(body.telefon) || null
    const typStravy = cleanFood(body.typStravy)

    if (!userId) {
      return NextResponse.json({ error: 'Chyba osoba.' }, { status: 400 })
    }

    if (!meno || !priezvisko) {
      return NextResponse.json({ error: 'Meno a priezvisko su povinne.' }, { status: 400 })
    }

    if (!typStravy) {
      return NextResponse.json({ error: 'Vyber platny typ stravy.' }, { status: 400 })
    }

    const access = await canManagePersonAsPersonalista(actor.id, userId)

    if (!access.ok) {
      return NextResponse.json(
        { error: access.error || 'Nemate opravnenie.' },
        { status: access.status || 403 }
      )
    }

    if (email) {
      const { data: existingEmail, error: emailError } = await supabaseServer
        .from('users')
        .select('id')
        .eq('email', email)
        .neq('id', userId)
        .maybeSingle()

      if (emailError) {
        return NextResponse.json({ error: emailError.message }, { status: 500 })
      }

      if (existingEmail) {
        return NextResponse.json(
          { error: 'Tento e-mail uz pouziva ina osoba.' },
          { status: 409 }
        )
      }
    }

    const { data: before } = await supabaseServer
      .from('users')
      .select('meno, priezvisko, email, telefon, typ_stravy')
      .eq('id', userId)
      .maybeSingle()

    const now = new Date().toISOString()

    const { error: updateError } = await supabaseServer
      .from('users')
      .update({
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy: typStravy,
        updated_at: now
      })
      .eq('id', userId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await supabaseServer
      .from('personnel_audit_log')
      .insert({
        actor_user_id: actor.id,
        target_user_id: userId,
        action: 'PERSON_PROFILE_UPDATED',
        entity_table: 'users',
        entity_id: userId,
        before_data: before || null,
        after_data: {
          meno,
          priezvisko,
          email,
          telefon,
          typ_stravy: typStravy
        }
      })

    return NextResponse.json({
      ok: true,
      message: 'Detail osoby bol ulozeny.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznama chyba servera.' },
      { status: 500 }
    )
  }
}
