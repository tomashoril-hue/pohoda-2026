import { supabaseServer } from '@/lib/supabaseServer'

export default async function AcceptGroupInvitePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = params.token

  let title = 'Pozvánka do skupiny'
  let message = ''
  let type: 'success' | 'error' | 'notice' = 'notice'

  if (!token) {
    title = 'Chýba token'
    message = 'Pozvánka nie je platná, pretože chýba token.'
    type = 'error'
  } else {
    const { data: invite } = await supabaseServer
      .from('group_invites')
      .select(`
        id,
        group_id,
        email,
        status,
        groups (
          name
        )
      `)
      .eq('token', token)
      .maybeSingle()

    if (!invite) {
      title = 'Pozvánka neexistuje'
      message = 'Táto pozvánka je neplatná alebo už neexistuje.'
      type = 'error'
    } else if (invite.status !== 'PENDING') {
      title = 'Pozvánka už bola použitá'
      message = 'Táto pozvánka už bola potvrdená alebo zrušená.'
      type = 'notice'
    } else {
      const { data: invitedUser } = await supabaseServer
        .from('users')
        .select('id, email, meno, priezvisko')
        .eq('email', String(invite.email).toLowerCase())
        .maybeSingle()

      if (!invitedUser) {
        title = 'Najprv je potrebná registrácia'
        message = `E-mail ${invite.email} zatiaľ nie je registrovaný. Najprv sa zaregistrujte a potom požiadajte o novú pozvánku.`
        type = 'error'
      } else {
        const { data: existingMember } = await supabaseServer
          .from('group_members')
          .select('id')
          .eq('group_id', invite.group_id)
          .eq('user_id', invitedUser.id)
          .maybeSingle()

        if (!existingMember) {
          const { error: memberError } = await supabaseServer
            .from('group_members')
            .insert({
              group_id: invite.group_id,
              user_id: invitedUser.id,
              role: 'MEMBER'
            })

          if (memberError) {
            title = 'Pozvánku sa nepodarilo potvrdiť'
            message = memberError.message
            type = 'error'
          } else {
            await supabaseServer
              .from('group_invites')
              .update({
                status: 'ACCEPTED',
                accepted_at: new Date().toISOString()
              })
              .eq('id', invite.id)

            const group = Array.isArray(invite.groups) ? invite.groups[0] : invite.groups

            title = 'Boli ste pridaný do skupiny'
            message = `Pozvánka bola potvrdená. Boli ste pridaný do skupiny ${group?.name || ''}.`
            type = 'success'
          }
        } else {
          await supabaseServer
            .from('group_invites')
            .update({
              status: 'ACCEPTED',
              accepted_at: new Date().toISOString()
            })
            .eq('id', invite.id)

          const group = Array.isArray(invite.groups) ? invite.groups[0] : invite.groups

          title = 'Už ste členom skupiny'
          message = `V skupine ${group?.name || ''} už ste členom.`
          type = 'success'
        }
      }
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.topBar}>
        <img src="/pohoda-30.svg" alt="Pohoda 30" style={styles.logo} />
        <div style={styles.date}>8. & 9. – 11. 7. 2026</div>
      </div>

      <section style={styles.card}>
        <div style={styles.badge}>Pozvánka do skupiny</div>

        <h1 style={styles.title}>{title}</h1>

        <div
          style={{
            ...styles.status,
            background:
              type === 'success'
                ? '#56db3f'
                : type === 'error'
                  ? '#ff3b30'
                  : '#f25be6',
            color: type === 'error' ? '#fff' : '#000'
          }}
        >
          {message}
        </div>

        <div style={styles.buttons}>
          <a href="/dashboard" style={styles.link}>
            <button style={styles.primaryButton}>
              Pokračovať do aplikácie
            </button>
          </a>

          <a href="/login" style={styles.link}>
            <button style={styles.secondaryButton}>
              Prihlásiť sa
            </button>
          </a>
        </div>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
    padding: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#000'
  },
  topBar: {
    maxWidth: 980,
    margin: '0 auto 24px auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20
  },
  logo: {
    height: 54,
    maxWidth: 260,
    objectFit: 'contain'
  },
  date: {
    background: '#000',
    color: '#fff',
    borderRadius: 999,
    padding: '10px 18px',
    fontWeight: 900,
    fontSize: 18
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    border: '4px solid #000',
    borderRadius: 28,
    padding: 32,
    boxShadow: '12px 12px 0 #000'
  },
  badge: {
    display: 'inline-block',
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '8px 16px',
    fontWeight: 900,
    marginBottom: 20
  },
  title: {
    fontSize: 44,
    lineHeight: 1.05,
    margin: 0,
    fontWeight: 950
  },
  status: {
    marginTop: 24,
    fontSize: 20,
    lineHeight: 1.4,
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontWeight: 900
  },
  buttons: {
    marginTop: 26,
    display: 'flex',
    justifyContent: 'center',
    gap: 14,
    flexWrap: 'wrap'
  },
  link: {
    textDecoration: 'none'
  },
  primaryButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '13px 22px',
    fontSize: 17,
    fontWeight: 900,
    cursor: 'pointer'
  },
  secondaryButton: {
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '13px 22px',
    fontSize: 17,
    fontWeight: 900,
    cursor: 'pointer'
  }
}