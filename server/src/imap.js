import { config } from './config.js'
import * as storage from './storage.js'
import { ingestBuffer } from './ingest.js'

// Live email ingestion over IMAP. We hold ONE persistent connection open and
// use IMAP IDLE so the server is notified the instant new mail arrives (no
// waiting for a poll). New unread messages are processed concurrently: each
// attachment runs through the same pipeline the rest of the app uses, then the
// message is marked read. A lightweight periodic re-scan + auto-reconnect makes
// it resilient to dropped connections or missed push events.

const PROCESS_CONCURRENCY = 4

const state = {
  enabled: false,
  configured: false,
  connected: false,
  mode: 'idle',
  user: '',
  mailbox: config.imapMailbox,
  pollSeconds: config.imapPollSeconds,
  processed: 0,
  skipped: 0,
  lastFrom: null,
  lastSubject: null,
  lastFile: null,
  lastPollAt: null,
  lastError: null,
  // Only unread mail that arrives at/after this moment is ingested. The existing
  // unread backlog in the mailbox is left untouched (still unread, never pulled).
  startedAt: null,
}

let client = null
let running = false
let pendingRescan = false
let safetyTimer = null
let reconnectTimer = null
let deps = null

export function imapStatus() {
  return { ...state }
}

async function getDeps() {
  if (deps) return deps
  const { ImapFlow } = await import('imapflow')
  const { simpleParser } = await import('mailparser')
  deps = { ImapFlow, simpleParser }
  return deps
}

function senderAllowed(parsed) {
  const list = config.imapAllowedSenders
  if (!list.length) return true
  const from = parsed.from?.value?.[0]?.address?.toLowerCase() || ''
  return list.some((s) => from === s || from.endsWith(s))
}

// Run an async fn over items with a bounded concurrency pool.
async function mapPool(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await fn(items[idx]) } catch (err) { console.error('[imap] item failed:', err.message) }
    }
  })
  await Promise.all(workers)
}

// Only real file attachments are ingested. Emails with no attachment (plain
// notifications, newsletters, body-only mail) are ignored entirely.
// Returns true if at least one attachment was ingested.
async function ingestMessage(parsed) {
  const subject = parsed.subject || '(no subject)'
  const fromObj = parsed.from?.value?.[0] || {}
  const from = fromObj.address || parsed.from?.text || 'unknown'
  const fromName = fromObj.name || ''
  const hintText = `${subject} ${parsed.text || ''}`.trim()

  // Captured sender provenance — attached to every doc from this message so an
  // admin can always see who sent a false/incorrect file.
  const source = {
    channel: 'email',
    from,
    fromName,
    subject,
    messageId: parsed.messageId || null,
    receivedAt: (parsed.date ? new Date(parsed.date) : new Date()).toISOString(),
    to: parsed.to?.value?.[0]?.address || config.imapUser || null,
  }

  // Skip inline images embedded in the HTML body (logos, signatures, tracking
  // pixels) — only keep genuine file attachments.
  const atts = (parsed.attachments || []).filter(
    (a) => a.content?.length && (a.contentDisposition === 'attachment' || (a.filename && !a.related)),
  )
  if (!atts.length) return false

  // Process this message's attachments concurrently.
  await mapPool(atts, PROCESS_CONCURRENCY, async (a) => {
    const fname = a.filename || `attachment-${Date.now()}`
    const key = await storage.putFile(a.content, fname, a.contentType)
    await ingestBuffer({
      buffer: a.content,
      filename: fname,
      channel: 'email',
      storageKey: key,
      hints: { text: hintText },
      source,
    })
    state.processed++
    state.lastFile = fname
  })

  state.lastFrom = fromName ? `${fromName} <${from}>` : from
  state.lastSubject = subject
  return true
}

async function handleUid(uid, simpleParser) {
  const msg = await client.fetchOne(uid, { source: true }, { uid: true })
  if (!msg?.source) return
  const parsed = await simpleParser(msg.source)
  if (!senderAllowed(parsed)) {
    state.skipped++
    console.log(`[imap] skipped (sender not allowed) from ${parsed.from?.text || '?'}`)
  } else {
    const ingested = await ingestMessage(parsed)
    if (ingested) {
      console.log(`[imap] ingested attachment(s) from "${parsed.subject || '(no subject)'}" (${parsed.from?.text || '?'})`)
    } else {
      state.skipped++
      console.log(`[imap] skipped (no attachment) "${parsed.subject || '(no subject)'}"`)
    }
  }
  if (config.imapMarkSeen) {
    try { await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) } catch { /* ignore */ }
  }
}

