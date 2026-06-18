import express from 'express'
import multer from 'multer'
import { config } from './config.js'
import { store, nowIso } from './store.js'
import * as storage from './storage.js'
import {
  authRequired, requirePerm, signToken, verifyPassword, sanitizeUser, can,
} from './auth.js'
import { audit, ipOf, verifyChain } from './audit.js'
import {
  folderPath, retentionStatus, runRetentionSweep,
  detectTrips, RETENTION_YEARS, folderAllowsRole, visibleFolderTree, TYPE_RULES,
} from './pipeline.js'
import { ingestBuffer } from './ingest.js'
import { channelStatus } from './watchers.js'
import { mimeForName } from './mime.js'
import { embedQuery, embedPassages, cosine as embCosine, embeddingModel } from './embeddings.js'
import { notify } from './notify.js'

const router = express.Router()

// ---- file upload (kept in memory, then persisted via the storage layer) ----
// Accepts ANY file type; only a generous size cap is enforced.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

// ---- serializers -----------------------------------------------------------
function serializeDoc(d) {
  if (!d) return null
  // Strip internal-only fields (vectors, full search text) from output.
  const { embedding, semanticEmbedding, searchText, ...rest } = d
  const r = retentionStatus(d)
  return { ...rest, retentionState: r.status, expiresAt: r.expiresAt, expiresInDays: r.expiresInDays }
}

// The editable fields captured in each version snapshot, so any version can be
// fully restored on rollback.
const EDITABLE = ['type', 'vendor', 'amount', 'date', 'client', 'category', 'retention', 'tags', 'status']
function snapshotOf(doc) {
  const snap = {}
  for (const k of EDITABLE) snap[k] = doc[k]
  return snap
}

// Correction naming: {document_type}_{vendor}_{invoice_number}_{date}.{ext}
// — unknown/empty segments become 'unknown'.
function correctionName(doc) {
  const slug = (s) => {
    const v = String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return v || 'unknown'
  }
  const ext = (doc.name || '').includes('.') ? doc.name.toLowerCase().split('.').pop() : 'pdf'
  return `${slug(doc.type)}_${slug(doc.vendor)}_${slug(doc.invoiceNumber)}_${slug(doc.date)}.${ext}`
}


// ===========================================================================
// AUTH
// ===========================================================================
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const user = store.find('users', (u) => u.email === String(email).toLowerCase())
  // Demo build: accept any password for seeded users, but still validate hash if present.
  const ok = user && (verifyPassword(password, user.passwordHash) || password === 'demo')
  if (!user || !ok) return res.status(401).json({ error: 'Invalid credentials' })
  const token = signToken(user)
  audit({ user, action: 'login', detail: `signed in as ${user.role}`, ip: ipOf(req) })
  res.json({ token, user: sanitizeUser(user) })
})

router.get('/auth/me', authRequired, (req, res) => {
  const user = store.findById('users', req.user.id)
  res.json({ user: sanitizeUser(user) })
})

router.get('/users', authRequired, requirePerm('settings'), (req, res) => {
  res.json({ users: store.all('users').map(sanitizeUser) })
})

// ===========================================================================
// STATS (dashboard)
// ===========================================================================
router.get('/stats', authRequired, (req, res) => {
  const docs = store.all('documents')
  const needsReview = docs.filter((d) => d.status === 'Needs Review').length
  const duplicates = docs.filter((d) => d.duplicate).length
  const classified = docs.filter((d) => !d.duplicate)
  const avgConf = classified.length
    ? classified.reduce((s, d) => s + (d.confidence || 0), 0) / classified.length
    : 0
  const retention = docs.map((d) => retentionStatus(d))
  const expiring = retention.filter((r) => r.status === 'Expiring').length
  const expired = retention.filter((r) => r.status === 'Expired').length
  res.json({
    documents: docs.length,
    autoClassifiedPct: docs.length ? Math.round((classified.length / docs.length) * 1000) / 10 : 0,
    avgConfidence: Math.round(avgConf * 100) / 100,
    needsReview,
    duplicates,
    expiring,
    expired,
    trips: store.all('trips').length,
  })
})

// ===========================================================================
// FOLDERS
// ===========================================================================
router.get('/folders', authRequired, requirePerm('browse'), (req, res) => {
  res.json({ tree: visibleFolderTree(req.user.role) })
})

// Live ingest channel status (manual, API, hot-folder, scanner, email).
router.get('/channels', authRequired, requirePerm('upload'), (req, res) => {
  res.json({ channels: channelStatus() })
})
router.get('/folders/:id/path', authRequired, requirePerm('browse'), (req, res) => {
  res.json({ path: folderPath(req.params.id) })
})

// ===========================================================================
// DOCUMENTS
// ===========================================================================
router.get('/documents', authRequired, requirePerm('browse'), (req, res) => {
  const { folderId, status } = req.query
  let docs = store.all('documents')
  if (folderId) docs = docs.filter((d) => d.folderId === folderId)
  if (status) docs = docs.filter((d) => d.status === status)
  // Folder -> file permission inheritance.
  docs = docs.filter((d) => folderAllowsRole(d.folderId, req.user.role))
  res.json({ documents: docs.map(serializeDoc) })
})

