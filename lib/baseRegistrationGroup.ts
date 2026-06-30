import { supabaseServer } from '@/lib/supabaseServer'

function uniqueIds(userIds: string[]) {
  return Array.from(new Set(userIds.map(id => String(id || '').trim()).filter(Boolean)))
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

export async function setMissingBaseRegistrationGroup(
  userIds: string[],
  registrationGroupId: string | null | undefined
) {
  const safeRegistrationGroupId = String(registrationGroupId || '').trim()
  const safeUserIds = uniqueIds(userIds)

  if (!safeRegistrationGroupId || safeUserIds.length === 0) {
    return 0
  }

  let updated = 0
  const now = new Date().toISOString()

  for (const userIdChunk of chunk(safeUserIds, 250)) {
    const { count, error } = await supabaseServer
      .from('users')
      .update({
        registration_group_id: safeRegistrationGroupId,
        updated_at: now
      }, { count: 'exact' })
      .in('id', userIdChunk)
      .is('registration_group_id', null)

    if (error) throw error

    updated += count || 0
  }

  return updated
}
