'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SentInvites({
  invites
}: {
  invites: any[]
}) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const cancelInvite = async (inviteId: string) => {
    if (!confirm('Naozaj chcete zrušiť túto pozvánku?')) return

    setMessage('')
    setLoadingId(inviteId)

    try {
      const res = await fetch('/api/group/invite/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId })
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setMessage(json.error || 'Pozvánku sa nepodarilo zrušiť.')
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
    <div style={styles.box}>
      <h2 style={styles.title}>Odoslané pozvánky</h2>

      <p style={styles.text}>
        Tieto pozvánky čakajú na potvrdenie.
      </p>

      {message && (
        <div style={styles.error}>
          {message}
        </div>
      )}

      <div style={styles.list}>
        {invites.map(invite => {
          const isLoading = loadingId === invite.id

          return (
            <div key={invite.id} style={styles.inviteCard}>
              <div style={styles.inviteInfo}>
                <div style={styles.email}>
                  {invite.email}
                </div>

                <div style={styles.status}>
                  Čaká na potvrdenie
                </div>
              </div>

              <button
                style={{
                  ...styles.cancelButton,
                  opacity: isLoading ? 0.65 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer'
                }}
                disabled={isLoading}
                onClick={() => cancelInvite(invite.id)}
              >
                {isLoading ? 'Ruším...' : 'Zrušiť'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 24,
    padding: 18,
    border: '3px solid #000',
    borderRadius: 20,
    background: '#fff'
  },
  title: {
    margin: '0 0 8px',
    fontSize: 24,
    fontWeight: 900
  },
  text: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 16
  },
  list: {
    display: 'grid',
    gap: 12
  },
  inviteCard: {
    border: '3px solid #000',
    borderRadius: 18,
    padding: 14,
    background: '#f25be6',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 12,
    alignItems: 'center'
  },
  inviteInfo: {
    minWidth: 0
  },
  email: {
    fontSize: 17,
    fontWeight: 950,
    overflowWrap: 'anywhere'
  },
  status: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: 800,
    opacity: 0.78
  },
  cancelButton: {
    background: '#000',
    color: '#fff',
    border: '3px solid #000',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 900,
    whiteSpace: 'nowrap'
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