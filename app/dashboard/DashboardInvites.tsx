'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardInvites({
  invites
}: {
  invites: any[]
}) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const respond = async (inviteId: string, action: 'ACCEPT' | 'DECLINE') => {
    setMessage('')
    setLoadingId(inviteId)

    try {
      const res = await fetch('/api/group/invite/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId, action })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Nepodarilo sa spracovať pozvánku.')
        return
      }

      router.refresh()
    } catch (err: any) {
      setMessage('Chyba: ' + err.message)
    } finally {
      setLoadingId(null)
    }
  }

  if (!invites || invites.length === 0) {
    return null
  }

  return (
    <div style={styles.invitesBox}>
      <h3 style={styles.title}>Čakajúce pozvánky</h3>

      <p style={styles.text}>
        Boli ste pozvaný do skupiny. Môžete pozvánku prijať alebo odmietnuť.
      </p>

      {message && (
        <div style={styles.error}>
          {message}
        </div>
      )}

      <div style={styles.list}>
        {invites.map(invite => {
          const group = Array.isArray(invite.groups)
            ? invite.groups[0]
            : invite.groups

          const isLoading = loadingId === invite.id

          return (
            <div key={invite.id} style={styles.inviteCard}>
              <div>
                <div style={styles.groupName}>
                  {group?.name || 'Skupina bez názvu'}
                </div>

                <div style={styles.dateText}>
                  Pozvánka čaká na potvrdenie
                </div>
              </div>

              <div style={styles.actions}>
                <button
                  style={{
                    ...styles.acceptButton,
                    opacity: isLoading ? 0.65 : 1,
                    cursor: isLoading ? 'not-allowed' : 'pointer'
                  }}
                  disabled={isLoading}
                  onClick={() => respond(invite.id, 'ACCEPT')}
                >
                  Prijať
                </button>

                <button
                  style={{
                    ...styles.declineButton,
                    opacity: isLoading ? 0.65 : 1,
                    cursor: isLoading ? 'not-allowed' : 'pointer'
                  }}
                  disabled={isLoading}
                  onClick={() => respond(invite.id, 'DECLINE')}
                >
                  Odmietnuť
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  invitesBox: {
    marginTop: 20,
    background: '#56db3f',
    border: '3px solid #000',
    borderRadius: 22,
    padding: 16
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 950
  },
  text: {
    marginTop: 8,
    marginBottom: 14,
    fontSize: 16,
    fontWeight: 800
  },
  list: {
    display: 'grid',
    gap: 12
  },
  inviteCard: {
    background: '#fff',
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 14,
    alignItems: 'center'
  },
  groupName: {
    fontSize: 20,
    fontWeight: 950
  },
  dateText: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 800,
    opacity: 0.75
  },
  actions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  acceptButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 950
  },
  declineButton: {
    background: '#f25be6',
    color: '#000',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 15px',
    fontWeight: 950
  },
  error: {
    background: '#ff3b30',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 16,
    padding: 12,
    fontWeight: 900,
    marginBottom: 14
  }
}