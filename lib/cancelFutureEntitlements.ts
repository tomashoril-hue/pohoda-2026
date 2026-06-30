import { slovakiaDateIso } from '@/lib/date'
import { supabaseServer } from '@/lib/supabaseServer'

export type EntitlementCancellationReason = 'BLOCKED' | 'DEREGISTERED'

export async function cancelFutureFoodEntitlements({
  userId,
  actorId,
  reason
}: {
  userId: string
  actorId: string
  reason: EntitlementCancellationReason
}) {
  const tomorrow = slovakiaDateIso(1)
  const now = new Date().toISOString()

  const { data: beforeRows, error: beforeError } = await supabaseServer
    .from('user_food_entitlements')
    .select('datum, obed, vecera, cancelled_reason')
    .eq('user_id', userId)
    .gte('datum', tomorrow)
    .or('obed.eq.true,vecera.eq.true')

  if (beforeError) throw beforeError

  const { error: updateError } = await supabaseServer
    .from('user_food_entitlements')
    .update({
      obed: false,
      vecera: false,
      cancelled_reason: reason,
      cancelled_at: now,
      cancelled_by: actorId,
      updated_by: actorId,
      updated_at: now
    })
    .eq('user_id', userId)
    .gte('datum', tomorrow)
    .or('obed.eq.true,vecera.eq.true')

  if (updateError) throw updateError

  return {
    fromDate: tomorrow,
    cancelledCount: beforeRows?.length || 0,
    beforeRows: beforeRows || []
  }
}
