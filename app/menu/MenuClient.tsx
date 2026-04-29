'use client'

import { useEffect, useMemo, useState } from 'react'

type MealType = 'OBED' | 'VECERA'
type Variant = 'MASO' | 'VEGE'

type MenuItem = {
  id: string
  datum: string
  typ_jedla: MealType
  varianta: Variant
  nazov: string
  popis: string | null
}

type Selection = {
  user_id: string
  datum: string
  typ_jedla: MealType
  volba: Variant
}

type Deadline = {
  datum: string
  typ_jedla: MealType
  deadline_at: string | null
  locked: boolean
}

type DeadlineState = {
  locked: boolean
  blockedByAdmin: boolean
  closedByTime: boolean
  deadlineText: string
  countdown: string
  showCountdown: boolean
  danger: boolean
  label: string
}

export default function MenuClient({
  userId,
  today,
  menu,
  selections,
  deadlines,
}: {
  userId: string
  today: string
  menu: MenuItem[]
  selections: Selection[]
  deadlines: Deadline[]
}) {
  const [selectedDate, setSelectedDate] = useState(today)
  const [localSelections, setLocalSelections] = useState<Selection[]>(selections)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState<number | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const dates = useMemo(() => {
    return Array.from(new Set(menu.map((m) => m.datum)))
  }, [menu])

  const emptyDeadlineState = (): DeadlineState => ({
    locked: false,
    blockedByAdmin: false,
    closedByTime: false,
    deadlineText: '',
    countdown: '',
    showCountdown: false,
    danger: false,
    label: '',
  })

  const getSelected = (datum: string, typ: MealType) => {
    return (
      localSelections.find((s) => s.datum === datum && s.typ_jedla === typ)
        ?.volba || null
    )
  }

  const formatDateLabel = (date: string) => {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString('sk-SK', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    })
  }

  const formatFullDate = (date: string) => {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString('sk-SK', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatDeadline = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const getDeadlineState = (datum: string, typ: MealType): DeadlineState => {
    // Dôležité: pred mountom nič nezamykáme vizuálne,
    // aby nevznikol hydration mismatch medzi serverom a browserom.
    // Reálnu ochranu stále robí API /api/menu/select.
    if (!mounted) {
      return emptyDeadlineState()
    }

    const deadline = deadlines.find(
      (d) => d.datum === datum && d.typ_jedla === typ
    )

    if (!deadline) {
      return emptyDeadlineState()
    }

    if (deadline.locked) {
      return {
        locked: true,
        blockedByAdmin: true,
        closedByTime: false,
        deadlineText: formatDeadline(deadline.deadline_at),
        countdown: '',
        showCountdown: false,
        danger: false,
        label: 'BLOKOVANÉ',
      }
    }

    if (deadline.deadline_at && now !== null) {
      const diff = new Date(deadline.deadline_at).getTime() - now

      if (diff <= 0) {
        return {
          locked: true,
          blockedByAdmin: false,
          closedByTime: true,
          deadlineText: formatDeadline(deadline.deadline_at),
          countdown: '',
          showCountdown: false,
          danger: false,
          label: 'UZATVORENÉ',
        }
      }

      return {
        locked: false,
        blockedByAdmin: false,
        closedByTime: false,
        deadlineText: formatDeadline(deadline.deadline_at),
        countdown: diff <= 60 * 60 * 1000 ? formatCountdown(diff) : '',
        showCountdown: diff <= 60 * 60 * 1000,
        danger: diff <= 5 * 60 * 1000,
        label: 'OTVORENÉ',
      }
    }

    return {
      locked: false,
      blockedByAdmin: false,
      closedByTime: false,
      deadlineText: formatDeadline(deadline.deadline_at),
      countdown: '',
      showCountdown: false,
      danger: false,
      label: '',
    }
  }

  const handleSelect = async (datum: string, typ: MealType, volba: Variant) => {
    const state = getDeadlineState(datum, typ)

    if (state.locked) {
      setMessage(state.label)
      return
    }

    const key = `${datum}-${typ}`
    setSavingKey(key)
    setMessage('')

    const res = await fetch('/api/menu/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum, typ_jedla: typ, volba }),
    })

    let result: any = {}

    try {
      result = await res.json()
    } catch {
      setMessage('Server nevrátil platnú odpoveď.')
      setSavingKey(null)
      return
    }

    if (!res.ok) {
      setMessage(result.error || 'Nepodarilo sa uložiť výber.')
      setSavingKey(null)
      return
    }

    setLocalSelections((prev) => {
      const filtered = prev.filter(
        (s) => !(s.datum === datum && s.typ_jedla === typ)
      )

      return [
        ...filtered,
        {
          user_id: userId,
          datum,
          typ_jedla: typ,
          volba,
        },
      ]
    })

    setMessage('Výber bol uložený.')
    setSavingKey(null)
  }

  const renderMealSection = (typ: MealType) => {
    const items = menu.filter(
      (m) => m.datum === selectedDate && m.typ_jedla === typ
    )

    const selected = getSelected(selectedDate, typ)
    const isSaving = savingKey === `${selectedDate}-${typ}`
    const state = getDeadlineState(selectedDate, typ)

    return (
      <section
        style={{
          border: '3px solid #000',
          borderRadius: 24,
          padding: 16,
          marginBottom: 18,
          background: state.locked ? '#e8e8e8' : '#fff',
          opacity: state.locked ? 0.88 : 1,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
            marginBottom: 14,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 900,
              }}
            >
              {typ === 'OBED' ? 'OBED' : 'VEČERA'}
            </h2>

            {state.deadlineText && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  fontWeight: 900,
                }}
              >
                Uzávierka: {state.deadlineText}
              </div>
            )}
          </div>

          <div
            className={state.danger ? 'deadline-blink' : ''}
            style={{
              background: state.locked
                ? '#000'
                : state.danger
                  ? '#ff2b2b'
                  : state.showCountdown
                    ? '#f25be6'
                    : selected
                      ? '#56db3f'
                      : '#f25be6',
              color: state.locked || state.danger ? '#fff' : '#000',
              border: '3px solid #000',
              borderRadius: 999,
              padding: '7px 13px',
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
              minWidth: 130,
            }}
          >
            {state.locked
              ? state.label
              : state.showCountdown
                ? `UZÁVIERKA ${state.countdown}`
                : selected
                  ? `Vybrané: ${selected}`
                  : 'Nevybraté'}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
          }}
        >
          {items.map((item) => {
            const active = selected === item.varianta

            return (
              <button
                key={item.id}
                onClick={() => handleSelect(selectedDate, typ, item.varianta)}
                disabled={isSaving || state.locked}
                style={{
                  textAlign: 'left',
                  minHeight: 150,
                  padding: 18,
                  border: '3px solid #000',
                  borderRadius: 22,
                  background: active ? '#56db3f' : '#fff',
                  boxShadow: active && !state.locked ? '6px 6px 0 #000' : 'none',
                  cursor: state.locked ? 'not-allowed' : isSaving ? 'wait' : 'pointer',
                  opacity: state.locked && !active ? 0.45 : 1,
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  filter: state.locked && !active ? 'grayscale(1)' : 'none',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    background: item.varianta === 'MASO' ? '#000' : '#f25be6',
                    color: '#fff',
                    border: '3px solid #000',
                    borderRadius: 999,
                    padding: '5px 12px',
                    fontSize: 13,
                    fontWeight: 900,
                    marginBottom: 12,
                  }}
                >
                  {item.varianta}
                </div>

                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    color: '#000',
                    marginBottom: 8,
                  }}
                >
                  {item.nazov}
                </div>

                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    color: '#000',
                  }}
                >
                  {item.popis || 'Bez popisu'}
                </div>

                {active && (
                  <div
                    style={{
                      marginTop: 14,
                      fontWeight: 900,
                      fontSize: 14,
                    }}
                  >
                    ✓ Toto máš vybrané
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </section>
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
      <style>
        {`
          @keyframes deadlinePulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }

          .deadline-blink {
            animation: deadlinePulse 0.7s infinite;
          }
        `}
      </style>

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
          {formatFullDate(selectedDate)}
        </div>
      </div>

      <div
        style={{
          maxWidth: 760,
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
          }}
        >
          Výber stravy
        </h1>

        <p
          style={{
            margin: '0 0 20px 0',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Vyber si jedlo na každý deň. Po uzávierke už výber nebude možné meniť.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 12,
            marginBottom: 18,
          }}
        >
          {dates.map((date) => {
            const active = date === selectedDate

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                style={{
                  flex: '0 0 auto',
                  padding: '12px 16px',
                  border: '3px solid #000',
                  borderRadius: 999,
                  background: active ? '#000' : '#fff',
                  color: active ? '#fff' : '#000',
                  fontWeight: 900,
                  cursor: 'pointer',
                  fontFamily: 'Arial, Helvetica, sans-serif',
                }}
              >
                {formatDateLabel(date)}
              </button>
            )
          })}
        </div>

        {renderMealSection('OBED')}
        {renderMealSection('VECERA')}

        {message && (
          <div
            style={{
              marginTop: 14,
              background:
                message.includes('Nepodarilo') ||
                message.includes('UZATVORENÉ') ||
                message.includes('BLOKOVANÉ') ||
                message.includes('uzamknutý') ||
                message.includes('vypršal') ||
                message.includes('Server')
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