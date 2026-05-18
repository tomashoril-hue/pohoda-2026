import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { canManagePersonAsPersonalista } from '@/lib/personalistaAccess'
import { supabaseServer } from '@/lib/supabaseServer'
import PrintQrClient from './PrintQrClient'

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

function firstItem(value: any) {
  return Array.isArray(value) ? value[0] : value
}

async function activeQrByUser(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>()

  const { data } = await supabaseServer
    .from('user_qr_codes')
    .select('user_id, qr_code')
    .in('user_id', userIds)
    .eq('active', true)

  return new Map((data || []).map((row: any) => [row.user_id, row.qr_code]))
}

export default async function PersonalistaPrintQrPage({
  searchParams
}: {
  searchParams: Promise<{ groupId?: string; personId?: string }>
}) {
  const actor = await getCurrentUser()

  if (!actor) {
    redirect('/')
  }

  const params = await searchParams
  const groupId = String(params.groupId || '').trim()
  const personId = String(params.personId || '').trim()

  if (!groupId && !personId) {
    redirect('/dashboard/personalista')
  }

  const globalAccess = await getGlobalAccess(actor.id)

  if (!globalAccess.canUsePersonalista) {
    redirect('/dashboard')
  }

  if (personId) {
    const access = await canManagePersonAsPersonalista(actor.id, personId)

    if (!access.ok) {
      redirect('/dashboard/personalista')
    }

    const { data: profile } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, typ_stravy')
      .eq('id', personId)
      .maybeSingle()

    if (!profile) {
      redirect('/dashboard/personalista')
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select(`
        group_id,
        groups (
          id,
          name
        )
      `)
      .eq('user_id', personId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const qrMap = await activeQrByUser([personId])
    const qrCode = qrMap.get(personId)
    const group = firstItem(membership?.groups)

    return (
      <PrintQrClient
        title={`QR osoba - ${fullName(profile) || profile.email || 'Bez mena'}`}
        items={qrCode ? [{
          userId: profile.id,
          fullName: fullName(profile) || profile.email || 'Bez mena',
          groupName: group?.name || 'Bez skupiny',
          food: profile.typ_stravy || '',
          qrCode
        }] : []}
      />
    )
  }

  const { data: group } = await supabaseServer
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) {
    redirect('/dashboard/personalista')
  }

  const { data: memberships } = await supabaseServer
    .from('group_members')
    .select(`
      user_id,
      role,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email,
        typ_stravy
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  const userIds = (memberships || [])
    .map((membership: any) => membership.user_id)
    .filter(Boolean)

  const qrMap = await activeQrByUser(userIds)

  const items = (memberships || [])
    .map((membership: any) => {
      const memberUser = firstItem(membership.users)
      const qrCode = qrMap.get(membership.user_id)

      if (!memberUser || !qrCode) return null

      return {
        userId: membership.user_id,
        fullName: fullName(memberUser) || memberUser.email || 'Bez mena',
        groupName: group.name || 'Skupina bez nazvu',
        food: memberUser.typ_stravy || '',
        qrCode
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'sk'))

  return (
    <PrintQrClient
      title={`QR skupina - ${group.name || 'Skupina bez nazvu'}`}
      items={items as any}
    />
  )
}
