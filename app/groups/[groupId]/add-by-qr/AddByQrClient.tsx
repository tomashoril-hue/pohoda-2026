'use client'

import { BrowserQRCodeReader } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'

type ScanItem = {
  code: string
  status: 'ADDED' | 'EXISTS' | 'ERROR'
  message: string
  name?: string
  email?: string
  time: string
}

export default function AddByQrClient({
  groupId,
  groupName,
}: {
  groupId: string
  groupName: string
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const lastScanRef = useRef<string>('')
  const lastScanTimeRef = useRef<number>(0)

  const [qr, setQr] = useState('')
  const [message, setMessage] = useState('Zapínam kameru...')
  const [history, setHistory] = useState<ScanItem[]>([])
  const [loading, setLoading] = useState(false)
  const [cameraRunning, setCameraRunning] = useState(false)

  const nowLabel = () => {
    return new Date().toLocaleTimeString('sk-SK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const addToHistory = (item: ScanItem) => {
    setHistory((prev) => [item, ...prev].slice(0, 20))
  }

  const addMember = async (code: string) => {
    const clean = code.trim()

    if (!clean || loading) return

    const now = Date.now()

    if (
      lastScanRef.current === clean &&
      now - lastScanTimeRef.current < 2500
    ) {
      return
    }

    lastScanRef.current = clean
    lastScanTimeRef.current = now

    setLoading(true)
    setMessage('Pridávam člena...')

    const res = await fetch('/api/groups/add-member-by-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: groupId,
        qr_code: clean,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      const errorMessage = result.error || 'Nepodarilo sa pridať člena.'

      setMessage(errorMessage)
      addToHistory({
        code: clean,
        status: 'ERROR',
        message: errorMessage,
        time: nowLabel(),
      })

      setQr('')
      setLoading(false)
      return
    }

    const name = result.member?.fullName || clean
const email = result.member?.email || ''

setMessage(result.message || 'Člen bol pridaný do skupiny.')

addToHistory({
  code: clean,
  status: result.status === 'EXISTS' ? 'EXISTS' : 'ADDED',
  message: result.message || 'Člen bol pridaný do skupiny.',
  name,
  email,
  time: nowLabel(),
})

    setQr('')
    setLoading(false)
  }

  useEffect(() => {
    let controls: { stop: () => void } | null = null
    let cancelled = false

    const startCamera = async () => {
      try {
        const reader = new BrowserQRCodeReader()
        readerRef.current = reader

        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          async (result) => {
            if (cancelled) return

            const text = result?.getText()

            if (text) {
              await addMember(text)
            }
          }
        )

        setCameraRunning(true)
        setMessage('Kamera je zapnutá. Naskenuj QR kód člena.')
      } catch (err: any) {
        setCameraRunning(false)
        setMessage(
          err?.message ||
            'Kamera sa nepodarila zapnúť. Skontroluj povolenie kamery.'
        )
      }
    }

    if (videoRef.current) {
      startCamera()
    }

    return () => {
      cancelled = true

      if (controls) {
        controls.stop()
      }
    }
  }, [])

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
          QR SKUPINA
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
          Pridať člena cez QR
        </h1>

        <p
          style={{
            margin: '0 0 18px 0',
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Skupina: <strong>{groupName}</strong>
        </p>

        <div
          style={{
            border: '4px solid #000',
            borderRadius: 24,
            overflow: 'hidden',
            background: '#000',
            marginBottom: 16,
            position: 'relative',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{
              width: '100%',
              minHeight: 280,
              maxHeight: 420,
              objectFit: 'cover',
              display: 'block',
            }}
          />

          <div
            style={{
              position: 'absolute',
              inset: 30,
              border: '4px solid #56db3f',
              borderRadius: 22,
              pointerEvents: 'none',
              boxShadow: '0 0 0 999px rgba(0,0,0,0.25)',
            }}
          />
        </div>

        <div
          style={{
            background: cameraRunning ? '#56db3f' : '#f25be6',
            border: '3px solid #000',
            borderRadius: 18,
            padding: 14,
            fontWeight: 900,
            marginBottom: 16,
          }}
        >
          {message}
        </div>

        <input
          value={qr}
          onChange={(e) => setQr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addMember(qr)
            }
          }}
          placeholder="Alebo vlož / načítaj QR kód ručne"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '3px solid #000',
            borderRadius: 18,
            padding: '15px 17px',
            fontWeight: 900,
            fontSize: 18,
            marginBottom: 14,
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        />

        <button
          type="button"
          disabled={loading}
          onClick={() => addMember(qr)}
          style={{
            width: '100%',
            border: '3px solid #000',
            borderRadius: 999,
            padding: '15px 18px',
            fontWeight: 900,
            fontSize: 16,
            background: '#000',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          {loading ? 'Pridávam...' : 'Pridať ručne'}
        </button>

        <div
          style={{
            marginTop: 22,
            border: '3px solid #000',
            borderRadius: 22,
            padding: 16,
            background: '#fff',
          }}
        >
          <h2
            style={{
              margin: '0 0 12px 0',
              fontSize: 22,
              fontWeight: 900,
            }}
          >
            Posledné skeny
          </h2>

          {history.length === 0 ? (
            <div
              style={{
                background: '#f25be6',
                border: '3px solid #000',
                borderRadius: 18,
                padding: 14,
                fontWeight: 900,
              }}
            >
              Zatiaľ nebol pridaný žiadny člen.
            </div>
          ) : (
            history.map((item, index) => (
              <div
                key={`${item.code}-${item.time}-${index}`}
                style={{
                  padding: 12,
                  border: '3px solid #000',
                  borderRadius: 18,
                  marginBottom: 10,
                  background:
  item.status === 'ADDED'
    ? '#56db3f'
    : item.status === 'EXISTS'
      ? '#fff'
      : '#f25be6',
                  fontWeight: 900,
                }}
              >
                <div>
                  {item.status === 'ADDED' ? '✅' : item.status === 'EXISTS' ? 'ℹ️' : '❌'} {item.message}

{item.name && (
  <div style={{ fontSize: 18, marginTop: 6 }}>
    {item.name}
  </div>
)}

{item.email && (
  <div style={{ fontSize: 13, marginTop: 4 }}>
    {item.email}
  </div>
)}
        
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  QR: {item.code}
                </div>
                <div style={{ fontSize: 13 }}>
                  Čas: {item.time}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}