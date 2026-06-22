import { store, nowIso } from './store.js'
import { audit } from './audit.js'
import { ocrExtract } from './ocr.js'
import { classifyDoc } from './classifier.js'
import {
  autoName, buildMetadata, checksum, embed, findDuplicate, ensureFolderPath,
  detectTrips, departmentFor, relationshipFor,
} from './pipeline.js'
import { extOf, mimeForName } from './mime.js'

// Single source of truth for capturing a document. Used by manual upload, API
// push, and the hot-folder / scanner / email watchers — so every channel runs
// the identical pipeline: OCR -> classify -> auto-name -> file -> tag -> dedup.
export async function ingestBuffer({ buffer, filename, channel = 'api', user, storageKey = null, hints = {}, source = null }) {
  const actor = user?.name || user || `System (${channel})`

  // 1. OCR — the document's OWN content drives classification. Supplemental
  // context (e.g. an email subject/body) is only used as a fallback when the
  // document itself yields little text, so it never outvotes the real content.
  const { text: ocrText, engine: ocrEngineUsed } = await ocrExtract(buffer, filename)
  const ownText = `${filename} ${ocrText}`.trim()
  const classifyText = ocrText && ocrText.length >= 20 ? ownText : `${ownText} ${hints.text || ''}`.trim()
  // Full text (incl. context) is used for the search embedding.
  const text = [filename, ocrText, hints.text].filter(Boolean).join(' ')

  // 2. Classify (LLM or deterministic)
  const c = await classifyDoc({
    filename, text: classifyText,
    hintType: hints.type, hintVendor: hints.vendor, hintAmount: hints.amount,
    hintDate: hints.date, hintClient: hints.client,
  })

  // 3. Dedup
  const sum = checksum(buffer)
  const dup = findDuplicate({ checksum: sum, vendor: c.vendor, amount: c.amount, date: c.date })

  // 4. File into auto-created folder path
  const year = (c.date || nowIso()).slice(0, 4)
  const isTrip = ['Taxi', 'Hotel', 'Meals'].includes(c.category)
  const folderId = ensureFolderPath({ client: c.client, year, category: c.category, trip: isTrip ? hints.trip || 'Trip' : null })

  // 5. Auto-name (preserving the original file extension) + metadata
  const seq = 4000 + store.all('documents').length + 1
  const ext = extOf(filename) || 'pdf'
  const name = autoName({ type: c.type, vendor: c.vendor, date: c.date, seq, ext })
  const mimeType = mimeForName(name)
  const department = departmentFor(c.category)
  const bonded = c.retention === 'permanent'
  const relationship = relationshipFor({ bonded, retention: c.retention })

  const doc = store.insert('documents', {
    name,
    originalName: filename,
    mimeType,
    type: c.type, category: c.category, retention: c.retention,
    vendor: c.vendor, amount: c.amount, date: c.date, client: c.client, gstin: c.gstin,
    confidence: c.confidence,
    fields: c.fields || {},
    documentConfidence: c.documentConfidence ?? c.confidence,
    reviewReason: c.reviewReason || null,
    nonBusiness: c.nonBusiness || false,
    department,
    relationship,
    folderId,
    checksum: sum,
    size: buffer.length,
    storageKey,
    channel,
    uploadedBy: actor,
    // Provenance for email-ingested docs: who sent it, subject, when. Critical
    // for tracing false/incorrect files back to the sender.
    emailMeta: source || null,
    classifier: c.engine || 'deterministic',
    ocrEngine: ocrEngineUsed,
    tags: buildMetadata({ ...c, department, relationship }),
    searchText: text.slice(0, 4000),
    embedding: embed(`${name} ${text}`),
    duplicate: Boolean(dup),
    duplicateOf: dup?.id || null,
    status: dup ? 'Duplicate' : c.status,
    bonded,
    version: 1,
  })

  store.insert('versions', {
    docId: doc.id, v: 1, author: actor, note: `Captured via ${channel}`, current: true, ts: nowIso(),
    snapshot: {
      type: doc.type, vendor: doc.vendor, amount: doc.amount, date: doc.date,
      client: doc.client, category: doc.category, retention: doc.retention,
      tags: doc.tags, status: doc.status,
    },
  })

  const senderNote = source?.from ? ` from ${source.fromName ? `${source.fromName} <${source.from}>` : source.from}` : ''
  audit({ user: actor, action: 'upload', doc: doc.name, docId: doc.id, detail: `Captured via ${channel}${senderNote} (${(buffer.length / 1024).toFixed(0)} KB)`, ip: channel })
  audit({ user: 'System (AI)', action: 'classify', doc: doc.name, docId: doc.id, detail: `${c.type} · confidence ${c.confidence} · ${c.engine || 'deterministic'}`, ip: 'pipeline' })
  if (dup) audit({ user: 'System (AI)', action: 'dedup', doc: doc.name, docId: doc.id, detail: `duplicate of ${dup.name}`, ip: 'pipeline' })

  detectTrips()

  return { doc, duplicateOf: dup || null }
}
