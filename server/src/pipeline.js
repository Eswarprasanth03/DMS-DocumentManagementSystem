import crypto from 'node:crypto'
import { config } from './config.js'
import { store, newId, nowIso } from './store.js'

// ---------------------------------------------------------------------------
// Deterministic document-intelligence pipeline.
// Mirrors the guide's pipeline (OCR -> classify -> auto-name -> metadata ->
// dedup -> embed) but uses deterministic local heuristics + hashing as the
// documented fallback, so it works offline with no LLM/OCR services.
// ---------------------------------------------------------------------------

const TYPE_RULES = [
  // Travel & expenses (categories Taxi/Hotel/Meals power trip detection)
  { type: 'Taxi Receipt', category: 'Taxi', retention: '3yr', keywords: ['taxi', 'cab', 'ola', 'uber', 'ride', 'rapido'] },
  { type: 'Hotel Invoice', category: 'Hotel', retention: '5yr', keywords: ['hotel', 'taj', 'marriott', 'oyo', 'stay', 'inn', 'resort', 'lodging'] },
  { type: 'Meal Bill', category: 'Meals', retention: '3yr', keywords: ['meal', 'restaurant', 'canteen', 'cafe', 'food', 'dining'] },
  { type: 'Travel Bill', category: 'Travel', retention: '3yr', keywords: ['flight', 'airline', 'train', 'irctc', 'boarding', 'ticket', 'travel'] },
  { type: 'Fuel Bill', category: 'Fuel', retention: '3yr', keywords: ['fuel', 'petrol', 'diesel', 'gas station', 'hpcl', 'iocl', 'bpcl'] },
  // Financial
  { type: 'GST Invoice', category: 'Invoices', retention: '8yr', keywords: ['gstin', 'hsn', 'cgst', 'sgst', 'igst', 'tax invoice'] },
  { type: 'Invoice', category: 'Invoices', retention: '8yr', keywords: ['invoice', 'inv', 'bill to', 'invoice no'] },
  { type: 'Receipt', category: 'Receipts', retention: '3yr', keywords: ['receipt', 'rcpt', 'paid', 'received'] },
  { type: 'Purchase Order', category: 'Purchase Orders', retention: '5yr', keywords: ['purchase order', 'po number', 'po no'] },
  { type: 'Goods Receipt', category: 'Goods Receipts', retention: '8yr', keywords: ['goods receipt', 'grn', 'gr no', 'received goods', 'delivery note', 'delivery challan', 'goods received note'] },
  { type: 'Bank Statement', category: 'Bank', retention: '8yr', keywords: ['bank', 'statement', 'stmt', 'account number', 'closing balance', 'ifsc'] },
  { type: 'GST Return', category: 'Tax', retention: '8yr', keywords: ['gstr', 'gst return', 'return period'] },
  // Legal
  { type: 'MSA', category: 'Contracts', retention: 'permanent', keywords: ['master service agreement', 'msa'] },
  { type: 'NDA', category: 'Contracts', retention: 'permanent', keywords: ['nda', 'non-disclosure', 'nondisclosure', 'confidential'] },
  { type: 'Contract', category: 'Contracts', retention: 'permanent', keywords: ['contract', 'agreement', 'sow', 'terms'] },
  // HR
  { type: 'Offer Letter', category: 'HR', retention: '7yr', keywords: ['offer letter', 'we are pleased to offer', 'ctc', 'designation'] },
  { type: 'Experience Letter', category: 'HR', retention: '7yr', keywords: ['experience letter', 'relieving', 'to whomsoever', 'served as'] },
  { type: 'HR Document', category: 'HR', retention: '7yr', keywords: ['employee', 'payslip', 'salary slip', 'appraisal', 'hr'] },
  // Compliance & other
  { type: 'Compliance Document', category: 'Compliance', retention: '8yr', keywords: ['compliance', 'iso', 'soc 2', 'audit', 'policy', 'certificate'] },
  { type: 'Miscellaneous', category: 'Misc', retention: '3yr', keywords: [] },
]

