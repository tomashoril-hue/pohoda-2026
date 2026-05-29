'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardDatePicker({
  selectedDate,
  today,
  formattedDate
}: {
  selectedDate: string
  today: string
  formattedDate: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => {
    const input = inputRef.current

    if (!input) return

    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }

    input.focus()
    input.click()
  }

  const handleChange = (value: string) => {
    if (!value) return

    router.push(value === today ? '/dashboard' : `/dashboard?datum=${value}`)
  }

  return (
    <button
      type="button"
      className="dashboard-date-picker"
      style={styles.wrap}
      onClick={openPicker}
      aria-label="Vybrat datum stravy"
    >
      {formattedDate}
      <input
        ref={inputRef}
        type="date"
        value={selectedDate}
        onChange={event => handleChange(event.target.value)}
        style={styles.input}
        aria-label="Datum stravy"
      />
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'relative',
    background: '#000',
    color: '#fff',
    border: 0,
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 900,
    fontFamily: 'Arial, Helvetica, sans-serif',
    cursor: 'pointer',
    minHeight: 34
  },
  input: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer'
  }
}
