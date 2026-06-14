import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { getCurrentUser } from '@/lib/auth'
import { slovakiaDateIso } from '@/lib/date'
import { sendAppEmail } from '@/lib/email'
import { getGlobalAccess } from '@/lib/globalRoles'
import { supabaseServer } from '@/lib/supabaseServer'

function text(value: any) {
  return String(value || '').trim()
}

function emailValue(value: any) {
  const email = text(value).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function languageValue(value: any) {
  return text(value).toUpperCase() === 'EN' ? 'EN' : 'SK'
}

function normalizePhone(value: any) {
  const raw = text(value)

  if (!raw) return ''

  let cleaned = raw.replace(/[^\d+]/g, '')

  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`
  if (!cleaned.startsWith('+') && cleaned.length === 10 && cleaned.startsWith('0')) {
    cleaned = `+421${cleaned.slice(1)}`
  }
  if (!cleaned.startsWith('+') && cleaned.length === 9) {
    cleaned = `+421${cleaned}`
  }

  return cleaned || raw
}

function xmlEscape(value: any) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function htmlEscape(value: any) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pdfText(value: any) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function pdfEscape(value: any) {
  return pdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function pdfNumber(value: number) {
  return Number(value.toFixed(2)).toString()
}

function fileSafe(value: any) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pristupove-kody'
}

function foodLabel(value: any) {
  const normalized = text(value).toUpperCase()

  if (normalized === 'MASO') return 'MASO'
  if (normalized === 'VEGE') return 'VEGE'
  if (normalized === 'DIETA' || normalized === 'DIĂ‰TA') return 'DIETA'

  return 'NEZADANE'
}

function fullName(user: any) {
  return `${text(user?.meno)} ${text(user?.priezvisko)}`.trim() || text(user?.email) || 'Bez mena'
}

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function columnToLetter(columnNumber: number) {
  let letter = ''
  let current = columnNumber

  while (current > 0) {
    const modulo = (current - 1) % 26
    letter = String.fromCharCode(65 + modulo) + letter
    current = Math.floor((current - modulo) / 26)
  }

  return letter
}

const crcTable = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }

  return value >>> 0
})

function crc32(buffer: Buffer) {
  let crc = 0xffffffff

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()

  return { dosTime, dosDate }
}

function createZip(files: Array<{ name: string; content: string | Buffer }>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const { dosTime, dosDate } = dosDateTime()

  files.forEach(file => {
    const nameBuffer = Buffer.from(file.name, 'utf8')
    const contentBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8')
    const checksum = crc32(contentBuffer)
    const localHeader = Buffer.alloc(30)

    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(contentBuffer.length, 18)
    localHeader.writeUInt32LE(contentBuffer.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuffer, contentBuffer)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(contentBuffer.length, 20)
    centralHeader.writeUInt32LE(contentBuffer.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + contentBuffer.length
  })

  const centralDirectory = Buffer.concat(centralParts)
  const localFiles = Buffer.concat(localParts)
  const endRecord = Buffer.alloc(22)

  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4)
  endRecord.writeUInt16LE(0, 6)
  endRecord.writeUInt16LE(files.length, 8)
  endRecord.writeUInt16LE(files.length, 10)
  endRecord.writeUInt32LE(centralDirectory.length, 12)
  endRecord.writeUInt32LE(localFiles.length, 16)
  endRecord.writeUInt16LE(0, 20)

  return Buffer.concat([localFiles, centralDirectory, endRecord])
}

type AccessExportRow = {
  registrationGroup: string
  meno: string
  priezvisko: string
  email: string
  telefon: string
  manager: string
  loginType: string
  accessCode: string
  loginUrl: string
}

function xlsxInlineCell(value: any, ref: string, style = 0) {
  const styleAttr = style ? ` s="${style}"` : ''

  return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${xmlEscape(value)}</t></is></c>`
}

function buildAccessCodesXlsx(rows: AccessExportRow[], language: 'SK' | 'EN') {
  const headers = language === 'EN'
    ? ['Registration group', 'First name', 'Last name', 'Email', 'Phone', 'Manager', 'Login type', 'Access code']
    : ['Registracna skupina', 'Meno', 'Priezvisko', 'Email', 'Telefon', 'Manager', 'Typ prihlasenia', 'Prihlasovaci kod']
  const sheetName = language === 'EN' ? 'Login details' : 'Pristupove kody'
  const documentTitle = language === 'EN' ? 'PohodaPass login details' : 'Pristupove kody PohodaPass'
  const allRows = [headers, ...rows.map(row => [
    row.registrationGroup,
    row.meno,
    row.priezvisko,
    row.email,
    row.telefon,
    row.manager,
    row.loginType,
    row.accessCode
  ])]
  const sheetRows = allRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnToLetter(columnIndex + 1)}${rowNumber}`

      return xlsxInlineCell(value, ref, rowIndex === 0 ? 1 : 0)
    }).join('')

    return `<row r="${rowNumber}">${cells}</row>`
  }).join('')
  const lastRow = Math.max(1, allRows.length)

  return createZip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: 'docProps/core.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(documentTitle)}</dc:title>
  <dc:creator>PohodaPass</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`
    },
    {
      name: 'docProps/app.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>PohodaPass</Application>
</Properties>`
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: 'xl/styles.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:H${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="26" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="22" customWidth="1"/>
    <col min="4" max="4" width="34" customWidth="1"/>
    <col min="5" max="5" width="18" customWidth="1"/>
    <col min="6" max="6" width="12" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:H${lastRow}"/>
</worksheet>`
    },
  ])
}