// Required fields per type (for validation + review routing).
const REQUIRED_FIELDS = {
  Invoice: ['vendorName', 'totalAmount', 'invoiceDate'],
  'GST Invoice': ['vendorName', 'gstin', 'totalAmount', 'invoiceDate'],
  Receipt: ['merchant', 'amount', 'date'],
  'Travel Bill': ['merchant', 'amount', 'date'],
  'Hotel Invoice': ['vendorName', 'totalAmount', 'invoiceDate'],
  'Fuel Bill': ['merchant', 'amount', 'date'],
  'Purchase Order': ['vendorName', 'totalAmount'],
  'Goods Receipt': ['vendorName', 'date'],
  'Bank Statement': ['bankName'],
  'GST Return': ['gstin'],
  Contract: ['parties'],
  MSA: ['parties'],
  NDA: ['parties'],
  'Offer Letter': ['employeeName'],
  'Experience Letter': ['employeeName'],
  'HR Document': ['employeeName'],
  'Compliance Document': [],
  Miscellaneous: [],
}

// All field keys the extractor may populate (per-type schema superset).
const FIELD_KEYS = [
  'vendorName', 'invoiceNumber', 'gstin', 'invoiceDate', 'dueDate', 'taxAmount',
  'totalAmount', 'currency', 'cgst', 'sgst', 'igst', 'hsn',
  'merchant', 'date', 'amount', 'expenseCategory',
  'parties', 'effectiveDate', 'expiryDate', 'contractType',
  'employeeName', 'position', 'salary', 'joiningDate',
  'bankName', 'accountNumber', 'period', 'closingBalance',
]

export { REQUIRED_FIELDS, FIELD_KEYS }

// GSTIN format + checksum validation (15 chars, mod-36 check digit).
export function gstinValid(g) {
  const s = String(g || '').toUpperCase().trim()
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(s)) return false
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(s[i])
    const f = i % 2 === 0 ? 1 : 2
    const p = v * f
    sum += Math.floor(p / 36) + (p % 36)
  }
  const check = (36 - (sum % 36)) % 36
  return chars[check] === s[14]
}

const VENDOR_HINTS = {
  ola: 'Ola Cabs', uber: 'Uber', taj: 'Taj Hotels', marriott: 'Marriott',
  oyo: 'OYO Rooms', canteen: 'The Bombay Canteen', globex: 'Globex Ltd',
  acme: 'Acme Corp', initech: 'Initech',
}

const RETENTION_YEARS = { '3yr': 3, '5yr': 5, '7yr': 7, '8yr': 8, 'active+3yr': 3, permanent: null }

