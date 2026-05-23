import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeChoice(value: any) {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'
  return ''
}

async function canEditIssuedMeal(actorId: string) {
  const globalAccess = await getGlobalAccess(actorId)
  return globalAccess.canAdminFoodIssue
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const issuedId = String(body.issuedId || '').trim()
    const choice = normalizeChoice(body.choice)

    if (!issuedId || !choice) {
      return NextResponse.json({ error: 'Chýba výdaj alebo platná voľba jedla.' }, { status: 400 })
    }

    const { data: issuedMeal, error: issuedMealError } = await supabaseServer
      .from('vydaj_jedal')
      .select('id, user_id, group_id, issued_by, status')
      .eq('id', issuedId)
      .maybeSingle()

    if (issuedMealError) {
      return NextResponse.json({ error: issuedMealError.message }, { status: 500 })
    }

    if (!issuedMeal) {
      return NextResponse.json({ error: 'Výdaj sa nenašiel.' }, { status: 404 })
    }

    if (issuedMeal.status !== 'VYDANE') {
      return NextResponse.json({ error: 'Upravovať sa dá iba aktívny vydaný výdaj.' }, { status: 400 })
    }

    const allowed = await canEditIssuedMeal(actor.id)

    if (!allowed) {
      return NextResponse.json({ error: 'Nemáš oprávnenie upraviť tento výdaj.' }, { status: 403 })
    }

    const { error: updateError } = await supabaseServer
      .from('vydaj_jedal')
      .update({
        volba: choice,
        note: 'Voľba jedla bola upravená pri výdaji.'
      })
      .eq('id', issuedMeal.id)
      .eq('status', 'VYDANE')

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Výdaj bol upravený.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Neznáma chyba servera.' },
      { status: 500 }
    )
  }
}
