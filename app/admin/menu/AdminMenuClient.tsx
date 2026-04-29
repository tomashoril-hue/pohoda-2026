'use client'

import { useMemo, useState } from 'react'

type MealType = 'OBED' | 'VECERA'

type Deadline = {
  id?: string
  datum: string
  typ_jedla: MealType
  deadline_at: string | null
  locked: boolean
}

export default function AdminMenuClient({
  today,
  deadlines,
}: {
  today: string
  deadlines: Deadline[]
}) {
  const [localDeadlines, setLocalDeadlines] = useState<Deadline[]>(deadlines)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const dates = useMemo(() => {
    const arr: string[] = []

    for (let i = 0; i < 7; i++) {
      const d = new Date(today + 'T12:00:00')
      d.setDate(d.getDate() + i)
      arr.push(d.toISOString().slice(0, 10))
    }

    return arr
  }, [today])

  const getFullDateLabel = (date: string) => {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString('sk-SK', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  const getDeadline = (datum: string, typ: MealType) => {
    return localDeadlines.find(
      (d) => d.datum === datum && d.typ_jedla === typ
    )
  }

  const toLocalInputValue = (iso: string | null) => {
    if (!iso) return ''

    const d = new Date(iso)
    const offset = d.getTimezoneOffset()
    const local = new Date(d.getTime() - offset * 60000)

    return local.toISOString().slice(0, 16)
  }

  const fromLocalInputValue = (value: string) => {
    if (!value) return null
    return new Date(value).toISOString()
  }

  const saveDeadline = async (
    datum: string,
    typ: MealType,
    deadlineValue: string,
    locked: boolean
  ) => {
    const key = `${datum}-${typ}`
    setSavingKey(key)
    setMessage('')

    const res = await fetch('/api/admin/menu-deadline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        datum,
        typ_jedla: typ,
        deadline_at: fromLocalInputValue(deadlineValue),
        locked,
      }),
    })

    let result: any = {}

try {
  result = await res.json()
} catch {
  setMessage('Server nevrátil platnú JSON odpoveď.')
  setSavingKey(null)
  return
}

    if (!res.ok) {
      setMessage(result.error || 'Nepodarilo sa uložiť nastavenie.')
      setSavingKey(null)
      return
    }

    setLocalDeadlines((prev) => {
      const filtered = prev.filter(
        (d) => !(d.datum === datum && d.typ_jedla === typ)
      )

      return [
        ...filtered,
        {
          datum,
          typ_jedla: typ,
          deadline_at: fromLocalInputValue(deadlineValue),
          locked,
        },
      ]
    })

    setMessage('Nastavenie bolo uložené.')
    setSavingKey(null)
  }

  const renderDeadlineCard = (datum: string, typ: MealType) => {
    const current = getDeadline(datum, typ)
    const key = `${datum}-${typ}`
    const isSaving = savingKey === key

    const defaultDeadline = (() => {
      const d = new Date(datum + 'T20:00:00')
      return d.toISOString()
    })()

    const initialInput = toLocalInputValue(current?.deadline_at || defaultDeadline)
    const locked = current?.locked || false

    return (
      <DeadlineCard
        key={key}
        datum={datum}
        typ={typ}
        initialInput={initialInput}
        initialLocked={locked}
        isSaving={isSaving}
        onSave={saveDeadline}
      />
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 24,
        background:
          'linear-gradient(135deg, #7417e8 0%, #ed59dc 45%, #56db3f 100%)',
        fontFamily: 'Arial, Helvetica, sans-serif',
        color: '#000',
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: '0 auto 20px auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <img src="/pohoda-30.svg" alt="POHODA" style={{ height: 46 }} />

        <div
          style={{
            background: '#000',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 999,
            fontWeight: 900,
            border: '3px solid #000',
          }}
        >
          ADMIN MENU
        </div>
      </div>

      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          background: '#fff',
          padding: 24,
          border: '4px solid #000',
          borderRadius: 28,
          boxShadow: '12px 12px 0 #000',
        }}
      >
        <h1
          style={{
            margin: '0 0 8px 0',
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: -1,
          }}
        >
          Uzávierky výberu jedál
        </h1>

        <p
          style={{
            margin: '0 0 20px 0',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Nastav čas, dokedy môžu ľudia meniť výber. Po zamknutí už bežný user výber nezmení.
        </p>

        {dates.map((date) => (
          <section
            key={date}
            style={{
              border: '3px solid #000',
              borderRadius: 24,
              padding: 16,
              marginBottom: 18,
              background: '#fff',
            }}
          >
            <h2
              style={{
                margin: '0 0 14px 0',
                fontSize: 24,
                fontWeight: 900,
              }}
            >
              {getFullDateLabel(date)}
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 14,
              }}
            >
              {renderDeadlineCard(date, 'OBED')}
              {renderDeadlineCard(date, 'VECERA')}
            </div>
          </section>
        ))}

        {message && (
          <div
            style={{
              marginTop: 14,
              background: message.includes('Nepodarilo') || message.includes('Nemáš')
                ? '#f25be6'
                : '#56db3f',
              border: '3px solid #000',
              borderRadius: 18,
              padding: 14,
              fontWeight: 900,
            }}
          >
            {message}
          </div>
        )}
      </div>
    </main>
  )
}

