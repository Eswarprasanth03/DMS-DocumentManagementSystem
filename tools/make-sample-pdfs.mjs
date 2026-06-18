// Generates small, valid PDF files for testing the DMS upload pipeline.
// The text is written in an UNCOMPRESSED content stream, so the visible text is
// also readable as plain ASCII inside the file — which means the backend's OCR
// stub (buf.toString) extracts vendor / amount / date / GSTIN, exercising real
// classification, metadata extraction, dedup, trips and retention assignment.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, '..', 'samples')
fs.mkdirSync(outDir, { recursive: true })

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdf(title, lines) {
  // Content stream: title bold-ish (bigger), then body lines.
  let content = 'BT\n/F1 18 Tf\n72 740 Td\n(' + esc(title) + ') Tj\n/F1 12 Tf\n'
  let y = 710
  for (const line of lines) {
    content += `1 0 0 1 72 ${y} Tm\n(${esc(line)}) Tj\n`
    y -= 22
  }
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
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

// A fresh scenario (Initech · Delhi trip) that does NOT collide with the seeded
// demo data, so uploads file as new documents and auto-form a new trip. One
// intentional duplicate and one low-confidence scan demonstrate dedup + review.
const SAMPLES = [
  {
    file: 'taxi-uber-delhi.pdf',
    title: 'Uber - Taxi Receipt',
    lines: ['Vendor: Uber', 'Client: Initech', 'City: Delhi', 'Amount INR 1290', 'Date 2026-06-20', 'GSTIN 07AABCU9876C1Z3', 'Trip: taxi ride'],
  },
  {
    file: 'hotel-marriott-delhi.pdf',
    title: 'Marriott - Hotel Bill',
    lines: ['Vendor: Marriott', 'Client: Initech', 'City: Delhi', 'Amount INR 22400', 'Date 2026-06-21', 'GSTIN 07AAACM5544K1Z8', 'hotel stay 2 nights'],
  },
  {
    file: 'meal-canteen-delhi.pdf',
    title: 'The Bombay Canteen - Meal Bill',
    lines: ['Vendor: The Bombay Canteen', 'Client: Initech', 'restaurant food dining', 'Amount INR 1850', 'Date 2026-06-21', 'GSTIN 07AAFCT1122H1Z6'],
  },
  {
    file: 'invoice-initech.pdf',
    title: 'Invoice - Initech',
    lines: ['Invoice', 'Vendor: Initech', 'Client: Initech', 'Amount INR 64000', 'Date 2026-06-02', 'GSTIN 09AAACI3322M1Z1'],
  },
  {
    file: 'contract-initech-nda.pdf',
    title: 'Non-Disclosure Agreement - Contract',
    lines: ['NDA Contract confidential agreement', 'Client: Initech', 'Parties: Initech and FlowSphere', 'Date 2026-02-10', 'Retention: permanent'],
  },
  {
    file: 'gst-return-initech.pdf',
    title: 'GST Return - GSTR',
    lines: ['GST Return GSTR filing', 'Client: Initech', 'Date 2026-04-30', 'GSTIN 09AAACI3322M1Z1'],
  },
  {
    file: 'taxi-uber-delhi-DUPLICATE.pdf',
    title: 'Uber - Taxi Receipt',
    lines: ['Vendor: Uber', 'Client: Initech', 'City: Delhi', 'Amount INR 1290', 'Date 2026-06-20', 'GSTIN 07AABCU9876C1Z3', 'Trip: taxi ride'],
  },
  {
    file: 'scan-unknown-note.pdf',
    title: 'Scanned Note',
    lines: ['miscellaneous scanned document', 'reference note', 'Date 2026-06-09', 'Client: Initech'],
  },
]

for (const s of SAMPLES) {
  const buf = buildPdf(s.title, s.lines)
  fs.writeFileSync(path.join(outDir, s.file), buf)
  console.log(`  ${s.file}  (${buf.length} bytes)`)
}
console.log(`\nGenerated ${SAMPLES.length} PDFs in ${outDir}`)
