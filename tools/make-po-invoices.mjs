// Generates 10 Purchase Orders + 10 matching Invoices as plain-ASCII PDFs and
// bundles them into a single zip. Each invoice references its originating PO
// (same vendor, line items, GSTIN) so the DMS pipeline classifies them as
// "Purchase Order" / "Invoice" and links them by PO number.
//
// The PDF text lives in an UNCOMPRESSED content stream, so the backend OCR stub
// (buf.toString) can read vendor / amount / date / GSTIN directly — exercising
// real classification, metadata extraction, dedup, and retention.
//
//   node tools/make-po-invoices.mjs
//
// Output: samples/po-invoices/*.pdf  and  samples/po-invoices.zip
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(__dirname, '..', 'samples', 'po-invoices')
const zipPath = path.resolve(__dirname, '..', 'samples', 'po-invoices.zip')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// ---- PDF builder (uncompressed, ASCII-readable text) ----------------------
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdf(title, lines) {
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

// ---- Valid GSTIN generator (15 chars, mod-36 check digit) -----------------
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function gstinCheckDigit(first14) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(first14[i])
    const f = i % 2 === 0 ? 1 : 2
    const p = v * f
    sum += Math.floor(p / 36) + (p % 36)
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]
}
function makeGstin(stateCode, pan) {
  const first14 = `${stateCode}${pan}1Z`
  return first14 + gstinCheckDigit(first14)
}

// Plain digits (no grouping commas) so the DMS deterministic amount extractor,
// which needs 2+ consecutive digits after the currency keyword, parses cleanly.
const fmt = (n) => String(n)

// ---- Source data: 10 vendors / orders -------------------------------------
const ORDERS = [
  { vendor: 'Globex Ltd',          state: '27', pan: 'AABCG1234D', item: 'Industrial sensors (50 units)',     qty: 50,  rate: 1800 },
  { vendor: 'Acme Corp',           state: '29', pan: 'AAACA5678E', item: 'Steel fasteners (2000 units)',       qty: 2000, rate: 12 },
  { vendor: 'Initech',             state: '09', pan: 'AAACI3322M', item: 'Enterprise software licenses (25)',  qty: 25,  rate: 4200 },
  { vendor: 'Umbrella Supplies',   state: '07', pan: 'AABCU9012F', item: 'PPE safety kits (300 units)',        qty: 300, rate: 350 },
  { vendor: 'Stark Industries',    state: '24', pan: 'AABCS3456G', item: 'Aluminium sheets (120 units)',       qty: 120, rate: 2750 },
  { vendor: 'Wayne Enterprises',   state: '06', pan: 'AABCW7890H', item: 'Fleet maintenance contract',         qty: 1,   rate: 185000 },
  { vendor: 'Hooli Technologies',  state: '29', pan: 'AABCH2345J', item: 'Cloud compute credits (annual)',     qty: 1,   rate: 96000 },
  { vendor: 'Soylent Foods',       state: '33', pan: 'AABCS6789K', item: 'Office pantry supplies (qtr)',       qty: 1,   rate: 42500 },
  { vendor: 'Cyberdyne Systems',   state: '36', pan: 'AABCC1230L', item: 'Server rack units (8 units)',        qty: 8,   rate: 31250 },
  { vendor: 'Vandelay Imports',    state: '19', pan: 'AABCV4567N', item: 'Packaging cartons (5000 units)',     qty: 5000, rate: 9 },
]

const CLIENT = 'FlowSphere'
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const files = []

ORDERS.forEach((o, i) => {
  const n = i + 1
  const poNo = `PO-2026-${String(1000 + n)}`
  const invNo = `INV-2026-${String(5000 + n)}`
  const gstin = makeGstin(o.state, o.pan)
  const subtotal = o.qty * o.rate
  const gst = Math.round(subtotal * 0.18)
  const total = subtotal + gst

  const poMonth = String(((i) % 6) + 1).padStart(2, '0')
  const poDate = `2026-${poMonth}-05`
  const invDate = `2026-${poMonth}-19`
  const dueDate = `2026-${String(((i) % 6) + 2).padStart(2, '0')}-19`

  // --- Purchase Order ---
  const poFile = `po-${String(n).padStart(2, '0')}-${slug(o.vendor)}.pdf`
  files.push([poFile, buildPdf(`Purchase Order ${poNo}`, [
    'Purchase Order',
    `PO Number: ${poNo}`,
    `Vendor: ${o.vendor}`,
    `Client: ${CLIENT}`,
    `GSTIN ${gstin}`,
    `Date ${poDate}`,
    `Item: ${o.item}`,
    `Quantity: ${o.qty}  Rate: INR ${fmt(o.rate)}`,
    `Subtotal INR ${fmt(subtotal)}`,
    `GST 18% INR ${fmt(gst)}`,
    `Amount INR ${fmt(total)}`,
    'Payment terms: Net 14 days',
  ])])

  // --- Invoice (references the PO) ---
  const invFile = `invoice-${String(n).padStart(2, '0')}-${slug(o.vendor)}.pdf`
  files.push([invFile, buildPdf(`Tax Invoice ${invNo}`, [
    'Invoice',
    `Invoice No: ${invNo}`,
    `Against PO Number: ${poNo}`,
    `Vendor: ${o.vendor}`,
    `Bill To Client: ${CLIENT}`,
    `GSTIN ${gstin}`,
    `Invoice Date ${invDate}`,
    `Due Date ${dueDate}`,
    `Item: ${o.item}`,
    `Subtotal INR ${fmt(subtotal)}`,
    `GST 18% INR ${fmt(gst)}`,
    `Amount INR ${fmt(total)}`,
  ])])
})

for (const [name, buf] of files) {
  fs.writeFileSync(path.join(outDir, name), buf)
  console.log(`  ${name}  (${buf.length} bytes)`)
}

// ---- Minimal ZIP writer (DEFLATE, no external deps) -----------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function buildZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const comp = zlib.deflateRawSync(data)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))

    offset += local.length + nameBuf.length + comp.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, end])
}

const zipBuf = buildZip(files.map(([name, buf]) => [name, buf]))
fs.writeFileSync(zipPath, zipBuf)

console.log(`\nGenerated ${files.length} PDFs (10 POs + 10 invoices) in ${outDir}`)
console.log(`Bundled into ${zipPath}  (${zipBuf.length} bytes)`)
