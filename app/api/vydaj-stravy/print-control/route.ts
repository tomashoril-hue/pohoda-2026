import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

const KNOWN_PRINTERS = new Set(['vydaj-1', 'vydaj-zurnal'])

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizePrinterId(value: unknown) {
  const printerId = cleanText(value).slice(0, 80)
  return KNOWN_PRINTERS.has(printerId) ? printerId : ''
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Nie si prihlásený.' }, { status: 401 })
    }

    const access = await getGlobalAccess(actor.id)

    if (!access.canAdminFoodIssue) {
      return NextResponse.json({ error: 'Tlač výdaja môže riadiť iba ADMIN alebo ADMIN_VYDAJ.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const printerId = normalizePrinterId(body.printerId || body.printer_id)

    if (!printerId) {
      return NextResponse.json({ error: 'Neplatná tlačiareň.' }, { status: 400 })
    }

    const cancelPending = Boolean(body.cancelPending || body.cancel_pending)
    const stopRequested = Boolean(body.stop)
    const now = new Date().toISOString()

    const { data, error } = await supabaseServer
      .from('print_control')
      .upsert({
        printer_id: printerId,
        stop_requested: stopRequested,
        requested_at: stopRequested ? now : null,
        requested_by: stopRequested ? actor.id : null,
        updated_at: now
      }, { onConflict: 'printer_id' })
      .select('printer_id, stop_requested, updated_at')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (cancelPending) {
      const { data: cancelledJobs, error: cancelError } = await supabaseServer
        .from('print_jobs')
        .update({
          status: 'failed',
          error_message: 'Zrušené používateľom pred tlačou.'
        })
        .eq('printer_id', printerId)
        .eq('status', 'pending')
        .select('id')

      if (cancelError) {
        return NextResponse.json({ error: cancelError.message }, { status: 500 })
      }

      const cancelledCount = cancelledJobs?.length || 0

      return NextResponse.json({
        ok: true,
        control: data,
        cancelledCount,
        message: cancelledCount > 0
          ? `Zrušených čakajúcich úloh: ${cancelledCount}.`
          : 'Žiadne čakajúce úlohy nebolo treba zrušiť.'
      })
    }

    return NextResponse.json({
      ok: true,
      control: data,
      message: stopRequested
        ? 'Tlačiareň dostala pokyn zastaviť po aktuálnom štítku.'
        : 'Tlačiareň je znovu povolená.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Tlač sa nepodarilo ovládať.' },
      { status: 500 }
    )
  }
}
