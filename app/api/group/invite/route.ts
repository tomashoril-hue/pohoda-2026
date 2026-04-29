import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Nie ste prihlásený.' }, { status: 401 })
    }

    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'Zadajte e-mail.' }, { status: 400 })
    }

    const { data: membership } = await supabaseServer
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Nie ste v skupine.' }, { status: 400 })
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Pozývať môže iba vlastník skupiny.' }, { status: 403 })
    }

    const { data: group } = await supabaseServer
      .from('groups')
      .select('name')
      .eq('id', membership.group_id)
      .single()

    const token = crypto.randomBytes(32).toString('hex')

    const { error } = await supabaseServer
      .from('group_invites')
      .insert({
        group_id: membership.group_id,
        email,
        token,
        created_by: user.id
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const inviteLink = `${baseUrl}/dashboard/invites`

    const emailResult = await resend.emails.send({
      from: 'POHODA Strava <noreply@pohodapass.sk>',
      to: email,
      subject: `Pozvánka do skupiny ${group?.name || ''}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Pozvánka do skupiny</h2>
          <p>Boli ste pozvaný/á do skupiny <b>${group?.name || ''}</b>.</p>
          <p>Prihláste sa do aplikácie a pozvánku potvrďte alebo odmietnite.</p>
          <p>
            <a href="${inviteLink}" style="display:inline-block;background:#000;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:bold;">
              Otvoriť aplikáciu
            </a>
          </p>
        </div>
      `
    })

    if (emailResult.error) {
      return NextResponse.json(
        { error: emailResult.error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      inviteLink
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || String(err)) },
      { status: 500 }
    )
  }
}