function tokenize(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

// Stable pseudo-randomness derived from text so results are reproducible.
function seededUnit(text) {
  const h = crypto.createHash('sha256').update(text).digest()
  return h.readUInt32BE(0) / 0xffffffff
}

export function classify({ filename, text = '', hintType, hintVendor, hintAmount, hintDate, hintClient }) {
  const haystack = `${filename} ${text}`.toLowerCase()
  const tokens = new Set(tokenize(haystack))

  let best = null
  let bestScore = 0
  for (const rule of TYPE_RULES) {
    const hits = rule.keywords.filter((k) => tokens.has(k) || haystack.includes(k)).length
    const score = hits / rule.keywords.length
    if (hits > 0 && score >= bestScore) {
      bestScore = score
      best = rule
    }
  }
  if (hintType) {
    const forced = TYPE_RULES.find((r) => r.type === hintType)
    if (forced) { best = forced; bestScore = Math.max(bestScore, 0.6) }
  }
  if (!best) best = TYPE_RULES.find((r) => r.type === 'Receipt')

  // Confidence: keyword strength + deterministic jitter, clamped.
  const jitter = (seededUnit(haystack) - 0.5) * 0.12
  let confidence = Math.min(0.99, Math.max(0.35, 0.6 + bestScore * 0.38 + jitter))
  if (hintType) confidence = Math.min(0.99, confidence + 0.1)
  confidence = Number(confidence.toFixed(2))

  // Never invent vendor/client/gstin — surface 'Unknown'/null when not found.
  const vendor = hintVendor || detectVendor(haystack) || 'Unknown'
  const amount = hintAmount != null ? Number(hintAmount) : detectAmount(haystack)
  const date = hintDate || detectDate(haystack) || nowIso().slice(0, 10)
  const client = hintClient || detectClient(haystack) || 'Unknown'
  const gstin = detectGstin(haystack) || null

  return {
    type: best.type,
    category: best.category,
    retention: best.retention,
    vendor,
    amount,
    date,
    client,
    gstin,
    confidence,
    status: confidence < config.confidenceThreshold ? 'Needs Review' : 'Filed',
  }
}

function detectVendor(text) {
  for (const [k, v] of Object.entries(VENDOR_HINTS)) if (text.includes(k)) return v
  return null
}
function detectClient(text) {
  if (text.includes('globex')) return 'Globex Ltd'
  if (text.includes('initech')) return 'Initech'
  if (text.includes('acme')) return 'Acme Corp'
  return null
}
function detectAmount(text) {
  // Only accept amounts qualified by a currency / amount keyword, so we never
  // pick up unrelated numbers (dates, GSTINs, PDF structural coordinates, etc.).
  const m = text.match(/(?:amount|total|inr|rs\.?|₹)\s*[:\-]?\s*([0-9]{2,8}(?:\.[0-9]{1,2})?)/i)
  if (m) {
    const val = Number(m[1])
    if (val >= 10 && val <= 99999999) return Math.round(val)
  }
  return null
}
function detectDate(text) {
  const iso = text.match(/(20[12][0-9])[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12][0-9]|3[01])/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}
function detectGstin(text) {
  const m = text.match(/\b[0-9]{2}[a-z]{5}[0-9]{4}[a-z][0-9a-z]{3}\b/i)
  return m ? m[0].toUpperCase() : null
}

export function autoName({ type, vendor, date, seq, ext = 'pdf' }) {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
  const t = slug(type)
  const v = slug(vendor) || 'vendor'
  const n = String(seq).padStart(4, '0')
  const e = String(ext || 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'
  return `${t}-${v}-INV-${n}.${e}`
}

// Department inferred from the document category (slide 04 metadata field).
const CATEGORY_DEPARTMENT = {
  Taxi: 'Finance', Hotel: 'Finance', Meals: 'Finance', Travel: 'Finance',
  Fuel: 'Finance', Invoices: 'Finance', Receipts: 'Finance', Bank: 'Finance',
  Tax: 'Finance', Contracts: 'Legal', 'Purchase Orders': 'Procurement',
  'Goods Receipts': 'Procurement', HR: 'HR', Compliance: 'Compliance', Misc: 'General',
}
export function departmentFor(category) {
  return CATEGORY_DEPARTMENT[category] || 'General'
}

// Relationship type: owned / shared / bonded (slide 04).
export function relationshipFor(doc) {
  if (doc.bonded || doc.retention === 'permanent') return 'bonded'
  return 'owned'
}

export function buildMetadata(c) {
  const tags = [
    { k: 'type', v: c.type, source: 'AI' },
    { k: 'vendor', v: c.vendor, source: 'AI' },
    { k: 'date', v: c.date, source: 'AI' },
    { k: 'client', v: c.client, source: 'AI' },
    { k: 'category', v: c.category, source: 'AI' },
    { k: 'department', v: c.department || departmentFor(c.category), source: 'AI' },
    { k: 'retention', v: c.retention, source: 'AI' },
    { k: 'relationship', v: c.relationship || (c.retention === 'permanent' ? 'bonded' : 'owned'), source: 'AI' },
    { k: 'gstin', v: c.gstin, source: 'AI' },
    { k: 'confidence', v: String(c.confidence), source: 'AI' },
  ]
  if (c.amount != null) tags.splice(2, 0, { k: 'amount', v: `₹${c.amount.toLocaleString('en-IN')}`, source: 'AI' })
  return tags
}

function normVendor(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Duplicate detection. Catches:
//  1. Exact same bytes (sha-256 checksum) — same file re-uploaded.
//  2. Near-duplicate of the SAME document with different bytes (e.g. a re-scan):
//     same amount + same date + a fuzzy vendor match (case/spacing/substring),
//     which absorbs OCR/casing variations like "OLA CABS" vs "Ola Cabs".
export function findDuplicate({ checksum, vendor, amount, date }, excludeId) {
  const v = normVendor(vendor)
  return store.all('documents').find((d) => {
    if (d.id === excludeId || d.tombstone) return false
    if (checksum && d.checksum && d.checksum === checksum) return true
    if (amount == null || !date) return false
    if (d.amount !== amount || d.date !== date) return false
    const dv = normVendor(d.vendor)
    if (!v || !dv) return false
    return v === dv || v.includes(dv) || dv.includes(v)
  })
}

export function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// ---- Embeddings: deterministic local hashing -> fixed vector --------------
const EMBED_DIM = 64
export function embed(text) {
  const vec = new Array(EMBED_DIM).fill(0)
  for (const tok of tokenize(text)) {
    const h = crypto.createHash('md5').update(tok).digest()
    const idx = h.readUInt16BE(0) % EMBED_DIM
    const sign = h[2] % 2 === 0 ? 1 : -1
    vec[idx] += sign
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1
  return vec.map((x) => x / norm)
}

export function cosine(a, b) {
  if (!a || !b) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// Sensitive categories are restricted by role; documents inherit folder perms.
export const CATEGORY_ROLES = {
  Contracts: ['Admin', 'Manager'],
  Tax: ['Admin', 'Manager'],
  Bank: ['Admin', 'Manager'],
  HR: ['Admin', 'Manager'],
}

// ---- Folder auto-creation: Client -> Year -> [Trip] -> Category -----------
export function ensureFolderPath({ client, year, category, trip }) {
  const path = [
    { name: client, type: 'client' },
    { name: String(year), type: 'year' },
  ]
  if (trip) path.push({ name: `Trip · ${trip}`, type: 'trip' })
  path.push({ name: category, type: 'category', allowedRoles: CATEGORY_ROLES[category] || null })

  let parentId = null
  let lastId = null
  for (const seg of path) {
    let node = store.find('folders', (f) => f.name === seg.name && f.parentId === parentId)
    if (!node) {
      node = store.insert('folders', { name: seg.name, type: seg.type, parentId, allowedRoles: seg.allowedRoles || null })
    }
    parentId = node.id
    lastId = node.id
  }
  return lastId
}

// Folder -> file permission inheritance. A document is visible to a role if the
// nearest ancestor folder that declares allowedRoles permits it (Admin always).
export function folderAllowsRole(folderId, role) {
  if (role === 'Admin') return true
  let cur = folderId ? store.findById('folders', folderId) : null
  while (cur) {
    if (Array.isArray(cur.allowedRoles)) return cur.allowedRoles.includes(role)
    cur = cur.parentId ? store.findById('folders', cur.parentId) : null
  }
  return true
}

// Prune a folder tree to only branches a role may see.
export function visibleFolderTree(role) {
  const all = store.all('folders')
  const build = (pid) =>
    all
      .filter((f) => (f.parentId || null) === (pid || null))
      .map((f) => ({ ...f, children: build(f.id) }))
      .filter((f) => folderAllowsRole(f.id, role) || f.children.length)
  return build(null)
}

export function folderTree() {
  const all = store.all('folders')
  const byParent = (pid) =>
    all
      .filter((f) => (f.parentId || null) === (pid || null))
      .map((f) => ({ ...f, children: byParent(f.id) }))
  return byParent(null)
}

export function folderPath(folderId) {
  const trail = []
  let cur = store.findById('folders', folderId)
  while (cur) {
    trail.unshift(cur)
    cur = cur.parentId ? store.findById('folders', cur.parentId) : null
  }
  return trail
}

// ---- Retention engine -----------------------------------------------------
export function retentionStatus(doc) {
  if (doc.retention === 'permanent' || doc.bonded) {
    return { status: 'Permanent', expiresAt: null, expiresInDays: null }
  }
  const years = RETENTION_YEARS[doc.retention] ?? 3
  const base = new Date(doc.date || doc.createdAt)
  // Guard against invalid/missing dates so retention math never throws.
  if (Number.isNaN(base.getTime())) {
    return { status: doc.archived ? 'Archived' : 'Active', expiresAt: null, expiresInDays: null }
  }
  const expiresAt = new Date(base)
  expiresAt.setFullYear(expiresAt.getFullYear() + years)
  if (Number.isNaN(expiresAt.getTime())) {
    return { status: doc.archived ? 'Archived' : 'Active', expiresAt: null, expiresInDays: null }
  }
  const days = Math.round((expiresAt - new Date()) / 86400000)
  let status = 'Active'
  if (days < 0) status = 'Expired'
  else if (days <= config.retention.warnT90) status = 'Expiring'
  if (doc.archived) status = 'Archived'
  return { status, expiresAt: expiresAt.toISOString().slice(0, 10), expiresInDays: days }
}

// Recompute retention state for all docs; returns counts. Run by scheduler.
export function runRetentionSweep() {
  let expiring = 0, expired = 0
  for (const d of store.all('documents')) {
    const r = retentionStatus(d)
    if (r.status === 'Expiring') expiring++
    if (r.status === 'Expired') expired++
    if (d.retentionState !== r.status) {
      store.update('documents', d.id, { retentionState: r.status, expiresAt: r.expiresAt })
    }
  }
  return { expiring, expired, sweptAt: nowIso() }
}

// ---- Trip detection: taxi + hotel within the configured window ------------
export function detectTrips() {
  const docs = store.all('documents').filter((d) => !d.duplicate)
  const created = []
  const byClient = {}
  for (const d of docs) {
    ;(byClient[d.client] ||= []).push(d)
  }
  for (const [client, list] of Object.entries(byClient)) {
    const taxis = list.filter((d) => d.category === 'Taxi')
    const hotels = list.filter((d) => d.category === 'Hotel')
    for (const taxi of taxis) {
      for (const hotel of hotels) {
        const dt = Math.abs(new Date(taxi.date) - new Date(hotel.date)) / 3600000
        if (dt <= config.tripWindowHours) {
          const members = list.filter(
            (d) => Math.abs(new Date(d.date) - new Date(hotel.date)) / 3600000 <= config.tripWindowHours &&
              ['Taxi', 'Hotel', 'Meals'].includes(d.category),
          )
          const docIds = [...new Set(members.map((m) => m.id))]
          const signature = docIds.slice().sort().join(',')
          if (store.find('trips', (t) => t.signature === signature)) continue
          const dates = members.map((m) => new Date(m.date))
          const min = new Date(Math.min(...dates))
          const max = new Date(Math.max(...dates))
          const signals = [...new Set(members.map((m) => m.category.toLowerCase().replace('meals', 'meal')))]
          const trip = store.insert('trips', {
            name: `${client.split(' ')[0]} Trip`,
            client,
            window: `${min.toISOString().slice(0, 10)} → ${max.toISOString().slice(0, 10)}`,
            status: 'Pending',
            documents: docIds,
            total: members.reduce((s, m) => s + (m.amount || 0), 0),
            signals,
            detectedWithin: `${Math.round(dt)}h`,
            signature,
          })
          created.push(trip)
        }
      }
    }
  }
  return created
}

export { RETENTION_YEARS, TYPE_RULES }