function DeadlineCard({
  datum,
  typ,
  initialInput,
  initialLocked,
  isSaving,
  onSave,
}: {
  datum: string
  typ: MealType
  initialInput: string
  initialLocked: boolean
  isSaving: boolean
  onSave: (
    datum: string,
    typ: MealType,
    deadlineValue: string,
    locked: boolean
  ) => void
}) {
  const [deadlineValue, setDeadlineValue] = useState(initialInput)
  const [locked, setLocked] = useState(initialLocked)

  return (
    <div
      style={{
        border: '3px solid #000',
        borderRadius: 22,
        padding: 16,
        background: locked ? '#f25be6' : '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
          }}
        >
          {typ === 'OBED' ? 'OBED' : 'VEČERA'}
        </div>

        <div
          style={{
            background: locked ? '#000' : '#56db3f',
            color: locked ? '#fff' : '#000',
            border: '3px solid #000',
            borderRadius: 999,
            padding: '5px 10px',
            fontWeight: 900,
            fontSize: 12,
          }}
        >
          {locked ? 'ZAMKNUTÉ' : 'OTVORENÉ'}
        </div>
      </div>

      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 900,
          marginBottom: 6,
        }}
      >
        Uzávierka
      </label>

      <input
        type="datetime-local"
        value={deadlineValue}
        onChange={(e) => setDeadlineValue(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          border: '3px solid #000',
          borderRadius: 18,
          padding: '15px 17px',
          fontWeight: 700,
          fontSize: 15,
          marginBottom: 12,
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      />

      <button
  type="button"
  onClick={() => {
    const nextLocked = !locked
    setLocked(nextLocked)
    onSave(datum, typ, deadlineValue, nextLocked)
  }}
        style={{
          width: '100%',
          border: '3px solid #000',
          borderRadius: 999,
          padding: '13px 16px',
          fontWeight: 900,
          background: locked ? '#fff' : '#f25be6',
          color: '#000',
          cursor: 'pointer',
          marginBottom: 10,
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      >
        {locked ? 'Odomknúť výber' : 'Zamknúť výber'}
      </button>

      <button
        type="button"
        disabled={isSaving}
        onClick={() => onSave(datum, typ, deadlineValue, locked)}
        style={{
          width: '100%',
          border: '3px solid #000',
          borderRadius: 999,
          padding: '13px 16px',
          fontWeight: 900,
          background: '#000',
          color: '#fff',
          cursor: isSaving ? 'wait' : 'pointer',
          fontFamily: 'Arial, Helvetica, sans-serif',
        }}
      >
        {isSaving ? 'Ukladám...' : 'Uložiť nastavenie'}
      </button>
    </div>
  )
}