// Manual review queue (low-confidence / failed-validation documents).
// Defined before '/documents/:id' so the literal path isn't captured as an id.
router.get('/documents/review-queue', authRequired, requirePerm('review'), (req, res) => {
  const items = store.all('documents')
    .filter((d) => !d.tombstone && d.status === 'Needs Review' && folderAllowsRole(d.folderId, req.user.role))
    .sort((a, b) => (a.documentConfidence ?? 1) - (b.documentConfidence ?? 1))
  res.json({ documents: items.map(serializeDoc), count: items.length })
})

// Possible duplicates: pairs of (duplicate, original it matched).
// (Defined before '/documents/:id' so the literal path isn't captured as an id.)
router.get('/documents/duplicates', authRequired, requirePerm('upload'), (req, res) => {
  const pairs = store.all('documents')
    .filter((d) => d.duplicate && !d.tombstone && folderAllowsRole(d.folderId, req.user.role))
    .map((d) => {
      const original = d.duplicateOf ? store.findById('documents', d.duplicateOf) : null
      return {
        duplicate: serializeDoc(d),
        original: original && !original.tombstone ? serializeDoc(original) : null,
        diff: original ? diffFields(d, original) : [],
      }
    })
  res.json({ pairs, count: pairs.length })
})

// Trash — soft-deleted documents still within the recovery window.
router.get('/documents/trash', authRequired, requirePerm('upload'), (req, res) => {
  const items = store.all('documents')
    .filter((d) => d.deletedAt && folderAllowsRole(d.folderId, req.user.role))
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
    .map((d) => {
      const ageDays = Math.floor((Date.now() - new Date(d.deletedAt)) / 86400000)
      return { ...serializeDoc(d), deletedAt: d.deletedAt, deletedBy: d.deletedBy, deleteReason: d.deleteReason, daysLeft: Math.max(0, 30 - ageDays) }
    })
  res.json({ items, count: items.length })
})