type QrPrintItem = {
  userId: string
  fullName: string
  food: string
  qrCode: string
}

function fitPdfText(value: any, maxLength: number) {
  const safe = pdfText(value)

  if (safe.length <= maxLength) return safe

  return `${safe.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function estimatePdfTextWidth(value: string, size: number) {
  return value.split('').reduce((width, char) => {
    if (char === ' ') return width + size * 0.28
    if ('ilI.,:;!|'.includes(char)) return width + size * 0.25
    if ('mwMW@#%'.includes(char)) return width + size * 0.78
    if ('0123456789'.includes(char)) return width + size * 0.56

    return width + size * 0.52
  }, 0)
}

function wrapPdfText(value: any, maxWidth: number, size: number, maxLines: number) {
  const words = pdfText(value).split(' ').filter(Boolean)
  const lines: string[] = []

  words.forEach(word => {
    const lastLine = lines[lines.length - 1] || ''
    const candidate = lastLine ? `${lastLine} ${word}` : word

    if (!lastLine || estimatePdfTextWidth(candidate, size) <= maxWidth) {
      if (lastLine) {
        lines[lines.length - 1] = candidate
      } else {
        lines.push(candidate)
      }

      return
    }

    lines.push(word)
  })

  const limited = lines.slice(0, maxLines)

  if (lines.length > maxLines && limited.length > 0) {
    let last = limited[limited.length - 1]

    while (last.length > 3 && estimatePdfTextWidth(`${last}...`, size) > maxWidth) {
      last = last.slice(0, -1).trim()
    }

    limited[limited.length - 1] = `${last}...`
  }

  return limited
}

function drawPdfText({
  commands,
  value,
  x,
  y,
  size,
  maxLength = 40,
  center = false,
  bold = false,
  color = '0 0 0'
}: {
  commands: string[]
  value: any
  x: number
  y: number
  size: number
  maxLength?: number
  center?: boolean
  bold?: boolean
  color?: string
}) {
  const safe = fitPdfText(value, maxLength)
  const estimatedWidth = estimatePdfTextWidth(safe, size)
  const textX = center ? x - estimatedWidth / 2 : x

  commands.push(`BT /${bold ? 'F2' : 'F1'} ${pdfNumber(size)} Tf ${color} rg ${pdfNumber(textX)} ${pdfNumber(y)} Td (${pdfEscape(safe)}) Tj ET`)
}

function drawPdfTextLines({
  commands,
  lines,
  x,
  y,
  size,
  lineHeight,
  center = false,
  bold = false,
  color = '0 0 0'
}: {
  commands: string[]
  lines: string[]
  x: number
  y: number
  size: number
  lineHeight: number
  center?: boolean
  bold?: boolean
  color?: string
}) {
  lines.forEach((line, index) => {
    const estimatedWidth = estimatePdfTextWidth(line, size)
    const textX = center ? x - estimatedWidth / 2 : x

    commands.push(`BT /${bold ? 'F2' : 'F1'} ${pdfNumber(size)} Tf ${color} rg ${pdfNumber(textX)} ${pdfNumber(y - index * lineHeight)} Td (${pdfEscape(line)}) Tj ET`)
  })
}

function drawQrPdf({
  commands,
  value,
  x,
  y,
  size
}: {
  commands: string[]
  value: string
  x: number
  y: number
  size: number
}) {
  const qr = QRCode.create(value, {
    errorCorrectionLevel: 'M'
  })
  const qrSize = qr.modules.size
  const quietModules = 4
  const moduleSize = size / (qrSize + quietModules * 2)
  const data = qr.modules.data

  commands.push('q 0 0 0 rg')

  for (let row = 0; row < qrSize; row += 1) {
    let col = 0

    while (col < qrSize) {
      while (col < qrSize && !data[row * qrSize + col]) col += 1

      const start = col

      while (col < qrSize && data[row * qrSize + col]) col += 1

      if (col > start) {
        const rectX = x + (quietModules + start) * moduleSize
        const rectY = y + (quietModules + qrSize - row - 1) * moduleSize
        const rectWidth = (col - start) * moduleSize

        commands.push(`${pdfNumber(rectX)} ${pdfNumber(rectY)} ${pdfNumber(rectWidth)} ${pdfNumber(moduleSize)} re f`)
      }
    }
  }

  commands.push('Q')
}

function buildQrPrintPdf({
  title,
  groupName,
  items
}: {
  title: string
  groupName: string
  items: QrPrintItem[]
}) {
  const pages = chunkItems(items, 20)
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 28.35
  const gap = 7.09
  const headerHeight = 34
  const cardWidth = (pageWidth - margin * 2 - gap * 3) / 4
  const cardHeight = (pageHeight - margin * 2 - headerHeight - gap * 4) / 5
  const qrSize = 75
  const contentStreams = pages.map((pageItems, pageIndex) => {
    const commands: string[] = []

    drawPdfText({
      commands,
      value: title,
      x: margin,
      y: pageHeight - margin - 10,
      size: 12,
      maxLength: 54,
      bold: true
    })
    drawPdfText({
      commands,
      value: `Strana ${pageIndex + 1} / ${pages.length}`,
      x: pageWidth - margin - 72,
      y: pageHeight - margin - 10,
      size: 9,
      maxLength: 18,
      color: '0.35 0.38 0.43'
    })
    const headerLineY = pageHeight - margin - headerHeight + 8
    commands.push(`q 0.9 0.9 0.92 RG 0.5 w ${pdfNumber(margin)} ${pdfNumber(headerLineY)} m ${pdfNumber(pageWidth - margin)} ${pdfNumber(headerLineY)} l S Q`)

    pageItems.forEach((item, index) => {
      const row = Math.floor(index / 4)
      const col = index % 4
      const cardX = margin + col * (cardWidth + gap)
      const cardTop = pageHeight - margin - headerHeight - row * (cardHeight + gap)
      const cardY = cardTop - cardHeight
      const qrX = cardX + (cardWidth - qrSize) / 2
      const qrY = cardTop - 10 - qrSize
      const centerX = cardX + cardWidth / 2
      const nameLines = wrapPdfText(item.fullName, cardWidth - 10, 8.5, 2)
      const groupY = qrY - 14 - nameLines.length * 10
      const foodBoxWidth = 42
      const foodBoxHeight = 12
      const foodBoxX = centerX - foodBoxWidth / 2
      const foodBoxY = cardY + 8
      const foodText = foodLabel(item.food)

      commands.push(`q 0.82 0.84 0.87 RG 0.75 w ${pdfNumber(cardX)} ${pdfNumber(cardY)} ${pdfNumber(cardWidth)} ${pdfNumber(cardHeight)} re S Q`)
      drawQrPdf({
        commands,
        value: item.qrCode,
        x: qrX,
        y: qrY,
        size: qrSize
      })
      drawPdfTextLines({
        commands,
        lines: nameLines,
        x: centerX,
        y: qrY - 14,
        size: 8.5,
        lineHeight: 10,
        center: true,
        bold: true
      })
      drawPdfText({
        commands,
        value: groupName,
        x: centerX,
        y: groupY,
        size: 7,
        maxLength: 28,
        center: true,
        color: '0.42 0.45 0.5'
      })
      commands.push(`q 0.93 0.95 1 rg ${pdfNumber(foodBoxX)} ${pdfNumber(foodBoxY)} ${pdfNumber(foodBoxWidth)} ${pdfNumber(foodBoxHeight)} re f Q`)
      drawPdfText({
        commands,
        value: foodText,
        x: foodBoxX + foodBoxWidth / 2,
        y: foodBoxY + 4,
        size: 7,
        maxLength: 8,
        center: true,
        bold: true,
        color: '0.22 0.19 0.64'
      })
    })

    return commands.join('\n')
  })
  const objects: string[] = []
  const pageRefs = contentStreams.map((_, index) => `${5 + index * 2} 0 R`)

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${contentStreams.length} >>`
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  contentStreams.forEach((stream, index) => {
    const pageObjectIndex = 4 + index * 2
    const contentObjectId = 6 + index * 2

    objects[pageObjectIndex] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(pageWidth)} ${pdfNumber(pageHeight)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    objects[pageObjectIndex + 1] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`
  })

  let pdf = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n'
  const offsets = [0]

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'binary')
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'binary')
}

async function getCurrentRegistrationGroupUserIds(registrationGroupId: string) {
  const today = slovakiaDateIso(0)

  const { data: periodRows, error: periodError } = await supabaseServer
    .from('user_registration_group_periods')
    .select('user_id')
    .eq('registration_group_id', registrationGroupId)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  if (periodError) throw periodError

  const userIds = new Set((periodRows || []).map((row: any) => row.user_id).filter(Boolean))

  const { data: fallbackUsers, error: fallbackError } = await supabaseServer
    .from('users')
    .select('id')
    .eq('registration_group_id', registrationGroupId)

  if (fallbackError) throw fallbackError

  const fallbackUserIds = (fallbackUsers || []).map((row: any) => row.id).filter(Boolean)
  const fallbackCurrentPeriods = fallbackUserIds.length > 0
    ? await supabaseServer
      .from('user_registration_group_periods')
      .select('user_id')
      .in('user_id', fallbackUserIds)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
    : { data: [], error: null }

  if (fallbackCurrentPeriods.error) throw fallbackCurrentPeriods.error

  const usersWithCurrentPeriod = new Set((fallbackCurrentPeriods.data || []).map((row: any) => row.user_id).filter(Boolean))

  fallbackUserIds.forEach((userId: string) => {
    if (!usersWithCurrentPeriod.has(userId)) userIds.add(userId)
  })

  return Array.from(userIds)
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json({ error: 'Nie si prihlaseny.' }, { status: 401 })
    }

    const access = await getGlobalAccess(currentUser.id)

    if (!access.canUsePersonalista) {
      return NextResponse.json({ error: 'Nemate opravnenie.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const recipientEmail = emailValue(body.email)
    const registrationGroupId = text(body.registrationGroupId)
    const language = languageValue(body.language)
    const defaultNote = language === 'EN'
      ? 'Hello, I am sending login details for individual users in the attachment. Please keep them safe and share them with your colleagues.'
      : 'Ahoj, v prilohe posielam prihlasovacie udaje jednotlivych uzivatelov. Dobre si ich uchovaj a poskytni ich svojim kolegom.'
    const note = text(body.note) || defaultNote
    const includeAccessCodes = body.includeAccessCodes !== false
    const includeQrCodes = body.includeQrCodes === true

    if (!recipientEmail) {
      return NextResponse.json({ error: 'Zadaj platny e-mail prijemcu.' }, { status: 400 })
    }

    if (!registrationGroupId) {
      return NextResponse.json({ error: 'Vyber registracnu skupinu.' }, { status: 400 })
    }

    if (!includeAccessCodes && !includeQrCodes) {
      return NextResponse.json({ error: 'Vyber aspon jednu prilohu.' }, { status: 400 })
    }

    const { data: group, error: groupError } = await supabaseServer
      .from('registration_groups')
      .select('id, name')
      .eq('id', registrationGroupId)
      .maybeSingle()

    if (groupError) {
      return NextResponse.json({ error: groupError.message }, { status: 500 })
    }

    const userIds = await getCurrentRegistrationGroupUserIds(registrationGroupId)
    const { data: users, error: usersError } = userIds.length > 0
      ? await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy')
        .in('id', userIds)
        .eq('aktivny', 'ANO')
      : { data: [], error: null }

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    const activeUsers = users || []
    const activeUserIds = activeUsers.map((user: any) => user.id)
    const { data: codeRows, error: codeError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_access_codes')
        .select('user_id, access_code_plain')
        .in('user_id', activeUserIds)
        .eq('active', true)
        .not('access_code_plain', 'is', null)
      : { data: [], error: null }

    if (codeError) {
      return NextResponse.json({ error: codeError.message }, { status: 500 })
    }

    const codeByUser = new Map((codeRows || []).map((row: any) => [row.user_id, row.access_code_plain]))
    const { data: qrRows, error: qrError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('user_qr_codes')
        .select('user_id, qr_code')
        .in('user_id', activeUserIds)
        .eq('active', true)
      : { data: [], error: null }

    if (qrError) {
      return NextResponse.json({ error: qrError.message }, { status: 500 })
    }

    const qrByUser = new Map((qrRows || []).map((row: any) => [row.user_id, row.qr_code]))
    const { data: managerRows, error: managerError } = activeUserIds.length > 0
      ? await supabaseServer
        .from('registration_group_managers')
        .select('user_id')
        .eq('registration_group_id', registrationGroupId)
        .eq('active', true)
        .in('user_id', activeUserIds)
      : { data: [], error: null }

    if (managerError) {
      return NextResponse.json({ error: managerError.message }, { status: 500 })
    }

    const managerUserIds = new Set((managerRows || []).map((row: any) => row.user_id).filter(Boolean))
    const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
    const loginBaseUrl = `${siteBaseUrl}/login`
    const shareUrl = new URL('/dashboard/access-codes-share', siteBaseUrl)
    shareUrl.searchParams.set('registrationGroupId', registrationGroupId)
    shareUrl.searchParams.set('language', language)
    const exportRows = activeUsers
      .map((user: any) => {
        const email = emailValue(user.email)
        const accessCode = text(codeByUser.get(user.id))
        const loginType = email
          ? (language === 'EN' ? 'Email' : 'E-mail')
          : accessCode
            ? (language === 'EN' ? 'Access code' : 'Pristupovy kod')
            : (language === 'EN' ? 'Not available' : 'Bez prihlasenia')
        const loginUrl = email
          ? `${loginBaseUrl}?method=email&email=${encodeURIComponent(email)}`
          : accessCode
            ? `${loginBaseUrl}?method=code&code=${encodeURIComponent(accessCode)}`
            : ''
        const phone = normalizePhone(user.telefon)

        return {
          registrationGroup: group?.name || '',
          meno: text(user.meno),
          priezvisko: text(user.priezvisko),
          email,
          telefon: phone,
          manager: managerUserIds.has(user.id)
            ? (language === 'EN' ? 'Yes' : 'Ano')
            : (language === 'EN' ? 'No' : 'Nie'),
          loginType,
          accessCode,
          loginUrl
        }
      })
      .sort((a, b) => `${a.priezvisko} ${a.meno}`.localeCompare(`${b.priezvisko} ${b.meno}`, 'sk'))

    if (includeAccessCodes && exportRows.length === 0) {
      return NextResponse.json({ error: 'V tejto registracnej skupine nie je ziadny aktivny clovek.' }, { status: 404 })
    }

    const qrItems = activeUsers
      .map((user: any) => ({
        userId: user.id,
        fullName: fullName(user),
        food: user.typ_stravy || '',
        qrCode: text(qrByUser.get(user.id))
      }))
      .filter(item => item.qrCode)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'sk'))

    if (includeQrCodes && qrItems.length === 0) {
      return NextResponse.json({ error: 'V tejto registracnej skupine nie je ziadny aktivny QR kod.' }, { status: 404 })
    }

    if (includeQrCodes && qrItems.length > 300) {
      return NextResponse.json({ error: 'QR prilohu posielaj po mensich skupinach, maximum je 300 QR v jednom e-maile.' }, { status: 400 })
    }

    const emailCopy = language === 'EN'
      ? {
          subject: includeQrCodes ? 'PohodaPass - login details and QR codes' : 'PohodaPass - login details',
          heading: `Login details${includeQrCodes ? ' and QR codes' : ''}`,
          attachmentIntro: 'Prepared files are attached. The Excel file contains login links. People with e-mail use e-mail login; people without e-mail use their access code.',
          loginInfo: 'The application is also available here:',
          shareIntro: 'After signing in, you can send individual login details by SMS or WhatsApp here:',
          shareButton: 'Send by SMS / WhatsApp',
          accessAttachment: `Excel login details: ${exportRows.length}`,
          qrAttachment: `QR print attachment: ${qrItems.length}`,
          qrTitle: `QR codes - ${group?.name || 'Registration group'}`
        }
      : {
          subject: includeQrCodes ? 'PohodaPass - prihlasovacie udaje a QR kody' : 'PohodaPass - prihlasovacie udaje',
          heading: `Prihlasovacie udaje${includeQrCodes ? ' a QR kody' : ''}`,
          attachmentIntro: 'V prilohe najdes pripravene subory. V Excel tabulke su prihlasovacie odkazy. Ludia s e-mailom idu cez e-mailove prihlasenie, ludia bez e-mailu cez pristupovy kod.',
          loginInfo: 'Prihlasenie je dostupne aj tu:',
          shareIntro: 'Po prihlaseni vies jednotlive pristupove udaje odoslat cez SMS alebo WhatsApp tu:',
          shareButton: 'Odoslat cez SMS / WhatsApp',
          accessAttachment: `Excel prihlasovacie udaje: ${exportRows.length}`,
          qrAttachment: `QR tlacova priloha: ${qrItems.length}`,
          qrTitle: `QR kody - ${group?.name || 'Registracna skupina'}`
        }
    const attachments = []
    const fileBase = `${fileSafe(group?.name || 'registracna-skupina')}-${new Date().toISOString().slice(0, 10)}`

    if (includeAccessCodes) {
      const xlsx = buildAccessCodesXlsx(exportRows, language)

      attachments.push({
        filename: `${fileBase}-${language === 'EN' ? 'login-details' : 'pristupove-kody'}.xlsx`,
        content: xlsx.toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
    }

    if (includeQrCodes) {
      const qrPdf = buildQrPrintPdf({
        title: emailCopy.qrTitle,
        groupName: group?.name || '',
        items: qrItems
      })

      attachments.push({
        filename: `${fileBase}-${language === 'EN' ? 'qr-codes' : 'qr-kody'}.pdf`,
        content: qrPdf.toString('base64'),
        contentType: 'application/pdf'
      })
    }

    const attachmentText = [
      includeAccessCodes ? emailCopy.accessAttachment : '',
      includeQrCodes ? emailCopy.qrAttachment : ''
    ].filter(Boolean).join(' | ')
    const result = await sendAppEmail({
      from: 'POHODA 2026 <registracia@pohodapass.sk>',
      to: recipientEmail,
      subject: emailCopy.subject,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ff;padding:24px;color:#111;">
          <div style="max-width:620px;margin:0 auto;background:#fff;border:3px solid #000;border-radius:22px;padding:24px;">
            <div style="display:inline-block;background:#56db3f;border:3px solid #000;border-radius:999px;padding:8px 14px;font-weight:900;">PohodaPass</div>
            <h1 style="font-size:26px;margin:20px 0 10px;">${htmlEscape(emailCopy.heading)}</h1>
            <p>${htmlEscape(note)}</p>
            <p>${htmlEscape(emailCopy.attachmentIntro)}</p>
            <p>${htmlEscape(emailCopy.loginInfo)} <a href="${loginBaseUrl}">${loginBaseUrl}</a></p>
            ${includeAccessCodes ? `
              <p>${htmlEscape(emailCopy.shareIntro)}</p>
              <p>
                <a href="${shareUrl.toString()}" style="display:inline-block;background:#7417e8;color:#fff;border:3px solid #000;border-radius:999px;padding:12px 18px;font-weight:900;text-decoration:none;">
                  ${htmlEscape(emailCopy.shareButton)}
                </a>
              </p>
            ` : ''}
            <p style="font-size:13px;color:#555;">${htmlEscape(attachmentText)}</p>
          </div>
        </div>
      `,
      text: `${note}\n\n${emailCopy.loginInfo} ${loginBaseUrl}${includeAccessCodes ? `\n${emailCopy.shareIntro} ${shareUrl.toString()}` : ''}\n${attachmentText}`,
      attachments
    })

    await supabaseServer.from('personnel_email_log').insert({
      email: recipientEmail,
      type: 'ACCESS_CODES_EXPORT',
      status: 'SENT',
      provider: result.provider,
      provider_message_id: result.messageId || null,
      sent_by: currentUser.id
    })

    return NextResponse.json({
      ok: true,
      sent: true,
      count: exportRows.length,
      qrCount: qrItems.length,
      attachments: attachments.map(attachment => attachment.filename)
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Neznama chyba servera.' }, { status: 500 })
  }
}