// Find and ingest all NEW unread messages. Re-entrant safe: if triggered while
// already running, a follow-up pass is scheduled so nothing is missed.
async function processNew() {
  if (!client || !state.connected) return
  if (running) { pendingRescan = true; return }
  running = true
  state.lastPollAt = new Date().toISOString()
  try {
    const { simpleParser } = await getDeps()
    // IMAP SINCE is day-granular, so we also apply a precise per-message guard.
    const sinceDay = new Date(state.startedAt)
    sinceDay.setHours(0, 0, 0, 0)
    const uids = await client.search({ seen: false, since: sinceDay }, { uid: true })

    // Filter to messages that actually arrived after the poller started.
    const fresh = []
    for (const uid of uids || []) {
      try {
        const meta = await client.fetchOne(uid, { internalDate: true }, { uid: true })
        const arrived = meta?.internalDate ? new Date(meta.internalDate) : null
        if (arrived && arrived < state.startedAt) continue
        fresh.push(uid)
      } catch { /* ignore individual metadata failures */ }
    }

    if (fresh.length) {
      await mapPool(fresh, PROCESS_CONCURRENCY, (uid) => handleUid(uid, simpleParser))
    }
  } catch (err) {
    state.lastError = err?.message || String(err)
    console.error('[imap] processNew failed:', state.lastError)
  } finally {
    running = false
    if (pendingRescan) { pendingRescan = false; setImmediate(() => processNew()) }
  }
}

function scheduleReconnect(delayMs = 5000) {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect().catch((e) => {
      state.lastError = e?.message || String(e)
      scheduleReconnect(Math.min(60000, delayMs * 2))
    })
  }, delayMs)
}

async function connect() {
  const { ImapFlow } = await getDeps()

  // Tear down any previous client WITHOUT letting its teardown trigger another
  // reconnect (that self-perpetuating loop was the cause of the connect storm).
  if (client) {
    const old = client
    client = null
    try { old.removeAllListeners() } catch { /* ignore */ }
    try { await old.logout() } catch { /* ignore */ }
  }

  const c = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.imapUser, pass: config.imapPass },
    logger: false,
  })
  client = c

  c.on('error', (err) => { state.lastError = err?.message || String(err) })
  c.on('close', () => {
    // Ignore close events from a client we've already replaced.
    if (client !== c) return
    state.connected = false
    console.warn('[imap] connection closed — reconnecting')
    scheduleReconnect()
  })
  // Pushed the instant new mail arrives (IMAP IDLE under the hood).
  c.on('exists', () => { if (client === c) processNew().catch(() => {}) })

  await c.connect()
  await c.mailboxOpen(config.imapMailbox)
  if (client !== c) { try { await c.logout() } catch { /* ignore */ } return }
  state.connected = true
  state.lastError = null
  console.log(`[imap] connected & idling on ${config.imapMailbox} (instant push)`)

  // Catch anything that arrived between connects.
  processNew().catch(() => {})
}

export function startImapPoller() {
  state.configured = Boolean(config.imapUser && config.imapPass)
  if (!config.imapEnabled) {
    console.log('[imap] disabled (set IMAP_ENABLED=true to poll a mailbox)')
    return
  }
  if (!state.configured) {
    console.warn('[imap] enabled but IMAP_USER / IMAP_PASSWORD are not set — skipping')
    return
  }

  state.enabled = true
  state.user = config.imapUser
  state.startedAt = new Date()
  console.log(`[imap] live IDLE on ${config.imapUser} (${config.imapHost}) — only NEW unread mail (from ${state.startedAt.toISOString()})`)

  connect().catch((e) => {
    state.lastError = e?.message || String(e)
    console.error('[imap] initial connect failed:', state.lastError)
    scheduleReconnect()
  })

  // Safety net: periodically re-scan (in case a push event was missed) and
  // recover the connection if it dropped.
  const everyMs = Math.max(15, config.imapPollSeconds) * 1000
  safetyTimer = setInterval(() => {
    if (!state.connected) { scheduleReconnect(2000); return }
    processNew().catch(() => {})
  }, everyMs)
}

export function stopImapPoller() {
  if (safetyTimer) clearInterval(safetyTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  safetyTimer = null
  reconnectTimer = null
  if (client) { client.logout().catch(() => {}); client = null }
}
