import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit'
import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(req: NextRequest) {
  const ipLimit = checkRateLimit(req, 'public-registration-groups', 120, 10 * 60 * 1000)
  if (!ipLimit.ok) return rateLimitResponse(ipLimit)

  const { data, error } = await supabaseServer
    .from('registration_groups')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    groups: data || []
  })
}
