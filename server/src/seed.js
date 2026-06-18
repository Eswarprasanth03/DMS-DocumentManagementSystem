import { pathToFileURL } from 'node:url'
import { store, newId, nowIso } from './store.js'
import { hashPassword } from './auth.js'
import {
  classify, autoName, buildMetadata, checksum, embed, findDuplicate,
  ensureFolderPath, retentionStatus, detectTrips, runRetentionSweep,
  departmentFor, relationshipFor,
} from './pipeline.js'
import { audit } from './audit.js'

const USERS = [
  { name: 'Priya Nair', email: 'priya@flowsphere.io', role: 'Admin', password: 'demo' },
  { name: 'Arjun Rao', email: 'arjun@flowsphere.io', role: 'Manager', password: 'demo' },
  { name: 'Sara Khan', email: 'sara@flowsphere.io', role: 'Viewer', password: 'demo' },
]

// Synthetic source documents — text feeds the deterministic classifier.
const SEED_DOCS = [
  { filename: 'ola-taxi-mumbai.pdf', text: 'Ola Cabs taxi ride Mumbai Acme Corp Amount INR 845 Date 2026-06-11 GSTIN 27AABCO1234A1Z5' },
  { filename: 'taj-hotel-mumbai.pdf', text: 'Taj Hotels hotel stay Mumbai Acme Corp Amount INR 18650 Date 2026-06-12' },
  { filename: 'bombay-canteen-meal.pdf', text: 'The Bombay Canteen restaurant meal food Acme Corp Amount INR 3240 Date 2026-06-12' },
  { filename: 'globex-invoice.pdf', text: 'Invoice Globex Ltd Amount INR 125000 Date 2026-05-28 GSTIN 24AAACG5566L1ZP' },
  { filename: 'ola-taxi-mumbai-copy.pdf', text: 'Ola Cabs taxi ride Mumbai Acme Corp Amount INR 845 Date 2026-06-11' },
  { filename: 'acme-msa-contract.pdf', text: 'Contract MSA agreement Acme Corp Date 2024-01-15 permanent' },
  { filename: 'gst-return-q4.pdf', text: 'GST return GSTR Acme Corp Date 2022-03-31' },
  { filename: 'initech-po.pdf', text: 'Purchase Order PO Initech Amount INR 48000 Date 2019-07-10' },
  { filename: 'scan-unknown-0021.jpg', text: 'scanned document misc Date 2026-06-09 Acme' },
]

export async function seed({ reset = false } = {}) {
  if (store.data.meta?.seeded && !reset) return { skipped: true }
  if (reset) await store.reset()

  // Users
  for (const u of USERS) {
    store.insert('users', {
      name: u.name,
      email: u.email.toLowerCase(),
      role: u.role,
      passwordHash: hashPassword(u.password),
    })
  }
  const admin = store.find('users', (u) => u.role === 'Admin')

  // Documents through the real pipeline
  let seq = 4470
  for (const src of SEED_DOCS) {
    seq += 1
    const buf = Buffer.from(src.text)
    const c = classify({ filename: src.filename, text: src.text })
    const sum = checksum(buf)
    const dup = findDuplicate({ checksum: sum, vendor: c.vendor, amount: c.amount, date: c.date })
    const year = (c.date || nowIso()).slice(0, 4)
    const isTrip = ['Taxi', 'Hotel', 'Meals'].includes(c.category)
    const folderId = ensureFolderPath({
      client: c.client,
      year,
      category: c.category,
      trip: isTrip ? 'Mumbai Conf' : null,
    })
    const ext = src.filename.includes('.') ? src.filename.split('.').pop().toLowerCase() : 'pdf'
    const name = autoName({ type: c.type, vendor: c.vendor, date: c.date, seq, ext })
    const bonded = c.retention === 'permanent'
    const department = departmentFor(c.category)
    const relationship = relationshipFor({ bonded, retention: c.retention })
    const doc = store.insert('documents', {
      name,
      originalName: src.filename,
      ...c,
      department,
      relationship,
      channel: 'seed',
      classifier: 'deterministic',
      folderId,
      checksum: sum,
      size: buf.length,
      storageKey: null,
      tags: buildMetadata({ ...c, department, relationship }),
      searchText: src.text.slice(0, 4000),
      embedding: embed(`${name} ${src.text}`),
      duplicate: Boolean(dup),
      duplicateOf: dup?.id || null,
      status: dup ? 'Duplicate' : c.status,
      bonded,
      version: 1,
    })
    store.insert('versions', {
      docId: doc.id, v: 1, author: 'System (AI)', note: 'Auto-filed on classification', current: true, ts: nowIso(),
      snapshot: {
        type: doc.type, vendor: doc.vendor, amount: doc.amount, date: doc.date,
        client: doc.client, category: doc.category, retention: doc.retention,
        tags: doc.tags, status: doc.status,
      },
    })
    audit({ user: 'System (AI)', action: 'classify', doc: doc.name, docId: doc.id, detail: `confidence ${c.confidence}`, ip: 'pipeline' })
    if (dup) audit({ user: 'System (AI)', action: 'dedup', doc: doc.name, docId: doc.id, detail: `duplicate of ${dup.name}`, ip: 'pipeline' })
  }

  // Bond the permanent contract
  const contract = store.find('documents', (d) => d.type === 'Contract')
  if (contract) {
    store.insert('bonds', {
      label: 'Acme ↔ FlowSphere MSA Bond',
      companies: ['Acme Corp', 'FlowSphere'],
      documents: [contract.id],
      status: 'Locked',
      createdBy: admin?.name || 'Admin',
      requires: '2-admin delete',
    })
  }

  // eSign envelopes
  const envSeeds = [
    { docName: contract?.name, provider: 'DocuSign', signer: 'legal@acme.com', status: 'Signed' },
    { docName: 'nda-globex-2026.pdf', provider: 'Adobe Sign', signer: 'ops@globex.com', status: 'Sent' },
  ]
  for (const e of envSeeds) {
    store.insert('envelopes', { doc: e.docName || 'document.pdf', provider: e.provider, signer: e.signer, status: e.status, sent: nowIso().slice(0, 10) })
  }

  detectTrips()
  runRetentionSweep()

  store.update('users', admin.id, {}) // touch save
  store.data.meta = { seeded: true, seededAt: nowIso() }
  store.save()
  return { ok: true, users: USERS.length, documents: SEED_DOCS.length }
}

// Allow `node src/seed.js --reset`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reset = process.argv.includes('--reset')
  await store.init()
  const r = await seed({ reset })
  await store.flush()
  await store.close()
  console.log('[seed]', r)
  process.exit(0)
}
