import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select('id, group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json(
        { error: 'Nie ste členom žiadnej skupiny.' },
        { status: 400 }
      )
    }

    const myRole = String(membership.role || '').toUpperCase()

    // Dočasne podporujeme aj OWNER, kým premigrujeme databázu.
    // Po novom je hlavná rola MANAGER.
    const isMainManager = myRole === 'MANAGER' || myRole === 'OWNER'

    if (isMainManager) {
      const { data: managers, error: managersError } = await supabaseServer
        .from('group_members')
        .select('id')
        .eq('group_id', membership.group_id)
        .in('role', ['MANAGER', 'OWNER'])

      if (managersError) {
        return NextResponse.json(
          { error: 'Chyba pri kontrole manažérov skupiny: ' + managersError.message },
          { status: 500 }
        )
      }

      if (!managers || managers.length <= 1) {
        return NextResponse.json(
          {
            error:
              'Nemôžete opustiť skupinu ako jediný MANAGER. Najprv nastavte iného člena ako MANAGER.'
          },
          { status: 400 }
        )
      }
    }

    const { error } = await supabaseServer
      .from('group_members')
      .delete()
      .eq('id', membership.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}