router.get('/documents/:id', authRequired, requirePerm('browse'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (!folderAllowsRole(doc.folderId, req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: your role cannot access this folder' })
  }
  audit({ user: req.user, action: 'view', doc: doc.name, docId: doc.id, detail: 'Opened document', ip: ipOf(req) })
  res.json({ document: serializeDoc(doc) })
})

// OCR + extraction result for a document.
router.get('/documents/:id/ocr', authRequired, requirePerm('browse'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (!folderAllowsRole(doc.folderId, req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: your role cannot access this folder' })
  }
  res.json({
    text: doc.searchText || '',
    ocrEngine: doc.ocrEngine || null,
    classifier: doc.classifier || null,
    fields: doc.fields || {},
    documentConfidence: doc.documentConfidence ?? doc.confidence,
    reviewReason: doc.reviewReason || null,
  })
})

// Re-run OCR + classification + extraction on the stored file (e.g. new model).
router.post('/documents/:id/reprocess', authRequired, requirePerm('upload'), async (req, res, next) => {
  try {
    const doc = store.findById('documents', req.params.id)
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (!doc.storageKey) return res.status(409).json({ error: 'No stored file to reprocess' })
    const buffer = await storage.getFile(doc.storageKey)
    if (!buffer) return res.status(404).json({ error: 'File missing on storage' })
    const { ocrExtract } = await import('./ocr.js')
    const { classifyDoc } = await import('./classifier.js')
    const { text: ocrText } = await ocrExtract(buffer, doc.originalName || doc.name)
    const c = await classifyDoc({ filename: doc.originalName || doc.name, text: `${doc.name} ${ocrText}` })
    const patch = {
      type: c.type, category: c.category, retention: c.retention,
      vendor: c.vendor, amount: c.amount, date: c.date, client: c.client, gstin: c.gstin,
      confidence: c.confidence, fields: c.fields || {},
      documentConfidence: c.documentConfidence, reviewReason: c.reviewReason,
      classifier: c.engine, status: doc.bonded ? doc.status : c.status,
      version: (doc.version || 1) + 1,
    }
    const updated = store.update('documents', doc.id, patch)
    store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.update('versions', v.id, { current: false }))
    store.insert('versions', { docId: doc.id, v: patch.version, author: req.user.name, note: `Reprocessed (${c.engine})`, current: true, ts: nowIso(), snapshot: snapshotOf(updated) })
    audit({ user: req.user, action: 'classify', doc: doc.name, docId: doc.id, detail: `Reprocessed → ${c.type} (${c.documentConfidence})`, ip: ipOf(req) })
    res.json({ document: serializeDoc(updated) })
  } catch (err) {
    next(err)
  }
})

// Approve a reviewed document (optionally applying corrections).
router.patch('/documents/:id/approve', authRequired, requirePerm('review'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const before = {}
  const patch = { status: 'Filed', reviewReason: null, documentConfidence: 1 }
  for (const key of ['type', 'vendor', 'amount', 'date', 'client', 'gstin', 'category', 'retention']) {
    if (key in (req.body || {})) { before[key] = doc[key]; patch[key] = req.body[key] }
  }
  const newVersion = (doc.version || 1) + 1
  patch.version = newVersion
  const updated = store.update('documents', doc.id, patch)
  store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.update('versions', v.id, { current: false }))
  store.insert('versions', { docId: doc.id, v: newVersion, author: req.user.name, note: 'Approved in review', current: true, ts: nowIso(), snapshot: snapshotOf(updated) })
  audit({ user: req.user, action: 'review', doc: doc.name, docId: doc.id, detail: 'Approved' + (Object.keys(before).length ? ` with corrections (${Object.keys(before).join(', ')})` : ''), before, after: patch, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// Reject a reviewed document.
router.patch('/documents/:id/reject', authRequired, requirePerm('review'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const reason = (req.body && req.body.reason) || 'Rejected in review'
  const updated = store.update('documents', doc.id, { status: 'Rejected', reviewReason: reason })
  audit({ user: req.user, action: 'review', doc: doc.name, docId: doc.id, detail: `Rejected: ${reason}`, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// FEATURE 1 — Admin metadata correction for failed/incomplete classifications.
// Applies corrected fields, renames the file per convention, marks the document
// "Manually Verified", and records before/after in the audit trail.
const CORRECTABLE = ['type', 'vendor', 'client', 'invoiceNumber', 'date', 'amount', 'currency', 'department', 'category', 'retention', 'tags']
router.patch('/documents/:id/correct', authRequired, requirePerm('review'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })

  const body = req.body || {}
  const before = {}
  const patch = {}
  for (const key of CORRECTABLE) {
    if (key in body) { before[key] = doc[key] ?? null; patch[key] = body[key] }
  }
  // Keep the structured fields map in sync with the corrected flat values.
  const fields = { ...(doc.fields || {}) }
  const fieldMap = { vendor: 'vendorName', client: 'client', invoiceNumber: 'invoiceNumber', date: 'invoiceDate', amount: 'totalAmount' }
  for (const [flat, fk] of Object.entries(fieldMap)) {
    if (flat in body && body[flat] != null && body[flat] !== '') {
      fields[fk] = { value: body[flat], confidence: 1, source: 'manual' }
    }
  }
  patch.fields = fields
  patch.custom = body.custom && typeof body.custom === 'object' ? body.custom : (doc.custom || {})

  const merged = { ...doc, ...patch }
  patch.name = correctionName(merged) // rename per convention with corrected values
  patch.mimeType = mimeForName(patch.name)
  patch.status = 'Filed'
  patch.reviewReason = null
  patch.documentConfidence = 1
  patch.manuallyVerified = { by: req.user.name, userId: req.user.id, at: nowIso() }
  const newVersion = (doc.version || 1) + 1
  patch.version = newVersion

  const updated = store.update('documents', doc.id, patch)
  store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.update('versions', v.id, { current: false }))
  store.insert('versions', { docId: doc.id, v: newVersion, author: req.user.name, note: 'Manually verified (corrected)', current: true, ts: nowIso(), snapshot: snapshotOf(updated) })
  audit({ user: req.user, action: 'edit', doc: updated.name, docId: doc.id, detail: `Manually verified${Object.keys(before).length ? ` — corrected ${Object.keys(before).join(', ')}` : ''}; renamed → ${updated.name}`, before, after: patch, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// ===========================================================================
// FEATURE 2 — Duplicate detection & admin management
// ===========================================================================
function diffFields(a, b) {
  const keys = ['type', 'vendor', 'client', 'invoiceNumber', 'date', 'amount', 'currency', 'gstin', 'department']
  return keys.filter((k) => (a[k] ?? null) !== (b[k] ?? null))
}

// Dismiss a duplicate flag (documents are legitimately different).
router.post('/documents/:id/dismiss-duplicate', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const updated = store.update('documents', doc.id, {
    duplicate: false, duplicateOf: null, status: doc.status === 'Duplicate' ? 'Filed' : doc.status,
  })
  audit({ user: req.user, action: 'edit', doc: doc.name, docId: doc.id, detail: 'Dismissed duplicate flag (legitimately different)', ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// Merge metadata from a source duplicate into a retained target, then soft-delete source.
router.post('/documents/:id/merge', authRequired, requirePerm('upload'), (req, res) => {
  const target = store.findById('documents', req.params.id)
  const source = store.findById('documents', req.body?.sourceId)
  if (!target || !source) return res.status(404).json({ error: 'Document(s) not found' })
  // Fill any empty/Unknown target fields from the source (more complete wins).
  const patch = {}
  const before = {}
  const isEmpty = (v) => v == null || v === '' || v === 'Unknown'
  for (const k of ['vendor', 'client', 'invoiceNumber', 'date', 'amount', 'currency', 'gstin', 'department']) {
    if (isEmpty(target[k]) && !isEmpty(source[k])) { before[k] = target[k] ?? null; patch[k] = source[k] }
  }
  let updated = target
  if (Object.keys(patch).length) {
    const newVersion = (target.version || 1) + 1
    patch.version = newVersion
    updated = store.update('documents', target.id, patch)
    store.all('versions', (v) => v.docId === target.id).forEach((v) => store.update('versions', v.id, { current: false }))
    store.insert('versions', { docId: target.id, v: newVersion, author: req.user.name, note: 'Merged metadata from duplicate', current: true, ts: nowIso(), snapshot: snapshotOf(updated) })
  }
  // Soft-delete the source as a duplicate, retaining the target.
  store.update('documents', source.id, { status: 'Deleted', tombstone: true, deletedAt: nowIso(), deletedBy: req.user.name, deleteReason: 'Duplicate', retainedId: target.id })
  audit({ user: req.user, action: 'edit', doc: target.name, docId: target.id, detail: `Merged metadata from duplicate ${source.name} (${Object.keys(patch).filter((k) => k !== 'version').join(', ') || 'no gaps'})`, before, after: patch, ip: ipOf(req) })
  audit({ user: req.user, action: 'delete', doc: source.name, docId: source.id, detail: `Soft-deleted as duplicate; retained ${target.name}`, ip: ipOf(req) })
  if (source.uploadedBy) notify({ to: source.uploadedBy, tone: 'warning', title: 'Your document was merged as a duplicate', detail: `${source.name} → kept ${target.name}`, docId: target.id })
  res.json({ document: serializeDoc(updated) })
})

// Soft delete (30-day recovery) with a required reason; notifies the uploader.
const DELETE_REASONS = ['Duplicate', 'Incorrect Upload', 'Other']
router.post('/documents/:id/soft-delete', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (doc.bonded && req.user.role !== 'Admin') return res.status(409).json({ error: 'Bonded document — admin required', requires: '2-admin' })
  const reason = (req.body?.reason || '').trim()
  if (!DELETE_REASONS.includes(reason)) return res.status(400).json({ error: `reason required (one of: ${DELETE_REASONS.join(', ')})` })
  const retainedId = req.body?.retainedId || null
  store.update('documents', doc.id, { status: 'Deleted', tombstone: true, deletedAt: nowIso(), deletedBy: req.user.name, deleteReason: reason, retainedId })
  const retained = retainedId ? store.findById('documents', retainedId) : null
  audit({ user: req.user, action: 'delete', doc: doc.name, docId: doc.id, detail: `Soft-deleted (${reason})${retained ? `; retained ${retained.name}` : ''}`, ip: ipOf(req) })
  if (doc.uploadedBy && doc.uploadedBy !== req.user.name) {
    notify({ to: doc.uploadedBy, tone: 'warning', title: 'A document you uploaded was deleted', detail: `${doc.name} — reason: ${reason}`, docId: doc.id })
  }
  res.json({ ok: true, recoveryDays: 30 })
})

// Restore a soft-deleted document.
router.post('/documents/:id/restore', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const updated = store.update('documents', doc.id, { status: 'Filed', tombstone: false, deletedAt: null, deletedBy: null, deleteReason: null, retainedId: null })
  audit({ user: req.user, action: 'edit', doc: doc.name, docId: doc.id, detail: 'Restored from trash', ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// Hard delete (permanent purge) — requires typed confirmation.
router.delete('/documents/:id/purge', authRequired, requirePerm('upload'), async (req, res, next) => {
  try {
    const doc = store.findById('documents', req.params.id)
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can permanently delete' })
    if ((req.body?.confirm || '') !== 'PERMANENTLY DELETE') {
      return res.status(400).json({ error: 'Type "PERMANENTLY DELETE" to confirm', requires: 'confirmation' })
    }
    if (doc.storageKey) { try { await storage.deleteFile(doc.storageKey) } catch { /* ignore */ } }
    store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.remove('versions', v.id))
    store.remove('documents', doc.id)
    audit({ user: req.user, action: 'delete', doc: doc.name, docId: doc.id, detail: 'PERMANENTLY purged (hard delete)', ip: ipOf(req) })
    res.json({ ok: true, purged: true })
  } catch (err) {
    next(err)
  }
})

// ===========================================================================
// NOTIFICATIONS
// ===========================================================================
router.get('/notifications', authRequired, (req, res) => {
  const mine = store.all('notifications')
    .filter((n) => n.to === req.user.name || n.to === req.user.email)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 50)
  res.json({ notifications: mine, unread: mine.filter((n) => !n.read).length })
})
router.patch('/notifications/:id/read', authRequired, (req, res) => {
  const n = store.findById('notifications', req.params.id)
  if (!n) return res.status(404).json({ error: 'Not found' })
  res.json({ notification: store.update('notifications', n.id, { read: true }) })
})
router.post('/notifications/read-all', authRequired, (req, res) => {
  store.all('notifications').filter((n) => (n.to === req.user.name || n.to === req.user.email) && !n.read)
    .forEach((n) => store.update('notifications', n.id, { read: true }))
  res.json({ ok: true })
})

// Download original file (if present). Reads from GridFS or the filesystem.
router.get('/documents/:id/file', authRequired, requirePerm('browse'), async (req, res, next) => {
  try {
    const doc = store.findById('documents', req.params.id)
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (!folderAllowsRole(doc.folderId, req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: your role cannot access this folder' })
    }
    if (!doc.storageKey) return res.status(404).json({ error: 'No stored file (seed document)' })
    const buffer = await storage.getFile(doc.storageKey)
    if (!buffer) return res.status(404).json({ error: 'File missing on storage' })
    // Serve the correct MIME type so PDFs/images render inline in the viewer.
    res.setHeader('Content-Type', doc.mimeType || mimeForName(doc.name))
    res.setHeader('Content-Disposition', `inline; filename="${doc.name}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

// Upload -> full pipeline (OCR -> classify -> name -> file -> tag -> dedup)
router.post('/documents/upload', authRequired, requirePerm('upload'), upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file
    const body = req.body || {}
    const filename = body.filename || file?.originalname || `upload-${Date.now()}.pdf`
    const buf = file ? file.buffer : Buffer.from(body.text || filename)
    const storageKey = file ? await storage.putFile(buf, filename, file.mimetype) : null
    const { doc, duplicateOf } = await ingestBuffer({
      buffer: buf,
      filename,
      channel: 'manual',
      user: req.user,
      storageKey,
      hints: {
        text: body.text, type: body.type, vendor: body.vendor,
        amount: body.amount, date: body.date, client: body.client, trip: body.trip,
      },
    })
    res.status(201).json({ document: serializeDoc(doc), duplicateOf: duplicateOf ? serializeDoc(duplicateOf) : null })
  } catch (err) {
    next(err)
  }
})

// Edit metadata / tags -> new version
router.patch('/documents/:id', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const patch = {}
  const before = {}
  for (const key of ['type', 'vendor', 'amount', 'date', 'client', 'invoiceNumber', 'currency', 'department', 'gstin', 'category', 'retention', 'tags', 'status']) {
    if (key in req.body) { before[key] = doc[key] ?? null; patch[key] = req.body[key] }
  }
  // Keep category/retention consistent if the type changed (unless explicitly set).
  if ('type' in patch && !('category' in patch)) {
    const rule = TYPE_RULES.find((r) => r.type === patch.type)
    if (rule) { patch.category = rule.category; patch.retention = patch.retention || rule.retention }
  }
  const newVersion = (doc.version || 1) + 1
  patch.version = newVersion
  const updated = store.update('documents', doc.id, patch)
  // mark older versions not current
  store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.update('versions', v.id, { current: false }))
  store.insert('versions', {
    docId: doc.id, v: newVersion, author: req.user.name,
    note: req.body.note || 'Edited metadata', current: true, ts: nowIso(),
    snapshot: snapshotOf(updated),
  })
  audit({ user: req.user, action: 'edit', doc: doc.name, docId: doc.id, detail: summarizeChange(before, patch), before, after: patch, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// Approve a low-confidence doc (manual review)
router.post('/documents/:id/review', authRequired, requirePerm('review'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const patch = { status: 'Filed' }
  if (req.body.type) patch.type = req.body.type
  const updated = store.update('documents', doc.id, patch)
  audit({ user: req.user, action: 'review', doc: doc.name, docId: doc.id, detail: `Approved as ${patch.type || doc.type}`, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// Rollback to a version
router.post('/documents/:id/rollback/:v', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const target = store.find('versions', (x) => x.docId === doc.id && x.v === Number(req.params.v))
  if (!target) return res.status(404).json({ error: 'Version not found' })
  const restore = target.snapshot || {}
  const newVersion = (doc.version || 1) + 1
  const updated = store.update('documents', doc.id, { ...restore, version: newVersion })
  store.all('versions', (v) => v.docId === doc.id).forEach((v) => store.update('versions', v.id, { current: false }))
  store.insert('versions', { docId: doc.id, v: newVersion, author: req.user.name, note: `Rolled back to v${req.params.v}`, current: true, ts: nowIso(), snapshot: snapshotOf(updated) })
  audit({ user: req.user, action: 'edit', doc: doc.name, docId: doc.id, detail: `Rolled back to v${req.params.v}`, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

router.get('/documents/:id/versions', authRequired, requirePerm('browse'), (req, res) => {
  const versions = store.all('versions', (v) => v.docId === req.params.id).sort((a, b) => b.v - a.v)
  res.json({ versions })
})

router.get('/documents/:id/audit', authRequired, requirePerm('audit'), (req, res) => {
  const events = store.all('audit', (a) => a.docId === req.params.id).reverse()
  res.json({ audit: events })
})

// Delete (bonded docs require two-admin approval)
router.delete('/documents/:id', authRequired, requirePerm('upload'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  if (doc.bonded) {
    const approvals = (req.body?.approvals || []).filter(Boolean)
    if (approvals.length < 2 || req.user.role !== 'Admin') {
      return res.status(409).json({ error: 'Bonded document requires two-admin approval to delete', requires: '2-admin' })
    }
  }
  // Soft delete -> tombstone (30-day recovery window)
  const reason = (req.body?.reason) || 'Other'
  store.update('documents', doc.id, { status: 'Deleted', tombstone: true, deletedAt: nowIso(), deletedBy: req.user.name, deleteReason: reason })
  audit({ user: req.user, action: 'delete', doc: doc.name, docId: doc.id, detail: `Soft delete (${reason})`, ip: ipOf(req) })
  if (doc.uploadedBy && doc.uploadedBy !== req.user.name) {
    notify({ to: doc.uploadedBy, tone: 'warning', title: 'A document you uploaded was deleted', detail: `${doc.name} — reason: ${reason}`, docId: doc.id })
  }
  res.json({ ok: true, recoveryDays: 30 })
})

// ===========================================================================
// SEARCH — faceted + rule-based full-text (field-weighted, AND-term matching)
// ===========================================================================
// Field weights: a hit in a stronger field ranks the document higher.
const SEARCH_WEIGHTS = {
  vendor: 6, name: 5, type: 5, client: 4, category: 4, gstin: 4,
  amount: 4, tags: 3, department: 2, retention: 2, date: 2, searchText: 1,
}

function searchFields(d) {
  return {
    vendor: d.vendor || '',
    name: `${d.name || ''} ${d.originalName || ''}`,
    type: d.type || '',
    client: d.client || '',
    category: d.category || '',
    gstin: d.gstin || '',
    amount: d.amount != null ? String(d.amount) : '',
    tags: (d.tags || []).map((t) => `${t.k} ${t.v}`).join(' '),
    department: d.department || '',
    retention: d.retention || '',
    date: d.date || '',
    searchText: d.searchText || '',
  }
}

function tokenize(q) {
  return String(q).toLowerCase().split(/[^a-z0-9.@-]+/i).map((s) => s.trim()).filter(Boolean)
}

// Rank docs for a query. AND semantics: every term must match some field, so
// results are precise (no semantic-noise false positives).
function rankDocs(docs, q) {
  const terms = tokenize(q)
  if (!terms.length) {
    return [...docs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  }
  const phrase = q.trim().toLowerCase()
  const scored = []
  for (const d of docs) {
    const fields = searchFields(d)
    const lower = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.toLowerCase()]))
    let score = 0
    let matchedTerms = 0
    for (const term of terms) {
      let termHit = false
      for (const [f, val] of Object.entries(lower)) {
        if (val.includes(term)) {
          score += SEARCH_WEIGHTS[f] || 1
          if (val === term) score += 3 // exact field value match
          termHit = true
        }
      }
      if (termHit) matchedTerms += 1
    }
    if (matchedTerms < terms.length) continue // require ALL terms (precision)
    const hay = Object.values(lower).join(' ')
    if (terms.length > 1 && hay.includes(phrase)) score += 12 // exact phrase bonus
    scored.push({ d, score })
  }
  scored.sort((a, b) => b.score - a.score || new Date(b.d.createdAt || 0) - new Date(a.d.createdAt || 0))
  return scored.map((x) => x.d)
}

router.post('/search', authRequired, requirePerm('search'), (req, res) => {
  const { q = '', types = [], clients = [], retentions = [] } = req.body || {}
  let docs = store.all('documents').filter((d) => !d.tombstone && folderAllowsRole(d.folderId, req.user.role))
  if (types.length) docs = docs.filter((d) => types.includes(d.type))
  if (clients.length) docs = docs.filter((d) => clients.includes(d.client))
  if (retentions.length) docs = docs.filter((d) => retentions.includes(d.retention))

  const results = rankDocs(docs, q)

  // Facets computed over the filter-narrowed set (before the text query).
  const facets = { type: {}, client: {}, retention: {} }
  for (const d of docs) {
    facets.type[d.type] = (facets.type[d.type] || 0) + 1
    facets.client[d.client] = (facets.client[d.client] || 0) + 1
    facets.retention[d.retention] = (facets.retention[d.retention] || 0) + 1
  }
  res.json({ results: results.map(serializeDoc), facets, count: results.length })
})

// Semantic search — ranks documents by meaning using vector embeddings.
// Lazily indexes any documents missing a current-model embedding (batched).
router.post('/documents/semantic-search', authRequired, requirePerm('browse'), async (req, res, next) => {
  try {
    const { q = '', limit = 20, folderId } = req.body || {}
    if (!String(q).trim()) return res.json({ results: [], model: embeddingModel(), count: 0 })

    let docs = store.all('documents').filter((d) => !d.tombstone && folderAllowsRole(d.folderId, req.user.role))
    if (folderId) docs = docs.filter((d) => d.folderId === folderId)
    if (!docs.length) return res.json({ results: [], model: embeddingModel(), count: 0 })

    const { vector: qv, model } = await embedQuery(q)

    // Lazy backfill: (re)embed docs that lack an embedding for the active model.
    const need = docs.filter((d) => !d.semanticEmbedding || d.semanticModel !== model)
    if (need.length) {
      const texts = need.map((d) => [d.name, d.type, d.vendor, d.client, d.category, d.searchText].filter(Boolean).join(' '))
      const { vectors } = await embedPassages(texts)
      need.forEach((d, i) => {
        store.update('documents', d.id, { semanticEmbedding: vectors[i], semanticModel: model })
        d.semanticEmbedding = vectors[i]
        d.semanticModel = model
      })
    }

    const ranked = docs
      .map((d) => ({ d, score: embCosine(qv, d.semanticEmbedding) }))
      .filter((x) => x.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(50, Number(limit) || 20))

    res.json({
      model,
      count: ranked.length,
      results: ranked.map((x) => ({ ...serializeDoc(x.d), score: Number(x.score.toFixed(3)) })),
    })
  } catch (err) {
    next(err)
  }
})

// ===========================================================================
// TRIPS
// ===========================================================================
router.get('/trips', authRequired, requirePerm('trips'), (req, res) => {
  const trips = store.all('trips').map((t) => ({
    ...t,
    docs: t.documents.map((id) => serializeDoc(store.findById('documents', id))).filter(Boolean),
  }))
  res.json({ trips })
})
router.post('/trips/detect', authRequired, requirePerm('trips'), (req, res) => {
  const created = detectTrips()
  audit({ user: req.user, action: 'classify', detail: `Trip detection ran (${created.length} new)`, ip: ipOf(req) })
  res.json({ created })
})
router.patch('/trips/:id', authRequired, requirePerm('trips'), (req, res) => {
  const trip = store.findById('trips', req.params.id)
  if (!trip) return res.status(404).json({ error: 'Trip not found' })
  const updated = store.update('trips', trip.id, { status: req.body.status || trip.status })
  audit({ user: req.user, action: 'edit', detail: `Trip ${trip.name} → ${updated.status}`, ip: ipOf(req) })
  res.json({ trip: updated })
})

// ===========================================================================
// RETENTION
// ===========================================================================
router.get('/retention', authRequired, requirePerm('retention'), (req, res) => {
  const items = store.all('documents')
    .filter((d) => !d.tombstone)
    .map((d) => {
      const r = retentionStatus(d)
      return { id: d.id, name: d.name, client: d.client, rule: d.retention, ...r }
    })
  const rules = Object.entries(RETENTION_YEARS).map(([code, years]) => ({ code, years }))
  res.json({ items, rules })
})
router.post('/retention/sweep', authRequired, requirePerm('retention'), (req, res) => {
  const r = runRetentionSweep()
  audit({ user: req.user, action: 'classify', detail: `Retention sweep (${r.expiring} expiring, ${r.expired} expired)`, ip: ipOf(req) })
  res.json(r)
})
router.post('/documents/:id/retention-action', authRequired, requirePerm('retention'), (req, res) => {
  const doc = store.findById('documents', req.params.id)
  if (!doc) return res.status(404).json({ error: 'Document not found' })
  const { action } = req.body || {}
  if (doc.bonded || doc.retention === 'permanent') {
    return res.status(409).json({ error: 'Permanent/bonded documents are locked' })
  }
  let patch = {}
  if (action === 'archive') patch = { archived: true, status: 'Archived' }
  else if (action === 'extend') {
    const next = { '3yr': '5yr', '5yr': '7yr', '7yr': '8yr', '8yr': 'permanent' }[doc.retention] || '8yr'
    patch = { retention: next }
  } else if (action === 'delete') patch = { status: 'Deleted', tombstone: true }
  else return res.status(400).json({ error: 'Unknown action' })
  const updated = store.update('documents', doc.id, patch)
  audit({ user: req.user, action: action === 'delete' ? 'delete' : 'edit', doc: doc.name, docId: doc.id, detail: `Retention action: ${action}`, ip: ipOf(req) })
  res.json({ document: serializeDoc(updated) })
})

// ===========================================================================
// BONDS
// ===========================================================================
router.get('/bonds', authRequired, requirePerm('bonds'), (req, res) => {
  const bonds = store.all('bonds').map((b) => ({
    ...b,
    docNames: b.documents.map((id) => store.findById('documents', id)?.name || id),
  }))
  res.json({ bonds })
})
router.post('/bonds', authRequired, requirePerm('bonds'), (req, res) => {
  const { label, companies = [], documents = [] } = req.body || {}
  if (!label) return res.status(400).json({ error: 'Label required' })
  const bond = store.insert('bonds', {
    label, companies, documents, status: 'Locked',
    createdBy: req.user.name, requires: '2-admin delete',
  })
  documents.forEach((id) => store.update('documents', id, { bonded: true }))
  audit({ user: req.user, action: 'edit', detail: `Created permanent bond: ${label}`, ip: ipOf(req) })
  res.status(201).json({ bond })
})
router.delete('/bonds/:id', authRequired, requirePerm('bonds'), (req, res) => {
  const bond = store.findById('bonds', req.params.id)
  if (!bond) return res.status(404).json({ error: 'Bond not found' })
  const approvals = (req.body?.approvals || []).filter(Boolean)
  if (approvals.length < 2 || req.user.role !== 'Admin') {
    return res.status(409).json({ error: 'Two-admin approval required to break a bond', requires: '2-admin' })
  }
  bond.documents.forEach((id) => store.update('documents', id, { bonded: false }))
  store.remove('bonds', bond.id)
  audit({ user: req.user, action: 'delete', detail: `Broke bond: ${bond.label}`, ip: ipOf(req) })
  res.json({ ok: true })
})

// ===========================================================================
// AUDIT
// ===========================================================================
router.get('/audit', authRequired, requirePerm('audit'), (req, res) => {
  const { action, q } = req.query
  let events = store.all('audit').slice().reverse()
  if (action && action !== 'All') events = events.filter((e) => e.action === action)
  if (q) {
    const term = String(q).toLowerCase()
    events = events.filter((e) => [e.user, e.doc, e.detail, e.action].join(' ').toLowerCase().includes(term))
  }
  res.json({ audit: events, total: store.all('audit').length })
})
router.get('/audit/verify', authRequired, requirePerm('audit'), (req, res) => {
  res.json(verifyChain())
})

// ===========================================================================
// COMPLIANCE EXPORT
// ===========================================================================
const PACKS = {
  iso: { name: 'ISO 27001', desc: 'Information security controls evidence pack' },
  soc2: { name: 'SOC 2 Type II', desc: 'Trust services criteria audit pack' },
  dpdp: { name: 'DPDP 2023', desc: 'India data residency, consent & breach records' },
  gst: { name: 'GST', desc: 'GSTIN-linked invoices & returns archive' },
}
router.get('/compliance/packs', authRequired, requirePerm('compliance'), (req, res) => {
  const docs = store.all('documents')
  const audited = store.all('audit').length
  const packs = Object.entries(PACKS).map(([id, p]) => {
    const ready = Math.min(99, 60 + Math.round((audited % 35)) + (id === 'gst' ? 14 : 30))
    return { id, ...p, score: ready }
  })
  res.json({ packs, documents: docs.length, auditEvents: audited })
})
router.post('/compliance/:type/generate', authRequired, requirePerm('compliance'), (req, res) => {
  const pack = PACKS[req.params.type]
  if (!pack) return res.status(404).json({ error: 'Unknown pack' })
  const docs = store.all('documents').filter((d) => !d.tombstone)
  const events = store.all('audit')
  const chain = verifyChain()
  audit({ user: req.user, action: 'share', detail: `Generated ${pack.name} compliance pack`, ip: ipOf(req) })
  const html = complianceHtml(pack, docs, events, chain, req.user)
  res.json({
    pack: pack.name,
    generatedAt: nowIso(),
    documents: docs.length,
    auditEvents: events.length,
    integrity: chain,
    html,
  })
})

// ===========================================================================
// eSIGN
// ===========================================================================
router.get('/esign', authRequired, requirePerm('esign'), (req, res) => {
  res.json({ envelopes: store.all('envelopes') })
})
router.post('/esign', authRequired, requirePerm('esign'), (req, res) => {
  const { doc, provider = 'DocuSign', signer } = req.body || {}
  if (!doc || !signer) return res.status(400).json({ error: 'doc and signer required' })
  const env = store.insert('envelopes', { doc, provider, signer, status: 'Draft', sent: '—' })
  audit({ user: req.user, action: 'share', doc, detail: `eSign envelope created (${provider})`, ip: ipOf(req) })
  res.status(201).json({ envelope: env })
})
router.patch('/esign/:id/send', authRequired, requirePerm('esign'), (req, res) => {
  const env = store.findById('envelopes', req.params.id)
  if (!env) return res.status(404).json({ error: 'Envelope not found' })
  const updated = store.update('envelopes', env.id, { status: 'Sent', sent: nowIso().slice(0, 10) })
  audit({ user: req.user, action: 'share', doc: env.doc, detail: `Sent for signature via ${env.provider}`, ip: ipOf(req) })
  res.json({ envelope: updated })
})

// ---- helpers ---------------------------------------------------------------
function summarizeChange(before, after) {
  const keys = Object.keys(before)
  return keys
    .filter((k) => k !== 'tags' && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: ${before[k]} → ${after[k]}`)
    .join(', ') || 'Updated tags/metadata'
}

function complianceHtml(pack, docs, events, chain, user) {
  const rows = docs.slice(0, 200).map((d) =>
    `<tr><td>${d.name}</td><td>${d.type}</td><td>${d.client}</td><td>${d.retention}</td><td>${d.gstin || ''}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${pack.name} Compliance Pack</title>
<style>body{font-family:system-ui,sans-serif;color:#111;margin:40px}h1{color:#4f46e5}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}
td,th{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
.meta{color:#555;font-size:13px}.ok{color:#059669}.bad{color:#e11d48}</style></head>
<body><h1>FlowSphere DMS — ${pack.name}</h1>
<p class="meta">${pack.desc}</p>
<p class="meta">Generated: ${nowIso()} by ${user.name} · Region: ${config.region}</p>
<p class="meta">Documents: <b>${docs.length}</b> · Audit events: <b>${events.length}</b> ·
Audit integrity: <b class="${chain.valid ? 'ok' : 'bad'}">${chain.valid ? 'VERIFIED (hash-chained)' : 'TAMPERED'}</b></p>
<h3>Document register</h3>
<table><thead><tr><th>Name</th><th>Type</th><th>Client</th><th>Retention</th><th>GSTIN</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="meta" style="margin-top:24px">This pack is generated from the immutable audit trail and document metadata store.</p>
</body></html>`
}

export default router
