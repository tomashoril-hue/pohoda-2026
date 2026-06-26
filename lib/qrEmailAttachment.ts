import QRCode from 'qrcode'

function safeFilenamePart(value: string) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'qr'
}

export async function createQrPngAttachment(qrCode: string, prefix = 'qr') {
  const cleanQr = String(qrCode || '').trim()

  if (!cleanQr) return null

  const dataUrl = await QRCode.toDataURL(cleanQr, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360
  })
  const content = dataUrl.split(',')[1] || ''

  if (!content) return null

  return {
    filename: `${safeFilenamePart(prefix)}-${safeFilenamePart(cleanQr)}.png`,
    content,
    contentType: 'image/png'
  }
}
