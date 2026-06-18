import { MongoClient, GridFSBucket, ObjectId } from 'mongodb'

// Thin MongoDB persistence helper. Each app collection maps to a Mongo
// collection, one Mongo document per record, keyed by the record's `id`
// (stored as _id). `meta` is kept in a dedicated `_meta` collection.
// File bytes are stored in GridFS (bucket "files").

let client = null
let db = null
let bucket = null

const META_COLL = '_meta'

function stripId(doc) {
  if (!doc) return doc
  const { _id, ...rest } = doc
  return rest
}

export async function connect(uri, dbName) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
  await client.connect()
  db = client.db(dbName)
  // Sanity ping so a bad URI fails fast at startup.
  await db.command({ ping: 1 })
  bucket = new GridFSBucket(db, { bucketName: 'files' })
  return db
}

export async function loadAll(names) {
  const out = {}
  for (const n of names) {
    const docs = await db.collection(n).find({}).toArray()
    out[n] = docs.map(stripId)
  }
  return out
}

export async function loadMeta() {
  const doc = await db.collection(META_COLL).findOne({ _id: 'meta' })
  return doc ? stripId(doc) : null
}

export async function upsert(name, record) {
  await db.collection(name).replaceOne({ _id: record.id }, { ...record, _id: record.id }, { upsert: true })
}

export async function del(name, id) {
  await db.collection(name).deleteOne({ _id: id })
}

export async function saveMeta(meta) {
  await db.collection(META_COLL).replaceOne({ _id: 'meta' }, { ...meta, _id: 'meta' }, { upsert: true })
}

export async function dropAll(names) {
  for (const n of [...names, META_COLL]) {
    try { await db.collection(n).deleteMany({}) } catch { /* ignore */ }
  }
}

// ---- GridFS file storage --------------------------------------------------
export function gridfsPut(buffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const up = bucket.openUploadStream(filename, contentType ? { contentType } : undefined)
    up.on('error', reject)
    up.on('finish', () => resolve(String(up.id)))
    up.end(buffer)
  })
}

export function gridfsDownloadStream(id) {
  return bucket.openDownloadStream(new ObjectId(id))
}

export async function gridfsBuffer(id) {
  const chunks = []
  await new Promise((resolve, reject) => {
    const s = bucket.openDownloadStream(new ObjectId(id))
    s.on('data', (c) => chunks.push(c))
    s.on('end', resolve)
    s.on('error', reject)
  })
  return Buffer.concat(chunks)
}

export async function gridfsDelete(id) {
  try { await bucket.delete(new ObjectId(id)) } catch { /* ignore */ }
}

export async function gridfsClear() {
  try { await db.collection('files.files').deleteMany({}) } catch { /* ignore */ }
  try { await db.collection('files.chunks').deleteMany({}) } catch { /* ignore */ }
}

export function isValidObjectId(id) {
  return ObjectId.isValid(id)
}

export async function close() {
  try { await client?.close() } catch { /* ignore */ }
  client = null
  db = null
  bucket = null
}

export function isConnected() {
  return Boolean(db)
}
