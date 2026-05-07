import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import AddByQrClient from '../../../../groups/[groupId]/add-by-qr/AddByQrClient'

export default async function DashboardGroupAddByQrPage({
  params
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { groupId } = await params

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle()

  const myRole = String(membership?.role || '').toUpperCase()

  const canAddByQr =
    myRole === 'MANAGER' ||
    myRole === 'OWNER'

  if (!membership || !canAddByQr) {
    redirect(`/dashboard/groups/${groupId}`)
  }

  const { data: group } = await supabaseServer
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) {
    redirect('/dashboard/groups')
  }

  return <AddByQrClient groupId={group.id} groupName={group.name} />
}
