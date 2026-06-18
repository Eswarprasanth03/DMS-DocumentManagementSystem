import fs from 'node:fs'
import crypto from 'node:crypto'
import { config } from './config.js'
import * as mongo from './mongo.js'

// Document store with a fast in-memory model and pluggable persistence:
//   - 'json'  : writes the whole DB to a JSON file (zero external services)
//   - 'mongo' : persists every change to MongoDB (one Mongo doc per record)
// Reads are always synchronous against the in-memory copy; mongo writes are
// applied through a background queue so the existing synchronous API is intact.

const COLLECTIONS = ['users', 'folders', 'documents', 'versions', 'trips', 'bonds', 'audit', 'envelopes', 'notifications']

const EMPTY = {
  users: [],
  folders: [],
  documents: [],
  versions: [],
  trips: [],
  bonds: [],
  audit: [],
  envelopes: [],
  notifications: [],
  meta: { seeded: false },
}

class Store {
  constructor() {
    this.driver = config.dbDriver === 'mongo' ? 'mongo' : 'json'
    this.data = structuredClone(EMPTY)
    this._queue = []
    this._draining = false
    this._ready = false
  }

  // Connect/load. Must be awaited before serving requests or seeding.
  async init() {
    if (this.driver === 'mongo') {
      await mongo.connect(config.mongoUri, config.mongoDb)
      const loaded = await mongo.loadAll(COLLECTIONS)
      const meta = await mongo.loadMeta()
      this.data = { ...structuredClone(EMPTY), ...loaded, meta: meta || { seeded: false } }
    } else {
      this._loadJson()
    }
    this._ready = true
    return this
  }

  _loadJson() {
    try {
      if (fs.existsSync(config.dbFile)) {
        const raw = fs.readFileSync(config.dbFile, 'utf-8')
        this.data = { ...structuredClone(EMPTY), ...JSON.parse(raw) }
      }
    } catch (err) {
      console.error('[store] failed to load db, starting empty:', err.message)
      this.data = structuredClone(EMPTY)
    }
  }

  _writeJson() {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(config.dbFile, JSON.stringify(this.data, null, 2))
  }

  // --- mongo write queue (keeps mutation API synchronous) ------------------
  _enqueue(fn) {
    this._queue.push(fn)
    this._drain()
  }

  async _drain() {
    if (this._draining) return
    this._draining = true
    while (this._queue.length) {
      const fn = this._queue.shift()
      try { await fn() } catch (err) { console.error('[store] mongo persist error:', err.message) }
    }
    this._draining = false
  }

  // Wait for all pending mongo writes to complete.
  async flush() {
    while (this._queue.length || this._draining) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  async close() {
    await this.flush()
    if (this.driver === 'mongo') await mongo.close()
  }

  // Persist a single record (mongo) or the whole file (json).
  _persistUpsert(name, record) {
    if (this.driver === 'mongo') this._enqueue(() => mongo.upsert(name, record))
    else this._writeJson()
  }
  _persistDelete(name, id) {
    if (this.driver === 'mongo') this._enqueue(() => mongo.del(name, id))
    else this._writeJson()
  }

  // save() persists meta (mongo) or the whole DB (json).
  save() {
    if (this.driver === 'mongo') this._enqueue(() => mongo.saveMeta(this.data.meta))
    else this._writeJson()
  }

  async reset() {
    this.data = structuredClone(EMPTY)
    if (this.driver === 'mongo') {
      await mongo.dropAll(COLLECTIONS)
      await mongo.gridfsClear()
      await mongo.saveMeta(this.data.meta)
    } else {
      this._writeJson()
    }
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = []
    return this.data[name]
  }

  // --- generic helpers -----------------------------------------------------
  all(name, predicate) {
    const items = this.collection(name)
    return predicate ? items.filter(predicate) : [...items]
  }

  find(name, predicate) {
    return this.collection(name).find(predicate)
  }

  findById(name, id) {
    return this.collection(name).find((x) => x.id === id)
  }

  insert(name, doc) {
    const record = { id: doc.id || newId(name), createdAt: nowIso(), ...doc }
    this.collection(name).push(record)
    this._persistUpsert(name, record)
    return record
  }

  update(name, id, patch) {
    const items = this.collection(name)
    const idx = items.findIndex((x) => x.id === id)
    if (idx === -1) return null
    items[idx] = { ...items[idx], ...patch, updatedAt: nowIso() }
    this._persistUpsert(name, items[idx])
    return items[idx]
  }

  remove(name, id) {
    const items = this.collection(name)
    const idx = items.findIndex((x) => x.id === id)
    if (idx === -1) return false
    items.splice(idx, 1)
    this._persistDelete(name, id)
    return true
  }
}

export function newId(prefix = 'id') {
  return `${prefix.slice(0, 3)}_${crypto.randomBytes(6).toString('hex')}`
}

export function nowIso() {
  return new Date().toISOString()
}

export const store = new Store()
