import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import * as storage from './storage.js'
import { ingestBuffer } from './ingest.js'
import { imapStatus } from './imap.js'

// Background ingest watchers. Each channel is a real folder; dropping a file in
// it runs the full pipeline automatically (scan-to-folder, mail attachments,
// hot-folder auto-ingest). Processed originals are moved to data/processed.

const stats = {
  hotfolder: { dir: config.dropDir, processed: 0, lastFile: null },
  scanner: { dir: config.scannerDir, processed: 0, lastFile: null },
  email: { dir: config.maildropDir, processed: 0, lastFile: null },
}

function ensureDirs() {
  for (const d of [config.dropDir, config.scannerDir, config.maildropDir, config.processedDir, config.uploadsDir]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

function moveToProcessed(filePath, channel) {
  try {
    const dest = path.join(config.processedDir, channel)
    fs.mkdirSync(dest, { recursive: true })
    fs.renameSync(filePath, path.join(dest, `${Date.now()}-${path.basename(filePath)}`))
  } catch {
    try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  }
}

// Wait until a file's size is stable (finished being written).
async function waitStable(filePath, tries = 10) {
  let last = -1
  for (let i = 0; i < tries; i++) {
    let size
    try { size = fs.statSync(filePath).size } catch { return false }
    if (size > 0 && size === last) return true
    last = size
    await new Promise((r) => setTimeout(r, 200))
  }
  return true
}

async function processEml(filePath) {
  const { simpleParser } = await import('mailparser')
  const parsed = await simpleParser(fs.readFileSync(filePath))
  const fromObj = parsed.from?.value?.[0] || {}
  const source = {
    channel: 'email',
    from: fromObj.address || parsed.from?.text || 'unknown',
    fromName: fromObj.name || '',
    subject: parsed.subject || '(no subject)',
    messageId: parsed.messageId || null,
    receivedAt: (parsed.date ? new Date(parsed.date) : new Date()).toISOString(),
    to: parsed.to?.value?.[0]?.address || null,
  }
  const atts = (parsed.attachments || []).filter((a) => a.content?.length)
  if (atts.length) {
    for (const a of atts) {
      const ext = path.extname(a.filename || '') || '.bin'
      const fname = a.filename || `attachment${ext}`
      const key = await storage.putFile(a.content, fname, a.contentType)
      await ingestBuffer({
        buffer: a.content,
        filename: fname,
        channel: 'email',
        storageKey: key,
        hints: { text: `${parsed.subject || ''} ${parsed.text || ''}` },
        source,
      })
      stats.email.processed++
      stats.email.lastFile = a.filename
    }
  } else {
    // No attachment — ingest the email body itself.
    const body = `${parsed.subject || 'email'} ${parsed.text || ''}`
    const buffer = Buffer.from(body)
    const fname = `${(parsed.subject || 'email').slice(0, 40)}.txt`
    const key = await storage.putFile(buffer, fname)
    await ingestBuffer({ buffer, filename: fname, channel: 'email', storageKey: key })
    stats.email.processed++
    stats.email.lastFile = parsed.subject
  }
}

async function processFile(channel, dir, file) {
  const filePath = path.join(dir, file)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return
  await waitStable(filePath)
  try {
    if (channel === 'email' && /\.eml$/i.test(file)) {
      await processEml(filePath)
    } else {
      const buffer = fs.readFileSync(filePath)
      const key = await storage.putFile(buffer, file)
      await ingestBuffer({ buffer, filename: file, channel, storageKey: key })
      stats[channel].processed++
      stats[channel].lastFile = file
    }
    console.log(`[watch:${channel}] ingested ${file}`)
  } catch (err) {
    console.error(`[watch:${channel}] failed on ${file}:`, err.message)
  } finally {
    moveToProcessed(filePath, channel)
  }
}

function watchDir(channel, dir) {
  // Process anything already sitting in the folder at startup.
  for (const f of fs.readdirSync(dir)) processFile(channel, dir, f)

  const seen = new Map()
  fs.watch(dir, (event, filename) => {
    if (!filename) return
    // Debounce duplicate fs events for the same file.
    const key = String(filename)
    clearTimeout(seen.get(key))
    seen.set(key, setTimeout(() => { seen.delete(key); processFile(channel, dir, key) }, 400))
  })
  console.log(`[watch:${channel}] watching ${dir}`)
}

export function startWatchers() {
  ensureDirs()
  watchDir('hotfolder', config.dropDir)
  watchDir('scanner', config.scannerDir)
  watchDir('email', config.maildropDir)
}

export function channelStatus() {
  const imap = imapStatus()
  const imapDetail = !imap.enabled
    ? (imap.configured ? 'configured — set IMAP_ENABLED=true' : 'not configured')
    : imap.lastError
      ? `error: ${imap.lastError}`
      : `${imap.user} · every ${imap.pollSeconds}s`
  return {
    manual: { type: 'Manual upload', status: 'active', detail: 'Drag & drop / file picker' },
    api: { type: 'API push', status: 'active', detail: 'POST /api/documents/upload' },
    hotfolder: { type: 'Hot-folder watcher', status: 'active', detail: rel(config.dropDir), processed: stats.hotfolder.processed, lastFile: stats.hotfolder.lastFile },
    scanner: { type: 'Scanner (scan-to-folder)', status: 'active', detail: rel(config.scannerDir), processed: stats.scanner.processed, lastFile: stats.scanner.lastFile },
    email: { type: 'Email drop (.eml)', status: 'active', detail: `${rel(config.maildropDir)} (.eml)`, processed: stats.email.processed, lastFile: stats.email.lastFile },
    imap: {
      type: 'Email inbox (IMAP)',
      status: imap.enabled ? (imap.connected ? 'active' : 'connecting') : 'inactive',
      detail: imapDetail,
      processed: imap.processed,
      lastFile: imap.lastFile,
      lastFrom: imap.lastFrom,
      lastSubject: imap.lastSubject,
      lastPollAt: imap.lastPollAt,
    },
  }
}

function rel(p) {
  return p.replace(config.dataDir, 'data')
}
