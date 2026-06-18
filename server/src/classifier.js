import { config } from './config.js'
import {
  classify as deterministicClassify, TYPE_RULES, REQUIRED_FIELDS, FIELD_KEYS, gstinValid,
} from './pipeline.js'

// Document-intelligence classifier. Selectable LLM provider via LLM_PROVIDER:
//   - 'gemini'  : Google Gemini (GEMINI_API_KEY)
//   - 'nvidia'  : NVIDIA NIM, OpenAI-compatible (NVIDIA_API_KEY)
//   - otherwise : deterministic local classifier (offline fallback)
// Returns: type/category/retention + flat back-compat fields + structured
// per-field extraction with confidence + documentConfidence + reviewReason.
// Never throws.

const TYPE_NAMES = TYPE_RULES.map((r) => r.type)
const INVOICE_TYPES = ['Invoice', 'GST Invoice', 'Hotel Invoice', 'Purchase Order']
const RECEIPT_TYPES = ['Receipt', 'Travel Bill', 'Fuel Bill']
const CONTRACT_TYPES = ['Contract', 'MSA', 'NDA']
const HR_TYPES = ['Offer Letter', 'Experience Letter', 'HR Document']

export function classifierEngine() {
  if (config.llmProvider === 'gemini' && config.geminiApiKey) return 'gemini'
  if (config.llmProvider === 'nvidia' && config.nvidiaApiKey) return 'nvidia'
  return 'deterministic'
}

const PLACEHOLDERS = new Set(['', 'null', 'n/a', 'na', 'none', 'unknown', '-', '--', 'undefined'])
function cleanVal(v) {
  if (Array.isArray(v)) { const a = v.map(cleanVal).filter(Boolean); return a.length ? a.join(', ') : null }
  const s = (v ?? '').toString().trim()
  return PLACEHOLDERS.has(s.toLowerCase()) ? null : s
}
function toNum(v) {
  if (v == null) return null
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

function buildPrompt(text) {
  return `You are a document intelligence engine for a Document Management System.
Read the document text and respond with ONLY a JSON object (no markdown, no prose):
{
  "type": one of [${TYPE_NAMES.join(', ')}],
  "typeConfidence": 0..1,
  "client": the company the document is addressed TO (or null),
  "fields": {
     // include ONLY fields actually present; each: {"value": <v>, "confidence": 0..1}
     // invoices: vendorName, invoiceNumber, gstin, invoiceDate, dueDate, taxAmount, totalAmount, currency, cgst, sgst, igst, hsn
     // receipts/travel/fuel: merchant, date, amount, expenseCategory
     // contracts/MSA/NDA: parties, effectiveDate, expiryDate, contractType
     // HR/offer/experience: employeeName, position, salary, joiningDate
     // bank statement: bankName, accountNumber, period, closingBalance
  }
}
Rules: dates as YYYY-MM-DD; amounts as numbers; extract ONLY what is present; never guess.
Document text:
"""${String(text).slice(0, 4000)}"""`
}

function parseJsonLoose(raw) {
  if (!raw) return null
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* ignore */ } }
  return null
}

// Normalize an LLM "fields" object into { key: {value, confidence, source} }.
function normalizeFields(rawFields, source) {
  const out = {}
  if (!rawFields || typeof rawFields !== 'object') return out
  for (const key of FIELD_KEYS) {
    const f = rawFields[key]
    if (f == null) continue
    const value = typeof f === 'object' && 'value' in f ? f.value : f
    const confidence = typeof f === 'object' && f.confidence != null ? Number(f.confidence) : 0.8
    const clean = cleanVal(value)
    if (clean == null) continue
    out[key] = { value: clean, confidence: Math.min(0.99, Math.max(0.3, confidence || 0.8)), source }
  }
  return out
}

// Build a fields map from the deterministic base result (offline fallback).
function fieldsFromBase(type, base) {
  const c = base.confidence
  const f = {}
  const set = (k, v, conf = c) => { const cv = cleanVal(v); if (cv != null) f[k] = { value: cv, confidence: conf, source: 'deterministic' } }
  if (INVOICE_TYPES.includes(type)) {
    set('vendorName', base.vendor); set('totalAmount', base.amount); set('invoiceDate', base.date)
    set('gstin', base.gstin, base.gstin ? 0.7 : c)
  } else if (RECEIPT_TYPES.includes(type)) {
    set('merchant', base.vendor); set('amount', base.amount); set('date', base.date)
  } else if (CONTRACT_TYPES.includes(type)) {
    set('parties', base.vendor); set('effectiveDate', base.date)
  } else if (HR_TYPES.includes(type)) {
    set('employeeName', base.vendor); set('joiningDate', base.date)
  } else {
    set('vendorName', base.vendor); set('amount', base.amount); set('date', base.date)
  }
  return f
}

