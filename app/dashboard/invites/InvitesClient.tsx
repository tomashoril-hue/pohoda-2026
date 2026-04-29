'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function InvitesClient({ invites = [] }: { invites?: any[] }) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState('')
  const [message, setMessage] = useState('')

  const respond = async (inviteId: string, action: 'ACCEPT' | 'REJECT') => {
    setLoadingId(inviteId)
    setMessage('')

    try {
      const res = await fetch('/api/invites/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId, action })
      })

      const text = await res.text()
      let json: any = {}

      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        setMessage('Server vrátil neplatnú odpoveď.')
        return
      }

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa spracovať pozvánku.')
        return
      }

      if (action === 'ACCEPT') {
        router.push('/dashboard/group')
        return
      }

      router.refresh()
    } catch (err: any) {
      setMessage('Chyba spojenia so serverom: ' + err.message)
    } finally {
      setLoadingId('')
    }
  }

  if (!invites.length) {
    return (
      <div style={styles.emptyBox}>
        Nemáte žiadne čakajúce pozvánky.
      </div>
    )
  }

  return (
    <div style={styles.wrap}>
      {message && <div style={styles.error}>{message}</div>}

      {invites.map(invite => (
        <div key={invite.id} style={styles.inviteCard}>
          <h2 style={styles.groupName}>
            {invite.groups?.name || 'Skupina'}
          </h2>

          <p style={styles.text}>
            Boli ste pozvaný/á do tejto skupiny.
          </p>

          <div style={styles.buttons}>
            <button
              style={{
                ...styles.primaryButton,
                opacity: loadingId === invite.id ? 0.65 : 1,
                cursor: loadingId === invite.id ? 'not-allowed' : 'pointer'
              }}
              disabled={loadingId === invite.id}
              onClick={() => respond(invite.id, 'ACCEPT')}
            >
              {loadingId === invite.id ? 'Spracovávam...' : 'Prijať'}
            </button>

            <button
              style={{
                ...styles.secondaryButton,
                opacity: loadingId === invite.id ? 0.65 : 1,
                cursor: loadingId === invite.id ? 'not-allowed' : 'pointer'
              }}
              disabled={loadingId === invite.id}
              onClick={() => respond(invite.id, 'REJECT')}
            >
              Odmietnuť
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    marginTop: 24,
    display: 'grid',
    gap: 16
  },
  emptyBox: {
    marginTop: 24,
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 16,
    fontSize: 18,
    fontWeight: 800
  },
  inviteCard: {
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 20,
    padding: 18
  },
  groupName: {
    margin: 0,
    fontSize: 26,
    fontWeight: 950
  },
  text: {
    fontSize: 16,
    fontWeight: 700
  },
  buttons: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap'
  },
  primaryButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 20px',
    fontSize: 16,
    fontWeight: 900
  },
  secondaryButton: {
    background: '#fff',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '12px 20px',
    fontSize: 16,
    fontWeight: 900
  },
  error: {
    background: '#f25be6',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 14,
    fontWeight: 900
  }
}