// End-to-end IMAP test: builds one attachment of every common file type and
// emails them to the configured inbox via Gmail SMTP (same app password as
// IMAP). The running server's IMAP IDLE listener should ingest them within
// seconds. Run:  node tools/send-test-email.mjs
import nodemailer from 'nodemailer'
import * as XLSX from 'xlsx'
import { createCanvas } from '@napi-rs/canvas'
import { config } from '../src/config.js'

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

// Minimal valid PDF with an uncompressed text stream (pdf-parse reads it).
function buildPdf(title, lines) {
  let content = 'BT\n/F1 18 Tf\n72 740 Td\n(' + esc(title) + ') Tj\n/F1 12 Tf\n'
  let y = 710
  for (const line of lines) { content += `1 0 0 1 72 ${y} Tm\n(${esc(line)}) Tj\n`; y -= 22 }
  content += 'ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xrefStart = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

// Render an invoice-like image so vision/OCR has real text to read.
function buildImage(lines, type = 'image/png') {
  const canvas = createCanvas(820, 520)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 820, 520)
  ctx.fillStyle = '#111111'; ctx.font = 'bold 30px Arial'
  ctx.fillText(lines[0], 40, 70)
  ctx.font = '22px Arial'
  let y = 130
  for (const line of lines.slice(1)) { ctx.fillText(line, 40, y); y += 40 }
  return canvas.toBuffer(type)
}

function buildXlsx(rows) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Invoice')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

const stamp = Date.now()
const attachments = [
  {
    filename: `pdf-invoice-${stamp}.pdf`,
    content: buildPdf('Invoice - Stark Industries', [
      'Invoice', 'Vendor: Stark Industries', 'Client: Wayne Enterprises',
      'Invoice No: STK-PDF-001', 'Amount INR 84500', 'Date 2026-06-18', 'GSTIN 27AABCS1429B1ZP',
    ]),
  },
  {
    filename: `image-receipt-${stamp}.png`,
    content: buildImage([
      'Taxi Receipt - Uber', 'Vendor: Uber', 'Client: Wayne Enterprises',
      'Amount INR 1340', 'Date 2026-06-18', 'GSTIN 07AABCU9876C1Z3',
    ], 'image/png'),
  },
  {
    filename: `image-bill-${stamp}.jpg`,
    content: buildImage([
      'Hotel Bill - Taj', 'Vendor: Taj Hotels', 'Client: Wayne Enterprises',
      'Amount INR 19800', 'Date 2026-06-18', 'GSTIN 07AAACT2727Q1ZV',
    ], 'image/jpeg'),
  },
  {
    filename: `text-note-${stamp}.txt`,
    content: Buffer.from([
      'Purchase Order', 'Vendor: Acme Corp', 'Client: Wayne Enterprises',
      'PO No: PO-TXT-77', 'Amount INR 56000', 'Date 2026-06-18', 'GSTIN 29AACCA1234F1Z5',
    ].join('\n')),
  },
  {
    filename: `data-${stamp}.csv`,
    content: Buffer.from([
      'Type,Vendor,Client,Invoice,Amount,Date,GSTIN',
      'Invoice,Globex,Wayne Enterprises,GLB-CSV-9,73250,2026-06-18,24AACCG5678H1Z2',
    ].join('\n')),
  },
  {
    filename: `spreadsheet-${stamp}.xlsx`,
    content: buildXlsx([
      ['Invoice'],
      ['Vendor', 'Initech'],
      ['Client', 'Wayne Enterprises'],
      ['Invoice No', 'INI-XLS-12'],
      ['Amount INR', 41200],
      ['Date', '2026-06-18'],
      ['GSTIN', '06AABCI7890K1Z4'],
    ]),
  },
]

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: config.imapUser, pass: config.imapPass },
})

console.log(`Sending ${attachments.length} attachments to ${config.imapUser} ...`)
console.log('Types:', attachments.map((a) => a.filename.split('.').pop()).join(', '))
const sentAt = Date.now()
const info = await transport.sendMail({
  from: config.imapUser,
  to: config.imapUser,
  subject: `DMS IMAP file-type test ${new Date().toISOString()}`,
  text: 'Automated test: one attachment of every supported file type.',
  attachments,
})
console.log('Sent:', info.messageId, `(${Date.now() - sentAt}ms)`) 
console.log('Now watch the server log / Browse — attachments should ingest within seconds.')
process.exit(0)