// Derive flat back-compat fields from the structured map.
function flatten(fields, base, clientVal) {
  const val = (k) => (fields[k] ? fields[k].value : null)
  const vendor = cleanVal(val('vendorName')) || cleanVal(val('merchant')) || cleanVal(val('parties')) || cleanVal(val('employeeName')) || cleanVal(val('bankName')) || cleanVal(base.vendor) || 'Unknown'
  const amount = toNum(val('totalAmount')) ?? toNum(val('amount')) ?? toNum(val('closingBalance')) ?? toNum(val('salary')) ?? base.amount
  const date = cleanVal(val('invoiceDate')) || cleanVal(val('date')) || cleanVal(val('effectiveDate')) || cleanVal(val('joiningDate')) || cleanVal(val('period')) || base.date
  const gstin = cleanVal(val('gstin')) || cleanVal(base.gstin) || null
  const client = cleanVal(clientVal) || cleanVal(base.client) || 'Unknown'
  return { vendor, amount, date, gstin, client }
}

// Validate extraction → documentConfidence + reviewReason + requiresReview.
function validate(type, fields, typeConfidence, gstin) {
  const required = REQUIRED_FIELDS[type] || []
  const missing = required.filter((k) => !fields[k] || cleanVal(fields[k].value) == null)
  const present = Object.values(fields)
  const avgFieldConf = present.length ? present.reduce((s, f) => s + (f.confidence || 0), 0) / present.length : typeConfidence
  const gstinBad = gstin != null && !gstinValid(gstin)

  let score = 0.5 * typeConfidence + 0.5 * avgFieldConf
  score -= missing.length * 0.15
  if (gstinBad) score -= 0.2
  const documentConfidence = Number(Math.min(0.99, Math.max(0.05, score)).toFixed(2))

  const reasons = []
  if (missing.length) reasons.push(`Missing: ${missing.join(', ')}`)
  if (gstinBad) reasons.push('Invalid GSTIN')
  if (documentConfidence < config.confidenceThreshold) reasons.push(`Low confidence (${documentConfidence})`)
  const requiresReview = documentConfidence < config.confidenceThreshold || missing.length > 0 || gstinBad

  return { documentConfidence, requiresReview, reviewReason: reasons.join(' · ') || null, missing, gstinBad }
}

function assemble(type, fields, typeConfidence, base, clientVal, engine) {
  const rule = TYPE_RULES.find((r) => r.type === type) || {}
  const flat = flatten(fields, base, clientVal)
  const v = validate(type, fields, typeConfidence, flat.gstin)
  return {
    type,
    category: rule.category || base.category,
    retention: rule.retention || base.retention,
    vendor: flat.vendor,
    amount: flat.amount,
    date: flat.date,
    client: flat.client,
    gstin: flat.gstin,
    confidence: Number(Math.min(0.99, Math.max(0.05, typeConfidence)).toFixed(2)),
    fields,
    documentConfidence: v.documentConfidence,
    requiresReview: v.requiresReview,
    reviewReason: v.reviewReason,
    status: v.requiresReview ? 'Needs Review' : 'Filed',
    engine,
  }
}

export async function classifyDoc(input) {
  const base = deterministicClassify(input)
  const engine = classifierEngine()

  if (engine === 'deterministic') {
    const fields = fieldsFromBase(base.type, base)
    return assemble(base.type, fields, base.confidence, base, base.client, 'deterministic')
  }

  try {
    const text = input.text || input.filename
    const llm = engine === 'gemini' ? await classifyWithGemini(text) : await classifyWithNvidia(text)
    if (!llm) {
      const fields = fieldsFromBase(base.type, base)
      return assemble(base.type, fields, base.confidence, base, base.client, 'deterministic')
    }
    const type = TYPE_NAMES.includes(llm.type) ? llm.type : base.type
    let fields = normalizeFields(llm.fields, engine)
    if (Object.keys(fields).length === 0) fields = fieldsFromBase(type, base) // LLM gave no fields
    const typeConfidence = Number(llm.typeConfidence) || base.confidence
    return assemble(type, fields, typeConfidence, base, llm.client, engine)
  } catch (err) {
    console.warn(`[classifier] ${engine} failed, using deterministic:`, err.message)
    const fields = fieldsFromBase(base.type, base)
    return assemble(base.type, fields, base.confidence, base, base.client, 'deterministic')
  }
}

async function classifyWithGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return parseJsonLoose(data?.candidates?.[0]?.content?.parts?.[0]?.text)
  } finally {
    clearTimeout(timer)
  }
}

// NVIDIA NIM — OpenAI-compatible. The nemotron reasoning model needs
// enable_thinking=true to emit its final answer in `content`.
async function classifyWithNvidia(text) {
  const url = `${config.nvidiaBaseUrl.replace(/\/$/, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.nvidiaApiKey}` },
      body: JSON.stringify({
        model: config.nvidiaModel,
        messages: [{ role: 'user', content: buildPrompt(text) }],
        temperature: 0.2, top_p: 0.95, max_tokens: 4096, stream: false,
        chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 2048,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return parseJsonLoose(data?.choices?.[0]?.message?.content)
  } finally {
    clearTimeout(timer)
  }
}
