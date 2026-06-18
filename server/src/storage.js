import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { newId } from './store.js'
import * as mongo from './mongo.js'

// File-bytes storage abstraction.
//   - DB_DRIVER=mongo : files are stored inside MongoDB via GridFS (bucket
//                       "files") — keys look like "gridfs:<objectId>".
//   - DB_DRIVER=json  : files are written to server/data/uploads (key = filename).

const GRID_PREFIX = 'gridfs:'

function useGridfs() {
  return config.dbDriver === 'mongo'
}

export function isGridKey(key) {
  return typeof key === 'string' && key.startsWith(GRID_PREFIX)
}

// Persist bytes; returns a storageKey to save on the document record.
export async function putFile(buffer, filename = 'file', contentType) {
  if (useGridfs()) {
    const id = await mongo.gridfsPut(buffer, filename, contentType)
    return `${GRID_PREFIX}${id}`
  }
  fs.mkdirSync(config.uploadsDir, { recursive: true })
  const key = `${Date.now()}-${newId('f')}${path.extname(filename)}`
  fs.writeFileSync(path.join(config.uploadsDir, key), buffer)
  return key
}

// Retrieve bytes for a storageKey, or null if missing.
export async function getFile(key) {
  if (!key) return null
  if (isGridKey(key)) {
    const id = key.slice(GRID_PREFIX.length)
    if (!mongo.isValidObjectId(id)) return null
    try { return await mongo.gridfsBuffer(id) } catch { return null }
  }
  const p = path.join(config.uploadsDir, key)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

export async function deleteFile(key) {
  if (!key) return
  if (isGridKey(key)) {
    await mongo.gridfsDelete(key.slice(GRID_PREFIX.length))
    return
  }
  try { fs.unlinkSync(path.join(config.uploadsDir, key)) } catch { /* ignore */ }
}
