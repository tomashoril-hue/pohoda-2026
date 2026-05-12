import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { canIssueForGroupByRole, getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function normalizeChoice(value: any) {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'MASO') return 'MASO'
  if (text === 'VEGE') return 'VEGE'
  if (text === 'DIETA' || text === 'DIÉTA') return 'DIETA'
  return ''
}

async function canEditIssuedMeal(actorId: string, issuedMeal: any) {
  if (issuedMeal.issued_by === actorId) return true

  const globalAccess = await getGlobalAccess(actorId)
  if (globalAccess.canUsePersonalista) return true

  if (!issuedMeal.group_id) return false

  const { data: membership, error } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('group_id', issuedMeal.group_id)
    .eq('user_id', actorId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  return canIssueForGroupByRole(String(membership?.role || '').toUpperCase(), globalAccess)
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
      .select('id, user_id, group_id, hromadny_vydaj_id, issued_by, status')
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

    const allowed = await canEditIssuedMeal(actor.id, issuedMeal)

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

    if (issuedMeal.hromadny_vydaj_id) {
      await supabaseServer
        .from('hromadny_vydaj_polozky')
        .update({
          volba: choice,
          updated_at: new Date().toISOString()
        })
        .eq('hromadny_vydaj_id', issuedMeal.hromadny_vydaj_id)
        .eq('user_id', issuedMeal.user_id)
        .in('status', ['BULK_ISSUED', 'INDIVIDUAL_ISSUED'])
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
