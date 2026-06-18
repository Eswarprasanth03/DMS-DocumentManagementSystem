import crypto from 'node:crypto'
import { store, nowIso } from './store.js'

// Append-only, immutable audit log. Each entry is hash-chained to the previous
// entry so any tampering or reordering is detectable.
// Canonical, normalized payload — both writing and verification must use the
// exact same shape so the hash chain is reproducible.
function canonical(e, prevHash) {
  return JSON.stringify({
    ts: e.ts,
    user: e.user,
    action: e.action,
    doc: e.doc,
    docId: e.docId,
    detail: e.detail,
    before: e.before,
    after: e.after,
    prevHash,
  })
}

export function audit({ user, action, doc, docId, detail, ip, before, after }) {
  const entries = store.collection('audit')
  const prevHash = entries.length ? entries[entries.length - 1].hash : 'GENESIS'
  const record = {
    ts: nowIso(),
    user: user?.name || user || 'System',
    action,
    doc: doc || null,
    docId: docId || null,
    detail: detail || '',
    ip: ip || 'local',
    before: before ?? null,
    after: after ?? null,
    prevHash,
  }
  record.hash = crypto.createHash('sha256').update(canonical(record, prevHash)).digest('hex')
  return store.insert('audit', record)
}

export function ipOf(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'local'
  )
}

// Verify the integrity of the whole chain.
export function verifyChain() {
  const entries = store.all('audit')
  let prevHash = 'GENESIS'
  for (const e of entries) {
    const expected = crypto.createHash('sha256').update(canonical(e, prevHash)).digest('hex')
    if (e.prevHash !== prevHash || e.hash !== expected) {
      return { valid: false, brokenAt: e.id }
    }
    prevHash = e.hash
  }
  return { valid: true, count: entries.length }
}
