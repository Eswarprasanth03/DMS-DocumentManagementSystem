import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import routes from './routes.js'
import { seed } from './seed.js'
import { store } from './store.js'
import { runRetentionSweep } from './pipeline.js'
import { startWatchers } from './watchers.js'
import { startImapPoller } from './imap.js'
import { classifierEngine } from './classifier.js'
import { purgeExpiredTrash } from './maintenance.js'

// Safety net: never let a single bad file / background worker crash the server.
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err?.message || err))
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message || err))

const app = express()

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) =>
  res.json({ ok: true, region: config.region, db: config.dbDriver, ts: new Date().toISOString() }),
)
app.use('/api', routes)

// Centralized error handler.
app.use((err, req, res, next) => {
  console.error('[error]', err.message)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

// Connect/load the datastore before serving.
await store.init()
console.log(`[db] driver=${config.dbDriver}${config.dbDriver === 'mongo' ? ` · ${config.mongoUri}/${config.mongoDb}` : ''}`)

// Seeding is opt-in: a normal restart preserves existing data and never reseeds.
if (config.seedOnStart) {
  const result = await seed()
  console.log('[seed]', result.skipped ? 'already seeded' : result)
} else {
  const users = store.all('users').length
  const docs = store.all('documents').length
  if (users === 0) console.log('[db] empty database — run `npm run server:seed` to load demo data')
  else console.log(`[db] loaded ${docs} documents, ${users} users (auto-seed off)`)
}

const server = app.listen(config.port, () => {
  console.log(`\n  FlowSphere DMS API  ·  http://localhost:${config.port}`)
  console.log(`  Region: ${config.region}  ·  database: ${config.dbDriver}  ·  files: ${config.dbDriver === 'mongo' ? 'GridFS (MongoDB)' : 'local filesystem'}\n`)

  // Background work starts ONLY after we successfully own the port — otherwise a
  // second instance would keep running (and hold a duplicate IMAP connection)
  // even though it failed to bind. See the 'error' handler below.

  // Start live ingest watchers (hot-folder, scanner, email-to-ingest).
  startWatchers()
  // Start the IMAP mailbox poller (live email-to-ingest), if configured.
  startImapPoller()
  console.log(`[ingest] OCR=${config.ocrEngine} · classifier=${classifierEngine()}`)

  // Retention scheduler — recomputes lifecycle state on an interval. Guarded so
  // a single bad record can never prevent the API from starting.
  try { runRetentionSweep() } catch (err) { console.error('[retention] initial sweep failed:', err.message) }
  setInterval(() => {
    try {
      const r = runRetentionSweep()
      if (r.expiring || r.expired) console.log('[retention] sweep:', r)
    } catch (err) { console.error('[retention] sweep failed:', err.message) }
  }, 60 * 60 * 1000)

  // Purge soft-deleted documents past the 30-day recovery window.
  purgeExpiredTrash().then((r) => r.purged && console.log('[trash] purged:', r.purged)).catch(() => {})
  setInterval(() => {
    purgeExpiredTrash().then((r) => r.purged && console.log('[trash] purged:', r.purged)).catch((e) => console.error('[trash] purge failed:', e.message))
  }, 6 * 60 * 60 * 1000)
})

// If the port is already in use, exit instead of lingering as a zombie that
// holds a duplicate IMAP connection and fights over the same inbox.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[fatal] port ${config.port} is already in use — another FlowSphere API is running. Exiting.`)
    process.exit(1)
  }
  console.error('[fatal] server error:', err.message)
  process.exit(1)
})

// Flush pending writes on shutdown so nothing is lost.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    try { await store.close() } catch { /* ignore */ }
    process.exit(0)
  })
}
