import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import AddByQrClient from './AddByQrClient'

export default async function AddByQrPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const { groupId } = await params

  const { data: membership } = await supabaseServer
    .from('group_members')
    .select('role')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .in('role', ['OWNER', 'MANAGER'])
    .maybeSingle()

  if (!membership) redirect('/menu')

  const { data: group } = await supabaseServer
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) redirect('/menu')

  return <AddByQrClient groupId={group.id} groupName={group.name} />
}